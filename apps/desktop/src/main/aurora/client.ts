import { app } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import type {
  AuroraPreviewSessionEvent,
  AuroraPreviewSessionStartArgs,
  AuroraPreviewSessionStartResult,
  AuroraRenderPreviewArgs,
  AuroraRenderPreviewResult,
  AuroraSequenceRenderArgs,
  AuroraSequenceSessionEvent,
  AuroraSequenceSessionStartResult,
} from "../../shared/ipc-contract";

type AuroraHostRequest =
  | { readonly id: string; readonly kind: "renderPreview"; readonly args: AuroraRenderPreviewArgs }
  | {
      readonly id: string;
      readonly kind: "startPreviewSession";
      readonly sessionId: string;
      readonly args: AuroraRenderPreviewArgs;
    }
  | { readonly id: string; readonly kind: "cancelPreviewSession"; readonly sessionId: string }
  | {
      readonly id: string;
      readonly kind: "startSequenceSession";
      readonly sessionId: string;
      readonly args: AuroraSequenceRenderArgs;
    }
  | { readonly id: string; readonly kind: "cancelSequenceSession"; readonly sessionId: string }
  | { readonly id: string; readonly kind: "shutdown" };

type AuroraHostResponse =
  | {
      readonly kind: "reply";
      readonly id: string;
      readonly ok: true;
      readonly result:
        | AuroraRenderPreviewResult
        | AuroraPreviewSessionStartResult
        | AuroraSequenceSessionStartResult
        | null;
    }
  | { readonly kind: "reply"; readonly id: string; readonly ok: false; readonly error: string }
  | { readonly kind: "previewSessionEvent"; readonly event: AuroraPreviewSessionEvent }
  | { readonly kind: "sequenceSessionEvent"; readonly event: AuroraSequenceSessionEvent };

function hostScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "aurora-host", "index.js")
    : path.join(__dirname, "../../aurora-host/index.js");
}

export class AuroraHostClient {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<
    string,
    {
      readonly resolve: (result: unknown) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  private readonly previewSessionListeners = new Map<
    string,
    (event: AuroraPreviewSessionEvent) => void
  >();
  private readonly sequenceSessionListeners = new Map<
    string,
    (event: AuroraSequenceSessionEvent) => void
  >();
  private nextId = 1;

  async renderPreview(args: AuroraRenderPreviewArgs): Promise<AuroraRenderPreviewResult> {
    const child = this.ensureChild();
    const id = `aurora-${this.nextId++}`;
    return new Promise<AuroraRenderPreviewResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as AuroraRenderPreviewResult),
        reject,
      });
      const message: AuroraHostRequest = { id, kind: "renderPreview", args };
      child.send(message, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async startPreviewSession(
    args: AuroraPreviewSessionStartArgs,
    onEvent: (event: AuroraPreviewSessionEvent) => void,
  ): Promise<AuroraPreviewSessionStartResult> {
    const child = this.ensureChild();
    const id = `aurora-${this.nextId++}`;
    const sessionId = args.sessionId ?? `aurora-session-${this.nextId++}`;
    this.previewSessionListeners.set(sessionId, onEvent);
    return new Promise<AuroraPreviewSessionStartResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as AuroraPreviewSessionStartResult),
        reject,
      });
      const message: AuroraHostRequest = {
        id,
        kind: "startPreviewSession",
        sessionId,
        args: {
          scene: args.scene,
          assets: args.assets,
          width: args.width,
          height: args.height,
          background: args.background,
          timeSeconds: args.timeSeconds,
          quality: args.quality,
        },
      };
      child.send(message, (error) => {
        if (!error) return;
        this.pending.delete(id);
        this.previewSessionListeners.delete(sessionId);
        reject(error);
      });
    })
      .then((result) => result as AuroraPreviewSessionStartResult)
      .catch((error) => {
        this.previewSessionListeners.delete(sessionId);
        throw error;
      });
  }

  async cancelPreviewSession(sessionId: string): Promise<void> {
    this.previewSessionListeners.delete(sessionId);
    const child = this.child;
    if (!child?.connected) return;
    const id = `aurora-${this.nextId++}`;
    await new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
      });
      const message: AuroraHostRequest = {
        id,
        kind: "cancelPreviewSession",
        sessionId,
      };
      child.send(message, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async startSequenceSession(
    args: AuroraSequenceRenderArgs & { readonly sessionId?: string },
    onEvent: (event: AuroraSequenceSessionEvent) => void,
  ): Promise<AuroraSequenceSessionStartResult> {
    const child = this.ensureChild();
    const id = `aurora-${this.nextId++}`;
    const sessionId = args.sessionId ?? `aurora-sequence-${this.nextId++}`;
    this.sequenceSessionListeners.set(sessionId, onEvent);
    return new Promise<AuroraSequenceSessionStartResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as AuroraSequenceSessionStartResult),
        reject,
      });
      const message: AuroraHostRequest = {
        id,
        kind: "startSequenceSession",
        sessionId,
        args: {
          scene: args.scene,
          assets: args.assets,
          width: args.width,
          height: args.height,
          frameRate: args.frameRate,
          durationSeconds: args.durationSeconds,
          background: args.background,
          quality: args.quality,
        },
      };
      child.send(message, (error) => {
        if (!error) return;
        this.pending.delete(id);
        this.sequenceSessionListeners.delete(sessionId);
        reject(error);
      });
    }).catch((error) => {
      this.sequenceSessionListeners.delete(sessionId);
      throw error;
    });
  }

  async cancelSequenceSession(sessionId: string): Promise<void> {
    this.sequenceSessionListeners.delete(sessionId);
    const child = this.child;
    if (!child?.connected) return;
    const id = `aurora-${this.nextId++}`;
    await new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
      });
      const message: AuroraHostRequest = {
        id,
        kind: "cancelSequenceSession",
        sessionId,
      };
      child.send(message, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    if (child?.connected) {
      child.send({ id: "shutdown", kind: "shutdown" } satisfies AuroraHostRequest);
    }
    child?.disconnect();
    this.previewSessionListeners.clear();
    this.sequenceSessionListeners.clear();
    this.rejectAll(new Error("Aurora host disposed"));
  }

  private ensureChild(): ChildProcess {
    if (this.child && this.child.connected) return this.child;
    const child = fork(hostScriptPath(), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.on("message", (message: AuroraHostResponse) => {
      if (!message) return;
      if (message.kind === "previewSessionEvent") {
        const listener = this.previewSessionListeners.get(message.event.sessionId);
        if (listener) listener(message.event);
        if (message.event.done) {
          this.previewSessionListeners.delete(message.event.sessionId);
        }
        return;
      }
      if (message.kind === "sequenceSessionEvent") {
        const listener = this.sequenceSessionListeners.get(message.event.sessionId);
        if (listener) listener(message.event);
        if (message.event.done) {
          this.sequenceSessionListeners.delete(message.event.sessionId);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    child.once("exit", () => {
      if (this.child === child) this.child = null;
      this.previewSessionListeners.clear();
      this.sequenceSessionListeners.clear();
      this.rejectAll(new Error("Aurora host exited"));
    });
    child.once("error", (error) => {
      if (this.child === child) this.child = null;
      this.previewSessionListeners.clear();
      this.sequenceSessionListeners.clear();
      this.rejectAll(error);
    });
    this.child = child;
    return child;
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

let auroraClient: AuroraHostClient | null = null;

export function getAuroraClient(): AuroraHostClient {
  auroraClient ??= new AuroraHostClient();
  return auroraClient;
}

export function disposeAuroraClient(): void {
  auroraClient?.dispose();
  auroraClient = null;
}
