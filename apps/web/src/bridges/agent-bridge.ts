/**
 * AgentBridge — connects an external agent (e.g. a Python process driving the
 * Anthropic SDK) to the editor over a local WebSocket. The bridge accepts
 * serialized Actions, dispatches them through the existing project-store
 * pipeline (validation, history, auto-save all run unchanged), and streams
 * project state back so the agent can observe its own edits.
 *
 * Dev-only. Gated behind VITE_ENABLE_AGENT_BRIDGE in EditorInterface.tsx.
 */

import { ActionSerializer } from "@openreel/core";
import type { Action, ActionResult } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useAgentStore } from "../stores/agent-store";
import { getPlaybackBridge } from "./playback-bridge";

interface AgentBridgeOptions {
  url?: string;
  /** Override the global WebSocket constructor (used by tests). */
  webSocketImpl?: typeof WebSocket;
}

type IncomingFrame =
  | { kind: "dispatch"; requestId: string; action: unknown }
  | {
      kind: "dispatchMany";
      requestId: string;
      actions: unknown[];
      groupId?: string;
    }
  | { kind: "getProjectState"; requestId: string }
  | { kind: "undo"; requestId: string }
  | { kind: "redo"; requestId: string }
  | {
      kind: "importMediaByUrl";
      requestId: string;
      url: string;
      name: string;
    }
  | { kind: "enterFreeze"; requestId: string; reason?: string }
  | { kind: "exitFreeze"; requestId: string }
  | {
      kind: "captureFrame";
      requestId: string;
      time: number;
      maxWidth?: number;
      format?: "jpeg" | "png" | "webp";
      quality?: number;
    };

type OutgoingFrame =
  | { kind: "ready"; projectId: string; project: unknown }
  | {
      kind: "dispatchResult";
      requestId: string;
      success: boolean;
      error?: ActionResult["error"];
      warnings?: string[];
      actionId?: string;
      results?: ActionResult[];
      mediaId?: string;
    }
  | { kind: "projectState"; requestId: string; project: unknown }
  | { kind: "projectChanged"; project: unknown }
  | { kind: "freezeChanged"; frozen: boolean; reason: string | null }
  | {
      kind: "frame";
      requestId: string;
      time: number;
      width: number;
      height: number;
      mimeType: string;
      dataBase64: string;
    };

const DEFAULT_URL = "ws://localhost:8765";
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const PROJECT_CHANGE_DEBOUNCE_MS = 50;

