import { timeStretchChannels } from "./time-stretch";
import type { StretchWorkerRequest, StretchWorkerResponse } from "./time-stretch.worker";

/**
 * Asynchronous, cached pitch-preserving time stretch.
 *
 * The WSOLA stretch is CPU heavy, so it runs through a {@link StretchRunner}: a
 * Web Worker in the browser (nothing runs on the main thread), a deferred inline
 * call where workers do not exist. Results are cached per source buffer, speed
 * and used source range, and concurrent requests for the same key share one job.
 * Callers that need audio right now use {@link StretchCache.peek} and keep
 * playing the resampled clip until {@link StretchCache.request} resolves.
 */

export type StretchRunner = (
  channels: Float32Array[],
  sampleRate: number,
  speed: number,
) => Promise<Float32Array[]>;

/** Longest range (seconds) the main-thread fallback will stretch; longer ranges are rejected so playback keeps resampling. */
export const INLINE_STRETCH_MAX_SECONDS = 60;

/** How long a failed key is remembered before a new attempt is made. */
export const STRETCH_FAILURE_TTL_MS = 30_000;

/** Fallback: yields to the event loop first, then stretches on the calling thread (bounded to avoid long main-thread stalls). */
export const inlineStretchRunner: StretchRunner = (channels, sampleRate, speed) =>
  new Promise((resolve, reject) => {
    const seconds = (channels[0]?.length ?? 0) / Math.max(1, sampleRate);
    if (seconds > INLINE_STRETCH_MAX_SECONDS) {
      reject(new Error(`inline time stretch limited to ${INLINE_STRETCH_MAX_SECONDS}s`));
      return;
    }
    setTimeout(() => {
      try {
        resolve(timeStretchChannels(channels, sampleRate, speed));
      } catch (error) {
        reject(error);
      }
    }, 0);
  });

