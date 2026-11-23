import type { Dfn3ModelSource } from "./dfn3-model";
import { EnhanceCancelledError } from "./enhance-constants";
import type { EnhanceHandler, EnhanceRequest, EnhanceResponse } from "./enhance-worker-core";

/**
 * Where speech enhancement runs: a module Web Worker in the browser (nothing heavy on the main thread), a deferred
 * inline call where workers do not exist. Both execute the same handler.
 */
export interface EnhanceCallOptions {
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

export interface EnhanceBackend {
  enhance(channels: Float32Array[], sampleRate: number, options?: EnhanceCallOptions): Promise<Float32Array[]>;
}

/** Longest source the main-thread fallback will enhance; longer ones are refused so playback never stalls on it. */
export const INLINE_ENHANCE_MAX_SECONDS = 180;

let modelSource: Dfn3ModelSource | null = null;

/** Host hook: where the model weights are served from (and where onnxruntime finds its wasm). */
export function setEnhanceModelSource(source: Dfn3ModelSource | null): void {
  modelSource = source;
}

/** Model location relative to the page, so it follows the app's base path (web root, desktop app:// protocol). */
export function getEnhanceModelSource(): Dfn3ModelSource {
  if (modelSource) return modelSource;
  const base = (globalThis as { document?: { baseURI?: string } }).document?.baseURI ?? (globalThis as { location?: { href?: string } }).location?.href;
  if (!base) throw new Error("No location to load the speech model from");
  return { baseUrl: new URL("models/deepfilternet3/", base).toString() };
}

export function createInlineEnhanceBackend(model: () => Dfn3ModelSource = getEnhanceModelSource): EnhanceBackend {
  let handlerPromise: Promise<EnhanceHandler> | null = null;
  const getHandler = (): Promise<EnhanceHandler> => (handlerPromise ??= import("./enhance-worker-core").then((mod) => mod.createEnhanceHandler()));
  let nextId = 1;
  return {
    enhance(channels, sampleRate, options = {}) {
      const seconds = (channels[0]?.length ?? 0) / Math.max(1, sampleRate);
      if (seconds > INLINE_ENHANCE_MAX_SECONDS) return Promise.reject(new Error(`inline speech enhancement is limited to ${INLINE_ENHANCE_MAX_SECONDS}s`));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const onAbort = () => void getHandler().then((handler) => handler.handle({ id, kind: "cancel" }, () => undefined));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        void getHandler()
          .then((handler) =>
            handler.handle({ id, kind: "enhance", channels: channels.map((c) => c.slice()), sampleRate, model: model() }, (response) => {
              if (response.kind === "progress") options.onProgress?.(response.fraction);
              else if (response.kind === "done") resolve(response.channels);
              else reject(response.cancelled ? new EnhanceCancelledError() : new Error(response.message));
            }),
          )
          .catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))))
          .finally(() => options.signal?.removeEventListener("abort", onAbort));
      });
    },
  };
}

export function createWorkerEnhanceBackend(model: () => Dfn3ModelSource = getEnhanceModelSource): EnhanceBackend | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (channels: Float32Array[]) => void; reject: (error: Error) => void; onProgress?: (fraction: number) => void }>();
  const failAll = (error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const ensure = (): Worker => {
    if (worker) return worker;
    const created = new Worker(new URL("./enhance.worker.ts", import.meta.url), { type: "module", name: "openreel-enhance-speech" });
    created.onmessage = (event: MessageEvent<EnhanceResponse>) => {
      const response = event.data;
      const job = pending.get(response.id);
      if (!job) return;
      if (response.kind === "progress") {
        job.onProgress?.(response.fraction);
        return;
      }
      pending.delete(response.id);
      if (response.kind === "done") job.resolve(response.channels);
      else job.reject(response.cancelled ? new EnhanceCancelledError() : new Error(response.message));
    };
    created.onerror = () => failAll(new Error("speech enhancement worker failed"));
    worker = created;
    return created;
  };
  return {
    enhance(channels, sampleRate, options = {}) {
      return new Promise((resolve, reject) => {
        try {
          const id = nextId++;
          pending.set(id, { resolve, reject, onProgress: options.onProgress });
          const copies = channels.map((channel) => channel.slice());
          const request: EnhanceRequest = { id, kind: "enhance", channels: copies, sampleRate, model: model() };
          options.signal?.addEventListener("abort", () => worker?.postMessage({ id, kind: "cancel" } satisfies EnhanceRequest), { once: true });
          ensure().postMessage(request, copies.map((c) => c.buffer));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

let shared: EnhanceBackend | null = null;

/** The shared backend: the worker when available, falling back to the inline one after a worker failure (never after a cancel). */
export function getEnhanceBackend(): EnhanceBackend {
  if (shared) return shared;
  const worker = createWorkerEnhanceBackend();
  const inline = createInlineEnhanceBackend();
  shared = worker
    ? {
        enhance: (channels, sampleRate, options) =>
          worker.enhance(channels, sampleRate, options).catch((error: unknown) => {
            if (error instanceof EnhanceCancelledError || options?.signal?.aborted) throw error;
            return inline.enhance(channels, sampleRate, options);
          }),
      }
    : inline;
  return shared;
}

/** Test / host hook: replaces the shared backend. */
export function setEnhanceBackend(backend: EnhanceBackend | null): void {
  shared = backend;
}