export class AgentBridge {
  private url: string;
  private wsImpl: typeof WebSocket;
  private ws: WebSocket | null = null;
  private initialized = false;
  private disposed = false;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeProjectStore: (() => void) | null = null;
  private unsubscribeAgentStore: (() => void) | null = null;
  private serializer = new ActionSerializer();
  private projectChangeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AgentBridgeOptions = {}) {
    this.url = opts.url ?? DEFAULT_URL;
    this.wsImpl = opts.webSocketImpl ?? WebSocket;
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.disposed = false;
    this.connect();
    this.subscribeToProject();
    this.subscribeToAgentStore();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.disposed = true;
    this.initialized = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.projectChangeTimer) {
      clearTimeout(this.projectChangeTimer);
      this.projectChangeTimer = null;
    }
    if (this.unsubscribeProjectStore) {
      this.unsubscribeProjectStore();
      this.unsubscribeProjectStore = null;
    }
    if (this.unsubscribeAgentStore) {
      this.unsubscribeAgentStore();
      this.unsubscribeAgentStore = null;
    }
    if (useAgentStore.getState().frozen) {
      useAgentStore.getState().setFrozen(false, null);
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore — socket may already be closing
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.disposed) return;

    let socket: WebSocket;
    try {
      socket = new this.wsImpl(this.url);
    } catch (err) {
      console.warn("[AgentBridge] WebSocket constructor failed:", err);
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener("open", () => {
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      const project = useProjectStore.getState().project;
      this.send({ kind: "ready", projectId: project.id, project });
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      this.ws = null;
      if (useAgentStore.getState().frozen) {
        useAgentStore.getState().setFrozen(false, null);
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // The `close` event will fire after this and trigger reconnect; we
      // swallow the error so a missing server doesn't spam the console.
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private subscribeToAgentStore(): void {
    // Push freeze changes to the agent — including user-initiated "Stop" clicks.
    let last = useAgentStore.getState().frozen;
    this.unsubscribeAgentStore = useAgentStore.subscribe((state) => {
      if (state.frozen === last) return;
      last = state.frozen;
      this.send({
        kind: "freezeChanged",
        frozen: state.frozen,
        reason: state.reason,
      });
    });
  }

  private subscribeToProject(): void {
    this.unsubscribeProjectStore = useProjectStore.subscribe(
      (state) => state.project,
      (project) => {
        if (this.projectChangeTimer) clearTimeout(this.projectChangeTimer);
        this.projectChangeTimer = setTimeout(() => {
          this.send({ kind: "projectChanged", project });
        }, PROJECT_CHANGE_DEBOUNCE_MS);
      },
    );
  }

  private async handleMessage(raw: unknown): Promise<void> {
    let frame: IncomingFrame;
    try {
      const text = typeof raw === "string" ? raw : String(raw);
      frame = JSON.parse(text) as IncomingFrame;
    } catch (err) {
      console.warn("[AgentBridge] dropped malformed frame:", err);
      return;
    }

    switch (frame.kind) {
      case "dispatch":
        await this.handleDispatch(frame.requestId, frame.action);
        return;
      case "dispatchMany":
        await this.handleDispatchMany(
          frame.requestId,
          frame.actions,
          frame.groupId,
        );
        return;
      case "getProjectState":
        this.send({
          kind: "projectState",
          requestId: frame.requestId,
          project: useProjectStore.getState().project,
        });
        return;
      case "undo": {
        const result = await useProjectStore.getState().undo();
        this.replyDispatch(frame.requestId, result);
        return;
      }
      case "redo": {
        const result = await useProjectStore.getState().redo();
        this.replyDispatch(frame.requestId, result);
        return;
      }
      case "importMediaByUrl":
        await this.handleImportByUrl(frame.requestId, frame.url, frame.name);
        return;
      case "enterFreeze": {
        useAgentStore.getState().setFrozen(true, frame.reason ?? null);
        try {
          getPlaybackBridge().pause();
        } catch {
          // Playback bridge may not be ready yet — freeze state is what matters.
        }
        this.replyDispatch(frame.requestId, { success: true });
        return;
      }
      case "exitFreeze": {
        useAgentStore.getState().setFrozen(false, null);
        this.replyDispatch(frame.requestId, { success: true });
        return;
      }
      case "captureFrame":
        await this.handleCaptureFrame(frame);
        return;
      default: {
        const exhaustive: never = frame;
        console.warn("[AgentBridge] unknown frame kind:", exhaustive);
      }
    }
  }

  private async handleDispatch(
    requestId: string,
    rawAction: unknown,
  ): Promise<void> {
    let action: Action;
    try {
      action = this.serializer.deserialize(JSON.stringify(rawAction));
    } catch (err) {
      this.send({
        kind: "dispatchResult",
        requestId,
        success: false,
        error: {
          code: "INVALID_PARAMS",
          message: err instanceof Error ? err.message : "deserialize failed",
        },
      });
      return;
    }
    const result = await useProjectStore.getState().executeAction(action);
    this.replyDispatch(requestId, result);
  }

  private async handleDispatchMany(
    requestId: string,
    rawActions: unknown[],
    groupId?: string,
  ): Promise<void> {
    const results: ActionResult[] = [];
    const history = useProjectStore.getState().actionHistory;
    if (groupId) history.beginGroup(groupId);
    try {
      for (const raw of rawActions) {
        let action: Action;
        try {
          action = this.serializer.deserialize(JSON.stringify(raw));
        } catch (err) {
          results.push({
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message:
                err instanceof Error ? err.message : "deserialize failed",
            },
          });
          break;
        }
        const result = await useProjectStore.getState().executeAction(action);
        results.push(result);
        if (!result.success) break;
      }
    } finally {
      if (groupId) history.endGroup();
    }
    const last = results[results.length - 1];
    this.send({
      kind: "dispatchResult",
      requestId,
      success: results.every((r) => r.success),
      error: last?.error,
      results,
    });
  }

  private async handleCaptureFrame(
    frame: Extract<IncomingFrame, { kind: "captureFrame" }>,
  ): Promise<void> {
    const { requestId, time } = frame;
    const maxWidth = frame.maxWidth ?? 512;
    const format = frame.format ?? "jpeg";
    const quality = frame.quality ?? 0.8;
    const mimeType = `image/${format}`;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await getPlaybackBridge().captureFrameAt(time);
    } catch (err) {
      this.send({
        kind: "dispatchResult",
        requestId,
        success: false,
        error: {
          code: "DECODE_ERROR",
          message: err instanceof Error ? err.message : "scrub failed",
        },
      });
      return;
    }
    if (!bitmap) {
      this.send({
        kind: "dispatchResult",
        requestId,
        success: false,
        error: { code: "DECODE_ERROR", message: "frame render timed out" },
      });
      return;
    }
    try {
      const scale = Math.min(1, maxWidth / bitmap.width);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: mimeType, quality });
      const buf = await blob.arrayBuffer();
      const dataBase64 = bytesToBase64(new Uint8Array(buf));
      this.send({
        kind: "frame",
        requestId,
        time,
        width: w,
        height: h,
        mimeType: blob.type || mimeType,
        dataBase64,
      });
    } catch (err) {
      this.send({
        kind: "dispatchResult",
        requestId,
        success: false,
        error: {
          code: "DECODE_ERROR",
          message: err instanceof Error ? err.message : "encode failed",
        },
      });
    } finally {
      bitmap.close?.();
    }
  }

  private async handleImportByUrl(
    requestId: string,
    url: string,
    name: string,
  ): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.send({
          kind: "dispatchResult",
          requestId,
          success: false,
          error: {
            code: "MEDIA_NOT_FOUND",
            message: `fetch ${url} → HTTP ${response.status}`,
          },
        });
        return;
      }
      const blob = await response.blob();
      const file = new File([blob], name, { type: blob.type });
      const result = await useProjectStore.getState().importMedia(file);
      this.send({
        kind: "dispatchResult",
        requestId,
        success: result.success,
        error: result.error,
        warnings: result.warnings,
        actionId: result.actionId,
        mediaId: result.actionId,
      });
    } catch (err) {
      this.send({
        kind: "dispatchResult",
        requestId,
        success: false,
        error: {
          code: "DECODE_ERROR",
          message: err instanceof Error ? err.message : "import failed",
        },
      });
    }
  }

  private replyDispatch(requestId: string, result: ActionResult): void {
    this.send({
      kind: "dispatchResult",
      requestId,
      success: result.success,
      error: result.error,
      warnings: result.warnings,
      actionId: result.actionId,
    });
  }

  private send(frame: OutgoingFrame): void {
    if (!this.ws || this.ws.readyState !== this.wsImpl.OPEN) return;
    try {
      this.ws.send(JSON.stringify(frame));
    } catch (err) {
      console.warn("[AgentBridge] send failed:", err);
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(binary);
}

let agentBridgeInstance: AgentBridge | null = null;

export function getAgentBridge(opts?: AgentBridgeOptions): AgentBridge {
  if (!agentBridgeInstance) {
    agentBridgeInstance = new AgentBridge(opts);
  }
  return agentBridgeInstance;
}

export function initializeAgentBridge(opts?: AgentBridgeOptions): AgentBridge {
  const bridge = getAgentBridge(opts);
  bridge.initialize();
  return bridge;
}

export function disposeAgentBridge(): void {
  if (agentBridgeInstance) {
    agentBridgeInstance.dispose();
    agentBridgeInstance = null;
  }
}

export type { AgentBridgeOptions };
