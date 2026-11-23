import { DFN3_MODEL_ID, EnhanceCancelledError } from "./enhance-constants";
import { mixDryWet, remixSpeechBackground, sanitizeEnhanceBalance, sanitizeEnhanceMix } from "./enhance-effect";
import { getEnhanceBackend, type EnhanceBackend } from "./enhance-worker-client";

/**
 * Cached, off-thread speech enhancement of a decoded source buffer, shared by the live preview and the export mixdown.
 *
 * The expensive part (the network) runs once per source CONTENT and model and is cached as the fully enhanced "wet"
 * buffer; the Mix amount is blended from that cached result per request, so sliding Mix never re-runs the model and
 * the preview and the export play identical samples for the same mix. Entries are keyed by a fingerprint of the
 * samples (not the AudioBuffer object), so the preview's decode and the export's decode of the same file share one
 * job. The preview uses {@link peek} and swaps in the enhanced buffer when {@link request} resolves; the export awaits it.
 */

export type EnhanceBufferFactory = (channels: Float32Array[], sampleRate: number) => AudioBuffer;

export interface EnhanceSpeechRequest {
  readonly buffer: AudioBuffer;
  /** 0..100. 0 means "off": the source itself is returned and no job is started. */
  readonly mix: number;
  /** Speech / Background balance 0..100 (default 100 = speech only). Remixed from the cached stems; never re-runs the model. */
  readonly balance?: number;
}

export type EnhanceJobState = "idle" | "running" | "ready" | "failed";

export interface EnhanceJobStatus {
  readonly state: EnhanceJobState;
  /** 0..1 while running. */
  readonly fraction: number;
  readonly error?: string;
}

/** How long a failed source is remembered before a new attempt is made. */
export const ENHANCE_FAILURE_TTL_MS = 30_000;
/** Finished enhancements kept (each is as large as its source). */
export const ENHANCE_MAX_READY_ENTRIES = 3;

export interface EnhanceSpeechCacheOptions {
  readonly backend?: EnhanceBackend;
  readonly makeBuffer: EnhanceBufferFactory;
  readonly modelId?: string;
  readonly now?: () => number;
  readonly maxReadyEntries?: number;
  readonly maxMixesPerEntry?: number;
}

/** Content identity of a decoded buffer: shape plus two independent 32-bit hashes over every sample bit pattern. */
export function fingerprintAudioBuffer(buffer: AudioBuffer): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    const bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < bits.length; i += 1) {
      const v = bits[i];
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 + v, 0x85ebca6b) ^ (h2 >>> 13);
    }
  }
  return `${buffer.numberOfChannels}x${buffer.length}@${buffer.sampleRate}:${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`;
}

interface Job {
  readonly controller: AbortController;
  readonly promise: Promise<AudioBuffer | null>;
  fraction: number;
}

interface Entry {
  readonly key: string;
  wet?: AudioBuffer;
  job?: Job;
  failure?: { until: number; message: string };
  readonly mixed: Map<string, AudioBuffer>;
}

export class EnhanceSpeechCache {
  private readonly explicitBackend: EnhanceBackend | undefined;
  private makeBuffer: EnhanceBufferFactory;
  private readonly now: () => number;
  private readonly maxReady: number;
  private readonly maxMixes: number;
  private modelId: string;
  private readonly fingerprints = new WeakMap<AudioBuffer, string>();
  /** Insertion order = recency (touched entries are re-inserted). */
  private readonly entries = new Map<string, Entry>();
  private readonly readyListeners = new Set<(request: EnhanceSpeechRequest, result: AudioBuffer) => void>();
  private readonly statusListeners = new Set<(buffer: AudioBuffer, status: EnhanceJobStatus) => void>();

  constructor(options: EnhanceSpeechCacheOptions) {
    this.explicitBackend = options.backend;
    this.makeBuffer = options.makeBuffer;
    this.now = options.now ?? Date.now;
    this.maxReady = options.maxReadyEntries ?? ENHANCE_MAX_READY_ENTRIES;
    this.maxMixes = options.maxMixesPerEntry ?? 8;
    this.modelId = options.modelId ?? DFN3_MODEL_ID;
  }

  setBufferFactory(factory: EnhanceBufferFactory): void {
    this.makeBuffer = factory;
  }

  /** The model identity is part of every key: changing it invalidates everything computed with the old one. */
  setModelId(modelId: string): void {
    this.modelId = modelId;
  }

  private get backend(): EnhanceBackend {
    return this.explicitBackend ?? getEnhanceBackend();
  }

  private keyOf(buffer: AudioBuffer): string {
    let fingerprint = this.fingerprints.get(buffer);
    if (!fingerprint) this.fingerprints.set(buffer, (fingerprint = fingerprintAudioBuffer(buffer)));
    return `${this.modelId}|${fingerprint}`;
  }

  private find(buffer: AudioBuffer): Entry | undefined {
    return this.entries.get(this.keyOf(buffer));
  }

  private touch(entry: Entry): void {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    const ready = [...this.entries.values()].filter((candidate) => candidate.wet && !candidate.job);
    for (let i = 0; i < ready.length - this.maxReady; i += 1) this.entries.delete(ready[i].key);
  }

  /** The enhanced (and mixed) buffer, or null when it is not (yet) available or the effect is off. Never computes anything. */
  peek(request: EnhanceSpeechRequest): AudioBuffer | null {
    if (sanitizeEnhanceMix(request.mix) <= 0) return null;
    const entry = this.find(request.buffer);
    return entry?.wet ? this.blend(entry, request.buffer, request.mix, request.balance) : null;
  }

