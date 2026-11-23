import { fingerprintAudioBuffer } from "../enhance/enhance-cache";
import { REDUCE_REVERB_MODEL_ID, ReverbCancelledError, type ReduceReverbParams } from "./reverb-params";
import { getReverbBackend, type ReverbBackend, type ReverbResult } from "./reverb-worker-client";

/**
 * Cached, off-thread Reduce Reverb of a decoded source buffer, shared by the live preview and the export mixdown.
 *
 * One job per source CONTENT (a fingerprint of the samples, not the AudioBuffer object) and parameter pair, so the preview's
 * decode and the export's decode of the same file share the result. The preview uses {@link peek} and swaps the processed buffer
 * in when {@link request} resolves; the export awaits it. Jobs are keyed per (source, settings): two clips of one file with
 * different Amounts each get their own job and both complete (nothing is cancelled behind a caller's back; a caller that
 * wants a job gone calls {@link cancel} with that setting). At most `maxConcurrent` jobs run at once, the rest wait their turn.
 */

export type ReverbBufferFactory = (channels: Float32Array[], sampleRate: number) => AudioBuffer;

export interface ReduceReverbRequest {
  readonly buffer: AudioBuffer;
  readonly params: ReduceReverbParams;
}

export type ReverbJobState = "idle" | "running" | "ready" | "failed";

export interface ReverbJobStatus {
  readonly state: ReverbJobState;
  readonly fraction: number;
  readonly error?: string;
  /** The room decay the blind estimate found (seconds) and its confidence, once ready. */
  readonly rt60?: number;
  readonly confidence?: number;
}

export const REVERB_FAILURE_TTL_MS = 30_000;
/** Finished results kept (each is as large as its source). */
export const REVERB_MAX_READY_ENTRIES = 3;
/** Jobs that process at once (each holds a copy of its source and a worker pass); the rest queue. */
export const REVERB_MAX_CONCURRENT_JOBS = 2;

export interface ReduceReverbCacheOptions {
  readonly backend?: ReverbBackend;
  readonly makeBuffer: ReverbBufferFactory;
  readonly modelId?: string;
  readonly now?: () => number;
  readonly maxReadyEntries?: number;
  readonly maxConcurrent?: number;
}

interface Job {
  readonly controller: AbortController;
  readonly promise: Promise<AudioBuffer | null>;
  fraction: number;
}

interface Entry {
  readonly key: string;
  readonly source: string;
  result?: AudioBuffer;
  rt60?: number;
  confidence?: number;
  job?: Job;
  failure?: { until: number; message: string };
}

export class ReduceReverbCache {
  private readonly explicitBackend: ReverbBackend | undefined;
  private makeBuffer: ReverbBufferFactory;
  private readonly now: () => number;
  private readonly maxReady: number;
  private readonly maxConcurrent: number;
  private active = 0;
  private readonly waiting: Array<{ start: () => void }> = [];
  private modelId: string;
  private readonly fingerprints = new WeakMap<AudioBuffer, string>();
  /** Insertion order = recency (touched entries are re-inserted). */
  private readonly entries = new Map<string, Entry>();
  private readonly readyListeners = new Set<(request: ReduceReverbRequest, result: AudioBuffer) => void>();
  private readonly statusListeners = new Set<(buffer: AudioBuffer, status: ReverbJobStatus) => void>();

