import { ReverbCancelledError, type ReduceReverbParams } from "./reverb-params";
import type { ReverbHandler, ReverbRequest, ReverbResponse } from "./reverb-worker-core";

/**
 * Where Reduce Reverb runs: a module Web Worker in the browser (nothing heavy on the main thread), a deferred inline call where
 * workers do not exist. Both execute the same handler.
 */
export interface ReverbCallOptions {
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

export interface ReverbResult {
  readonly channels: Float32Array[];
  /** The blind RT60 estimate (seconds) the processing used, and how much evidence it had (0..1). */
  readonly rt60: number;
  readonly confidence: number;
}

export interface ReverbBackend {
  reduce(channels: Float32Array[], sampleRate: number, params: ReduceReverbParams, options?: ReverbCallOptions): Promise<ReverbResult>;
}

/** Longest source the main-thread fallback will process; longer ones are refused so playback never stalls on it. */
export const INLINE_REVERB_MAX_SECONDS = 120;

export function createInlineReverbBackend(): ReverbBackend {
  let handlerPromise: Promise<ReverbHandler> | null = null;
  const getHandler = (): Promise<ReverbHandler> => (handlerPromise ??= import("./reverb-worker-core").then((mod) => mod.createReverbHandler()));
  let nextId = 1;
  return {
    reduce(channels, sampleRate, params, options = {}) {
      const seconds = (channels[0]?.length ?? 0) / Math.max(1, sampleRate);
      if (seconds > INLINE_REVERB_MAX_SECONDS) return Promise.reject(new Error(`inline Reduce Reverb is limited to ${INLINE_REVERB_MAX_SECONDS}s`));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const onAbort = () => void getHandler().then((handler) => handler.handle({ id, kind: "cancel" }, () => undefined));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        void getHandler()
          .then((handler) =>
            handler.handle({ id, kind: "reduce", channels: channels.map((c) => c.slice()), sampleRate, params }, (response) => {
              if (response.kind === "progress") options.onProgress?.(response.fraction);
              else if (response.kind === "done") resolve({ channels: response.channels, rt60: response.rt60, confidence: response.confidence });
              else reject(response.cancelled ? new ReverbCancelledError() : new Error(response.message));
            }),
          )
          .catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))))
          .finally(() => options.signal?.removeEventListener("abort", onAbort));
      });
    },
  };
}

export function createWorkerReverbBackend(): ReverbBackend | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (result: ReverbResult) => void; reject: (error: Error) => void; onProgress?: (fraction: number) => void }>();
  const failAll = (error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const ensure = (): Worker => {
    if (worker) return worker;
    const created = new Worker(new URL("./reverb.worker.ts", import.meta.url), { type: "module", name: "openreel-reduce-reverb" });
    created.onmessage = (event: MessageEvent<ReverbResponse>) => {
      const response = event.data;
      const job = pending.get(response.id);
      if (!job) return;
      if (response.kind === "progress") {
        job.onProgress?.(response.fraction);
        return;
      }
      pending.delete(response.id);
      if (response.kind === "done") job.resolve({ channels: response.channels, rt60: response.rt60, confidence: response.confidence });
      else job.reject(response.cancelled ? new ReverbCancelledError() : new Error(response.message));
    };
    created.onerror = () => failAll(new Error("Reduce Reverb worker failed"));
    worker = created;
    return created;
  };
  return {
    reduce(channels, sampleRate, params, options = {}) {
      return new Promise((resolve, reject) => {
        try {
          const id = nextId++;
          pending.set(id, { resolve, reject, onProgress: options.onProgress });
          const copies = channels.map((channel) => channel.slice());
          const request: ReverbRequest = { id, kind: "reduce", channels: copies, sampleRate, params };
          options.signal?.addEventListener("abort", () => worker?.postMessage({ id, kind: "cancel" } satisfies ReverbRequest), { once: true });
          ensure().postMessage(request, copies.map((c) => c.buffer));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

let shared: ReverbBackend | null = null;

/** The shared backend: the worker when available, falling back to the inline one after a worker failure (never after a cancel). */
export function getReverbBackend(): ReverbBackend {
  if (shared) return shared;
  const worker = createWorkerReverbBackend();
  const inline = createInlineReverbBackend();
  shared = worker
    ? {
        reduce: (channels, sampleRate, params, options) =>
          worker.reduce(channels, sampleRate, params, options).catch((error: unknown) => {
            if (error instanceof ReverbCancelledError || options?.signal?.aborted) throw error;
            return inline.reduce(channels, sampleRate, params, options);
          }),
      }
    : inline;
  return shared;
}

/** Test / host hook: replaces the shared backend. */
export function setReverbBackend(backend: ReverbBackend | null): void {
  shared = backend;
}