  /** Where the job for this source stands (for progress UI). */
  status(buffer: AudioBuffer): EnhanceJobStatus {
    const entry = this.find(buffer);
    if (!entry) return { state: "idle", fraction: 0 };
    if (entry.job) return { state: "running", fraction: entry.job.fraction };
    if (entry.wet) return { state: "ready", fraction: 1 };
    if (entry.failure && entry.failure.until > this.now()) return { state: "failed", fraction: 0, error: entry.failure.message };
    return { state: "idle", fraction: 0 };
  }

  onReady(listener: (request: EnhanceSpeechRequest, result: AudioBuffer) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  onStatus(listener: (buffer: AudioBuffer, status: EnhanceJobStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Cancels the running job for this source (every request joined to it resolves null). Nothing is cached or remembered as a failure. */
  cancel(buffer: AudioBuffer): boolean {
    const job = this.find(buffer)?.job;
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  /** Forgets a remembered failure so the next request tries again straight away. */
  clearFailure(buffer: AudioBuffer): void {
    const entry = this.find(buffer);
    if (entry) entry.failure = undefined;
  }

  /**
   * Starts (or joins) the job. Resolves with the enhanced buffer blended at `mix`, the source itself when the effect
   * is off, or null on failure or cancellation (`status().error` says why; undefined means cancelled).
   */
  request(request: EnhanceSpeechRequest, options: { readonly onProgress?: (fraction: number) => void } = {}): Promise<AudioBuffer | null> {
    const { buffer } = request;
    if (sanitizeEnhanceMix(request.mix) <= 0) return Promise.resolve(buffer);
    const key = this.keyOf(buffer);
    let entry = this.entries.get(key);
    if (entry?.wet) {
      this.touch(entry);
      return Promise.resolve(this.blend(entry, buffer, request.mix, request.balance));
    }
    if (entry?.job) {
      const joined = entry.job;
      if (options.onProgress) options.onProgress(joined.fraction);
      return joined.promise.then((wet) => (wet && entry ? this.blend(entry, buffer, request.mix, request.balance) : null));
    }
    if (entry?.failure && entry.failure.until > this.now()) return Promise.resolve(null);
    if (!entry) this.entries.set(key, (entry = { key, mixed: new Map() }));
    const target = entry;
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    const controller = new AbortController();
    const job: Job = { controller, fraction: 0, promise: Promise.resolve(null) };
    target.job = job;
    this.emitStatus(buffer, { state: "running", fraction: 0 });
    const promise = this.backend
      .enhance(channels, buffer.sampleRate, {
        signal: controller.signal,
        onProgress: (fraction) => {
          job.fraction = fraction;
          options.onProgress?.(fraction);
          this.emitStatus(buffer, { state: "running", fraction });
        },
      })
      .then((enhanced) => {
        target.wet = this.makeBuffer(enhanced, buffer.sampleRate);
        target.failure = undefined;
        return target.wet;
      })
      .catch((error: unknown) => {
        if (!(error instanceof EnhanceCancelledError) && !controller.signal.aborted) {
          target.failure = { until: this.now() + ENHANCE_FAILURE_TTL_MS, message: error instanceof Error ? error.message : String(error) };
        }
        return null;
      })
      .finally(() => {
        target.job = undefined;
        if (!target.wet && !target.failure) this.entries.delete(target.key);
        else this.touch(target);
      });
    (job as { promise: Promise<AudioBuffer | null> }).promise = promise;
    return promise.then((wet) => {
      if (!wet) {
        this.emitStatus(buffer, { state: target.failure ? "failed" : "idle", fraction: 0, ...(target.failure ? { error: target.failure.message } : {}) });
        return null;
      }
      const out = this.blend(target, buffer, request.mix, request.balance);
      this.emitStatus(buffer, { state: "ready", fraction: 1 });
      for (const listener of [...this.readyListeners]) listener(request, out);
      return out;
    });
  }

  private emitStatus(buffer: AudioBuffer, status: EnhanceJobStatus): void {
    for (const listener of [...this.statusListeners]) listener(buffer, status);
  }

  private blend(entry: Entry, source: AudioBuffer, mix: number, balance?: number): AudioBuffer {
    const wet = entry.wet as AudioBuffer;
    const stems = sanitizeEnhanceBalance(balance);
    if (sanitizeEnhanceMix(mix) >= 100 && stems >= 100) return wet;
    // The legacy key (the mix alone) is kept for the default balance.
    const key = stems >= 100 ? sanitizeEnhanceMix(mix).toFixed(1) : `${sanitizeEnhanceMix(mix).toFixed(1)}|b${stems.toFixed(1)}`;
    const cached = entry.mixed.get(key);
    if (cached) return cached;
    const dry: Float32Array[] = [];
    const processed: Float32Array[] = [];
    for (let c = 0; c < source.numberOfChannels; c += 1) {
      dry.push(source.getChannelData(c));
      processed.push(wet.getChannelData(Math.min(c, wet.numberOfChannels - 1)));
    }
    const out = this.makeBuffer(mixDryWet(dry, remixSpeechBackground(dry, processed, stems), mix), source.sampleRate);
    if (entry.mixed.size >= this.maxMixes) {
      const oldest = entry.mixed.keys().next().value;
      if (oldest !== undefined) entry.mixed.delete(oldest);
    }
    entry.mixed.set(key, out);
    return out;
  }
}

let sharedCache: EnhanceSpeechCache | null = null;

/** The process-wide cache used by preview and export, so an enhancement computed for one is reused by the other. */
export function getSharedEnhanceSpeechCache(makeBuffer: EnhanceBufferFactory): EnhanceSpeechCache {
  if (!sharedCache) sharedCache = new EnhanceSpeechCache({ makeBuffer });
  else sharedCache.setBufferFactory(makeBuffer);
  return sharedCache;
}
