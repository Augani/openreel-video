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

interface AgentBridgeOptions {
  url?: string;
  /** Override the global WebSocket constructor (used by tests). */
  webSocketImpl?: typeof WebSocket;
}

type IncomingFrame =
  | { kind: "dispatch"; requestId: string; action: unknown }
  | { kind: "dispatchMany"; requestId: string; actions: unknown[] }
  | { kind: "getProjectState"; requestId: string }
  | { kind: "undo"; requestId: string }
  | { kind: "redo"; requestId: string }
  | {
      kind: "importMediaByUrl";
      requestId: string;
      url: string;
      name: string;
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
  | { kind: "projectChanged"; project: unknown };

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
        await this.handleDispatchMany(frame.requestId, frame.actions);
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
  ): Promise<void> {
    const results: ActionResult[] = [];
    for (const raw of rawActions) {
      let action: Action;
      try {
        action = this.serializer.deserialize(JSON.stringify(raw));
      } catch (err) {
        results.push({
          success: false,
          error: {
            code: "INVALID_PARAMS",
            message: err instanceof Error ? err.message : "deserialize failed",
          },
        });
        break;
      }
      const result = await useProjectStore.getState().executeAction(action);
      results.push(result);
      if (!result.success) break;
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
