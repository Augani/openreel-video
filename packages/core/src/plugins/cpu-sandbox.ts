/**
 * Host side of the CPU plugin sandbox: one Worker per plugin, one frame at a
 * time, a hard timeout per frame (the Worker is terminated and respawned) and
 * typed failures the plugin host turns into a bypass instead of a crash.
 */

import { CPU_SANDBOX_BOOTSTRAP } from "./cpu-source";

export const DEFAULT_CPU_TIMEOUT_MS = 2_000;
const INIT_TIMEOUT_MS = 1_500;

export type SandboxFailureKind = "timeout" | "error" | "crashed";

export class PluginSandboxError extends Error {
  constructor(
    readonly kind: SandboxFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "PluginSandboxError";
  }
}

/** Transport to one sandbox worker; adapted per runtime (browser Worker, node worker_threads). */
export interface SandboxChannel {
  post(message: unknown, transfer?: ArrayBuffer[]): void;
  onMessage(cb: (message: SandboxReply) => void): void;
  onError(cb: (error: Error) => void): void;
  terminate(): void;
}

export type SandboxChannelFactory = (bootstrapSource: string) => SandboxChannel;

export type SandboxReply =
  | { type: "ready" }
  | { type: "done"; id: number; buffer: ArrayBuffer }
  | { type: "error"; id?: number; message: string };

/** Browser/Electron renderer factory: a Blob Worker (classic, so importScripts exists only to be removed). */
export const browserSandboxChannelFactory: SandboxChannelFactory = (bootstrap) => {
  const url = URL.createObjectURL(new Blob([bootstrap], { type: "text/javascript" }));
  const worker = new Worker(url, { name: "openreel-plugin-cpu" });
  URL.revokeObjectURL(url);
  return {
    post: (message, transfer) => worker.postMessage(message, transfer ?? []),
    onMessage: (cb) => {
      worker.onmessage = (event: MessageEvent<SandboxReply>) => cb(event.data);
    },
    onError: (cb) => {
      worker.onerror = (event: ErrorEvent) => {
        event.preventDefault();
        cb(new Error(event.message || "plugin worker crashed"));
      };
      worker.onmessageerror = () => cb(new Error("plugin worker message error"));
    },
    terminate: () => worker.terminate(),
  };
};

export interface CpuFrameHost {
  readonly time: number;
  readonly frame: number;
}

interface Pending {
  readonly id: number;
  resolve(buffer: ArrayBuffer): void;
  reject(error: PluginSandboxError): void;
}

export class PluginCpuSandbox {
  private channel: SandboxChannel | null = null;
  private ready: Promise<void> | null = null;
  private pending: Pending | null = null;
  private initWaiter: { resolve(): void; reject(e: PluginSandboxError): void } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private disposed = false;

  constructor(
    private readonly source: string,
    private readonly factory: SandboxChannelFactory,
    private readonly timeoutMs: number = DEFAULT_CPU_TIMEOUT_MS,
  ) {}

  private spawn(): Promise<void> {
    if (this.ready) return this.ready;
    let channel: SandboxChannel;
    try {
      channel = this.factory(CPU_SANDBOX_BOOTSTRAP);
    } catch (error) {
      return Promise.reject(
        new PluginSandboxError("crashed", `could not start the plugin worker: ${(error as Error).message}`),
      );
    }
    this.channel = channel;
    channel.onMessage((reply) => this.onReply(reply));
    channel.onError((error) => this.fail(new PluginSandboxError("crashed", error.message)));
    this.ready = new Promise<void>((resolve, reject) => {
      this.initWaiter = { resolve, reject };
      const timer = setTimeout(() => {
        this.fail(new PluginSandboxError("timeout", `plugin did not initialise within ${INIT_TIMEOUT_MS} ms`));
      }, INIT_TIMEOUT_MS);
      const settle = this.initWaiter;
      this.initWaiter = {
        resolve: () => {
          clearTimeout(timer);
          settle.resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          settle.reject(e);
        },
      };
      channel.post({ type: "init", source: this.source });
    });
    this.ready.catch(() => undefined);
    return this.ready;
  }

  private onReply(reply: SandboxReply): void {
    if (reply.type === "ready") {
      this.initWaiter?.resolve();
      this.initWaiter = null;
      return;
    }
    if (reply.type === "error" && reply.id === undefined) {
      // init failure (compile error / no process())
      this.fail(new PluginSandboxError("error", reply.message));
      return;
    }
    const pending = this.pending;
    if (!pending || reply.id !== pending.id) return;
    this.pending = null;
    if (reply.type === "done") pending.resolve(reply.buffer);
    else if (reply.type === "error") pending.reject(new PluginSandboxError("error", reply.message));
  }

  /** Tear the worker down and reject whatever was waiting; the next run respawns. */
  private fail(error: PluginSandboxError): void {
    this.channel?.terminate();
    this.channel = null;
    this.ready = null;
    const init = this.initWaiter;
    this.initWaiter = null;
    init?.reject(error);
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }

  /**
   * Run `process()` on a COPY of the pixels so a failing frame leaves the
   * caller's buffer untouched. Calls are serialised.
   */
  run(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    params: Record<string, unknown>,
    host: CpuFrameHost,
  ): Promise<Uint8ClampedArray> {
    const job = this.queue.then(() => this.runOnce(pixels, width, height, params, host));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async runOnce(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    params: Record<string, unknown>,
    host: CpuFrameHost,
  ): Promise<Uint8ClampedArray> {
    if (this.disposed) throw new PluginSandboxError("crashed", "plugin sandbox was disposed");
    await this.spawn();
    const channel = this.channel;
    if (!channel) throw new PluginSandboxError("crashed", "plugin worker is not running");
    const id = this.nextId++;
    const copy = new Uint8ClampedArray(pixels.length);
    copy.set(pixels);
    return new Promise<Uint8ClampedArray>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new PluginSandboxError("timeout", `plugin exceeded the ${this.timeoutMs} ms frame budget`));
      }, this.timeoutMs);
      this.pending = {
        id,
        resolve: (buffer) => {
          clearTimeout(timer);
          resolve(new Uint8ClampedArray(buffer));
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      channel.post(
        { type: "run", id, width, height, buffer: copy.buffer, params, host },
        [copy.buffer as ArrayBuffer],
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    this.fail(new PluginSandboxError("crashed", "plugin sandbox was disposed"));
  }
}