  constructor(options: ReduceReverbCacheOptions) {
    this.explicitBackend = options.backend;
    this.makeBuffer = options.makeBuffer;
    this.now = options.now ?? Date.now;
    this.maxReady = options.maxReadyEntries ?? REVERB_MAX_READY_ENTRIES;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? REVERB_MAX_CONCURRENT_JOBS);
    this.modelId = options.modelId ?? REDUCE_REVERB_MODEL_ID;
  }

  setBufferFactory(factory: ReverbBufferFactory): void {
    this.makeBuffer = factory;
  }

  /** The algorithm identity is part of every key: changing it invalidates everything computed with the old one. */
  setModelId(modelId: string): void {
    this.modelId = modelId;
  }

  private get backend(): ReverbBackend {
    return this.explicitBackend ?? getReverbBackend();
  }

  private sourceOf(buffer: AudioBuffer): string {
    let fingerprint = this.fingerprints.get(buffer);
    if (!fingerprint) this.fingerprints.set(buffer, (fingerprint = fingerprintAudioBuffer(buffer)));
    return `${this.modelId}|${fingerprint}`;
  }

  private keyOf(buffer: AudioBuffer, params: ReduceReverbParams): { key: string; source: string } {
    const source = this.sourceOf(buffer);
    return { key: `${source}|a${params.amount.toFixed(1)}|s${params.sensitivity.toFixed(1)}`, source };
  }

  private touch(entry: Entry): void {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    const ready = [...this.entries.values()].filter((candidate) => candidate.result && !candidate.job);
    for (let i = 0; i < ready.length - this.maxReady; i += 1) this.entries.delete(ready[i].key);
  }

  /** The processed buffer, or null when it is not (yet) available or Amount is 0. Never computes anything. */
  peek(request: ReduceReverbRequest): AudioBuffer | null {
    if (request.params.amount <= 0) return null;
    return this.entries.get(this.keyOf(request.buffer, request.params).key)?.result ?? null;
  }

  /** Where the job for this source and setting stands (for progress UI). */
  status(buffer: AudioBuffer, params: ReduceReverbParams): ReverbJobStatus {
    const entry = this.entries.get(this.keyOf(buffer, params).key);
    if (!entry) return { state: "idle", fraction: 0 };
    if (entry.job) return { state: "running", fraction: entry.job.fraction };
    if (entry.result) return { state: "ready", fraction: 1, ...(entry.rt60 !== undefined ? { rt60: entry.rt60, confidence: entry.confidence } : {}) };
    if (entry.failure && entry.failure.until > this.now()) return { state: "failed", fraction: 0, error: entry.failure.message };
    return { state: "idle", fraction: 0 };
  }

  onReady(listener: (request: ReduceReverbRequest, result: AudioBuffer) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  onStatus(listener: (buffer: AudioBuffer, status: ReverbJobStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** The cache key of a source and setting: equal keys share one job and one result. */
  jobKey(buffer: AudioBuffer, params: ReduceReverbParams): string {
    return this.keyOf(buffer, params).key;
  }

  /**
   * Cancels the running (or queued) jobs of this source, or only the one for `params` when given (their requests resolve null).
   * Nothing is cached or remembered as a failure.
   */
  cancel(buffer: AudioBuffer, params?: ReduceReverbParams): boolean {
    const source = this.sourceOf(buffer);
    const only = params ? this.keyOf(buffer, params).key : undefined;
    let any = false;
    for (const entry of this.entries.values()) {
      if (entry.source === source && entry.job && (only === undefined || entry.key === only)) {
        entry.job.controller.abort();
        any = true;
      }
    }
    return any;
  }

  /** Forgets remembered failures for this source so the next request tries again straight away. */
  clearFailure(buffer: AudioBuffer): void {
    const source = this.sourceOf(buffer);
    for (const entry of this.entries.values()) if (entry.source === source) entry.failure = undefined;
  }

  /** Starts (or joins) the job. Resolves with the processed buffer, the source itself when Amount is 0, or null on failure, cancellation or supersession. */
  request(request: ReduceReverbRequest, options: { readonly onProgress?: (fraction: number) => void } = {}): Promise<AudioBuffer | null> {
    const { buffer, params } = request;
    if (params.amount <= 0) return Promise.resolve(buffer);
    const { key, source } = this.keyOf(buffer, params);
    let entry = this.entries.get(key);
    if (entry?.result) {
      this.touch(entry);
      return Promise.resolve(entry.result);
    }
    if (entry?.job) {
      options.onProgress?.(entry.job.fraction);
      return entry.job.promise;
    }
    if (entry?.failure && entry.failure.until > this.now()) return Promise.resolve(null);
    if (!entry) this.entries.set(key, (entry = { key, source }));
    const target = entry;
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    const controller = new AbortController();
    const job: Job = { controller, fraction: 0, promise: Promise.resolve(null) };
    target.job = job;
    this.emitStatus(buffer, { state: "running", fraction: 0 });
    const start = (release: () => void): Promise<ReverbResult> => {
      if (controller.signal.aborted) {
        release();
        return Promise.reject(new ReverbCancelledError());
      }
      return this.backend
        .reduce(channels, buffer.sampleRate, params, {
          signal: controller.signal,
          onProgress: (fraction) => {
            job.fraction = fraction;
            options.onProgress?.(fraction);
            this.emitStatus(buffer, { state: "running", fraction });
          },
        })
        .finally(release);
    };
    // A free slot starts the backend call in this very turn (so a caller sees it begin at once); a busy one queues.
    const free = this.tryAcquire();
    const promise = (free ? start(free) : this.waitForSlot(controller.signal).then(start))
      .then((result) => {
        target.result = this.makeBuffer(result.channels, buffer.sampleRate);
        target.rt60 = result.rt60;
        target.confidence = result.confidence;
        target.failure = undefined;
        return target.result;
      })
      .catch((error: unknown) => {
        if (!(error instanceof ReverbCancelledError) && !controller.signal.aborted) {
          target.failure = { until: this.now() + REVERB_FAILURE_TTL_MS, message: error instanceof Error ? error.message : String(error) };
        }
        return null;
      })
      .finally(() => {
        target.job = undefined;
        if (!target.result && !target.failure) this.entries.delete(target.key);
        else this.touch(target);
      });
    (job as { promise: Promise<AudioBuffer | null> }).promise = promise;
    return promise.then((result) => {
      if (!result) {
        this.emitStatus(buffer, { state: target.failure ? "failed" : "idle", fraction: 0, ...(target.failure ? { error: target.failure.message } : {}) });
        return null;
      }
      this.emitStatus(buffer, { state: "ready", fraction: 1, rt60: target.rt60, confidence: target.confidence });
      for (const listener of [...this.readyListeners]) listener(request, result);
      return result;
    });
  }

  private tryAcquire(): (() => void) | null {
    if (this.active >= this.maxConcurrent || this.waiting.length > 0) return null;
    this.active += 1;
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.pump();
    };
  }

  /** Waits in the queue for a processing slot; rejects with a cancellation if aborted while queued. */
  private waitForSlot(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new ReverbCancelledError());
      const waiter = {
        start: () => {
          signal.removeEventListener("abort", onAbort);
          this.active += 1;
          resolve(this.releaser());
        },
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new ReverbCancelledError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.waiting.length > 0) this.waiting.shift()?.start();
  }

  private emitStatus(buffer: AudioBuffer, status: ReverbJobStatus): void {
    for (const listener of [...this.statusListeners]) listener(buffer, status);
  }
}

let sharedCache: ReduceReverbCache | null = null;

/** The process-wide cache used by preview and export, so a result computed for one is reused by the other. */
export function getSharedReduceReverbCache(makeBuffer: ReverbBufferFactory): ReduceReverbCache {
  if (!sharedCache) sharedCache = new ReduceReverbCache({ makeBuffer });
  else sharedCache.setBufferFactory(makeBuffer);
  return sharedCache;
}