/** One module worker, jobs matched by id. Null when workers are unavailable. */
export function createWorkerStretchRunner(): StretchRunner | null {
  if (typeof Worker === "undefined") return null;
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (channels: Float32Array[]) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  const ensure = (): Worker => {
    if (worker) return worker;
    const created = new Worker(new URL("./time-stretch.worker.ts", import.meta.url), { type: "module", name: "openreel-time-stretch" });
    created.onmessage = (event: MessageEvent<StretchWorkerResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.channels) job.resolve(event.data.channels);
      else job.reject(new Error(event.data.error ?? "time stretch failed"));
    };
    created.onerror = () => failAll(new Error("time stretch worker failed"));
    worker = created;
    return created;
  };
  return (channels, sampleRate, speed) =>
    new Promise((resolve, reject) => {
      try {
        const id = nextId++;
        const copies = channels.map((channel) => channel.slice());
        pending.set(id, { resolve, reject });
        const request: StretchWorkerRequest = { id, channels: copies, sampleRate, speed };
        ensure().postMessage(request, copies.map((channel) => channel.buffer));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
}

let defaultRunner: StretchRunner | null = null;

/** The shared runner: the worker when available, otherwise the deferred inline one (also after a worker failure). */
export function getDefaultStretchRunner(): StretchRunner {
  if (!defaultRunner) {
    const worker = createWorkerStretchRunner();
    defaultRunner = worker
      ? (channels, sampleRate, speed) => worker(channels, sampleRate, speed).catch(() => inlineStretchRunner(channels, sampleRate, speed))
      : inlineStretchRunner;
  }
  return defaultRunner;
}

export type StretchBufferFactory = (channels: Float32Array[], sampleRate: number) => AudioBuffer;

export interface StretchRequest {
  readonly buffer: AudioBuffer;
  readonly speed: number;
  /** Used source range in seconds, [start, end). */
  readonly start: number;
  readonly end: number;
}

export interface StretchCacheOptions {
  readonly runner?: StretchRunner;
  readonly makeBuffer: StretchBufferFactory;
  /** Clock used for failure expiry (tests). */
  readonly now?: () => number;
  /** Entries kept per source buffer (oldest evicted first). */
  readonly maxEntriesPerBuffer?: number;
  /** Longest source range (seconds) that is stretched at all. */
  readonly maxSeconds?: number;
}

export class StretchCache {
  private readonly runner: StretchRunner;
  private makeBuffer: StretchBufferFactory;
  private readonly maxEntries: number;
  private readonly maxSeconds: number;
  private readonly now: () => number;
  private readonly entries = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
  private readonly jobs = new WeakMap<AudioBuffer, Map<string, Promise<AudioBuffer | null>>>();
  private readonly failures = new WeakMap<AudioBuffer, Map<string, number>>();
  private readonly listeners = new Set<(request: StretchRequest, result: AudioBuffer) => void>();

  constructor(options: StretchCacheOptions) {
    this.runner = options.runner ?? getDefaultStretchRunner();
    this.makeBuffer = options.makeBuffer;
    this.maxEntries = options.maxEntriesPerBuffer ?? 8;
    this.maxSeconds = options.maxSeconds ?? 600;
    this.now = options.now ?? Date.now;
  }

  /** Buffers are built with the most recent factory (the graph that owns the live AudioContext). */
  setBufferFactory(factory: StretchBufferFactory): void {
    this.makeBuffer = factory;
  }

  private static key(request: StretchRequest, start: number, end: number): string {
    return `${request.speed}:${start.toFixed(4)}:${end.toFixed(4)}`;
  }

  private clamp(request: StretchRequest): { start: number; end: number; from: number; to: number } | null {
    const { buffer } = request;
    const start = Math.max(0, Math.min(buffer.duration, request.start));
    const end = Math.max(start, Math.min(buffer.duration, request.end));
    if (end - start <= 0 || end - start > this.maxSeconds) return null;
    const from = Math.floor(start * buffer.sampleRate);
    const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
    return to > from ? { start, end, from, to } : null;
  }

  /** The finished stretch, or null when it is not (yet) available. Never computes anything. */
  peek(request: StretchRequest): AudioBuffer | null {
    const range = this.clamp(request);
    if (!range) return null;
    return this.entries.get(request.buffer)?.get(StretchCache.key(request, range.start, range.end)) ?? null;
  }

  /** Called whenever a requested stretch finishes. Returns an unsubscribe function. */
  onReady(listener: (request: StretchRequest, result: AudioBuffer) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts (or joins) the job for this range. Resolves with the stretch, or null when it cannot be produced. */
  request(request: StretchRequest): Promise<AudioBuffer | null> {
    const range = this.clamp(request);
    if (!range) return Promise.resolve(null);
    const key = StretchCache.key(request, range.start, range.end);
    const cached = this.entries.get(request.buffer)?.get(key);
    if (cached) return Promise.resolve(cached);
    let byKey = this.jobs.get(request.buffer);
    const running = byKey?.get(key);
    if (running) return running;
    const failedUntil = this.failures.get(request.buffer)?.get(key);
    if (failedUntil !== undefined && failedUntil > this.now()) return Promise.resolve(null);
    const channels: Float32Array[] = [];
    for (let c = 0; c < request.buffer.numberOfChannels; c++) {
      channels.push(request.buffer.getChannelData(c).subarray(range.from, range.to));
    }
    const job = this.runner(channels, request.buffer.sampleRate, request.speed)
      .then((stretched) => {
        const out = this.makeBuffer(stretched, request.buffer.sampleRate);
        this.store(request.buffer, key, out);
        for (const listener of [...this.listeners]) listener(request, out);
        return out;
      })
      .catch(() => {
        let failed = this.failures.get(request.buffer);
        if (!failed) {
          failed = new Map();
          this.failures.set(request.buffer, failed);
        }
        failed.set(key, this.now() + STRETCH_FAILURE_TTL_MS);
        return null;
      })
      .finally(() => {
        this.jobs.get(request.buffer)?.delete(key);
      });
    if (!byKey) {
      byKey = new Map();
      this.jobs.set(request.buffer, byKey);
    }
    byKey.set(key, job);
    return job;
  }

  private store(buffer: AudioBuffer, key: string, value: AudioBuffer): void {
    let byKey = this.entries.get(buffer);
    if (!byKey) {
      byKey = new Map();
      this.entries.set(buffer, byKey);
    }
    if (byKey.size >= this.maxEntries) {
      const oldest = byKey.keys().next().value;
      if (oldest !== undefined) byKey.delete(oldest);
    }
    byKey.set(key, value);
  }
}

let sharedCache: StretchCache | null = null;

/**
 * The process-wide cache used by preview and export, so a stretch computed for one
 * (the realtime graph is recreated on play, an export follows a preview) is reused by the other.
 */
export function getSharedStretchCache(makeBuffer: StretchBufferFactory): StretchCache {
  if (!sharedCache) sharedCache = new StretchCache({ makeBuffer, maxEntriesPerBuffer: 8 });
  else sharedCache.setBufferFactory(makeBuffer);
  return sharedCache;
}
