import type { SpectralView, SpectralViewOptions } from "./spectral-dsp";
import type { SpectralRegion } from "./spectral-regions";
import type { SpectralRequest, SpectralResponse } from "./spectral-worker-core";

/**
 * Where spectral work runs: a module Web Worker in the browser (nothing heavy on the main thread),
 * a deferred inline call where workers do not exist. Both execute the same handler.
 */
export interface SpectralBackend {
  repair(channels: Float32Array[], sampleRate: number, regions: SpectralRegion[]): Promise<Float32Array[]>;
  /** Makes a mono source available to `view` under `key` (replaces an earlier load). */
  load(key: string, mono: Float32Array, sampleRate: number): Promise<void>;
  view(key: string, options: SpectralViewOptions): Promise<SpectralView>;
  drop(key: string): Promise<void>;
}

/** Longest source the main-thread fallback will repair; longer ones are refused so playback never stalls on it. */
export const INLINE_SPECTRAL_MAX_SECONDS = 120;

export function createInlineSpectralBackend(): SpectralBackend {
  let handler: Promise<(request: SpectralRequest) => SpectralResponse> | null = null;
  let nextId = 1;
  const run = async (request: (id: number) => SpectralRequest): Promise<SpectralResponse> => {
    handler ??= import("./spectral-worker-core").then((mod) => mod.createSpectralHandler());
    const handle = await handler;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const response = handle(request(nextId++));
    if (response.error) throw new Error(response.error);
    return response;
  };
  return {
    async repair(channels, sampleRate, regions) {
      const seconds = (channels[0]?.length ?? 0) / Math.max(1, sampleRate);
      if (seconds > INLINE_SPECTRAL_MAX_SECONDS) throw new Error(`inline spectral repair limited to ${INLINE_SPECTRAL_MAX_SECONDS}s`);
      return (await run((id) => ({ id, kind: "repair", channels, sampleRate, regions }))).channels ?? [];
    },
    async load(key, mono, sampleRate) {
      await run((id) => ({ id, kind: "load", key, mono, sampleRate }));
    },
    async view(key, options) {
      const response = await run((id) => ({ id, kind: "view", key, options }));
      if (!response.view) throw new Error("no spectrogram");
      return response.view;
    },
    async drop(key) {
      await run((id) => ({ id, kind: "drop", key }));
    },
  };
}

export function createWorkerSpectralBackend(): SpectralBackend | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (response: SpectralResponse) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const ensure = (): Worker => {
    if (worker) return worker;
    const created = new Worker(new URL("./spectral.worker.ts", import.meta.url), { type: "module", name: "openreel-spectral" });
    created.onmessage = (event: MessageEvent<SpectralResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error) job.reject(new Error(event.data.error));
      else job.resolve(event.data);
    };
    created.onerror = () => failAll(new Error("spectral worker failed"));
    worker = created;
    return created;
  };
  const call = (build: (id: number) => SpectralRequest, transfer: Transferable[]): Promise<SpectralResponse> =>
    new Promise((resolve, reject) => {
      try {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        ensure().postMessage(build(id), transfer);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  return {
    async repair(channels, sampleRate, regions) {
      const copies = channels.map((channel) => channel.slice());
      return (await call((id) => ({ id, kind: "repair", channels: copies, sampleRate, regions }), copies.map((c) => c.buffer))).channels ?? [];
    },
    async load(key, mono, sampleRate) {
      const copy = mono.slice();
      await call((id) => ({ id, kind: "load", key, mono: copy, sampleRate }), [copy.buffer]);
    },
    async view(key, options) {
      const response = await call((id) => ({ id, kind: "view", key, options }), []);
      if (!response.view) throw new Error("no spectrogram");
      return response.view;
    },
    async drop(key) {
      await call((id) => ({ id, kind: "drop", key }), []);
    },
  };
}

let shared: SpectralBackend | null = null;

/** The shared backend: the worker when available, falling back to the inline one after a worker failure. */
export function getSpectralBackend(): SpectralBackend {
  if (shared) return shared;
  const worker = createWorkerSpectralBackend();
  const inline = createInlineSpectralBackend();
  shared = worker
    ? {
        repair: (channels, sampleRate, regions) => worker.repair(channels, sampleRate, regions).catch(() => inline.repair(channels, sampleRate, regions)),
        load: (key, mono, sampleRate) => worker.load(key, mono, sampleRate).catch(() => inline.load(key, mono, sampleRate)),
        view: (key, options) => worker.view(key, options),
        drop: (key) => worker.drop(key).catch(() => undefined),
      }
    : inline;
  return shared;
}

/** Test / host hook: replaces the shared backend. */
export function setSpectralBackend(backend: SpectralBackend | null): void {
  shared = backend;
}
