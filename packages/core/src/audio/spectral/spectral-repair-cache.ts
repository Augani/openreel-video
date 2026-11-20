import { spectralRegionsKey, type SpectralRegion } from "./spectral-regions";
import { getSpectralBackend, type SpectralBackend } from "./spectral-worker-client";

/**
 * Cached, off-thread spectral repair of a decoded source buffer.
 *
 * A clip's "spectralRepair" regions are applied to the whole decoded source (regions are in source
 * time) once; the result is cached per source buffer and region set and shared by the live preview and
 * the export mixdown, so both play the very same samples. The preview uses {@link peek} and swaps
 * the repaired buffer in when {@link request} resolves; the export awaits {@link request}.
 */

export type SpectralBufferFactory = (channels: Float32Array[], sampleRate: number) => AudioBuffer;

export interface SpectralRepairRequest {
  readonly buffer: AudioBuffer;
  readonly regions: readonly SpectralRegion[];
}

/** How long a failed key is remembered before a new attempt is made. */
export const SPECTRAL_FAILURE_TTL_MS = 30_000;

export interface SpectralRepairCacheOptions {
  readonly backend?: SpectralBackend;
  readonly makeBuffer: SpectralBufferFactory;
  readonly now?: () => number;
  readonly maxEntriesPerBuffer?: number;
}

export class SpectralRepairCache {
  private readonly explicitBackend: SpectralBackend | undefined;
  private makeBuffer: SpectralBufferFactory;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly entries = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();
  private readonly jobs = new WeakMap<AudioBuffer, Map<string, Promise<AudioBuffer | null>>>();
  private readonly failures = new WeakMap<AudioBuffer, Map<string, number>>();
  private readonly listeners = new Set<(request: SpectralRepairRequest, result: AudioBuffer) => void>();

  constructor(options: SpectralRepairCacheOptions) {
    this.explicitBackend = options.backend;
    this.makeBuffer = options.makeBuffer;
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntriesPerBuffer ?? 6;
  }

  setBufferFactory(factory: SpectralBufferFactory): void {
    this.makeBuffer = factory;
  }

  private get backend(): SpectralBackend {
    return this.explicitBackend ?? getSpectralBackend();
  }

  /** The repaired buffer, or null when it is not (yet) available or there is nothing to repair. Never computes anything. */
  peek(request: SpectralRepairRequest): AudioBuffer | null {
    const key = spectralRegionsKey(request.regions);
    return key ? (this.entries.get(request.buffer)?.get(key) ?? null) : null;
  }

  onReady(listener: (request: SpectralRepairRequest, result: AudioBuffer) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts (or joins) the job. Resolves with the repaired buffer, the source itself when no region is active, or null on failure. */
  request(request: SpectralRepairRequest): Promise<AudioBuffer | null> {
    const key = spectralRegionsKey(request.regions);
    const { buffer } = request;
    if (!key) return Promise.resolve(buffer);
    const cached = this.entries.get(buffer)?.get(key);
    if (cached) return Promise.resolve(cached);
    let byKey = this.jobs.get(buffer);
    const running = byKey?.get(key);
    if (running) return running;
    const failedUntil = this.failures.get(buffer)?.get(key);
    if (failedUntil !== undefined && failedUntil > this.now()) return Promise.resolve(null);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    const regions = request.regions.map((region) => ({ ...region }));
    const job = this.backend
      .repair(channels, buffer.sampleRate, regions)
      .then((repaired) => {
        const out = this.makeBuffer(repaired, buffer.sampleRate);
        this.store(buffer, key, out);
        for (const listener of [...this.listeners]) listener(request, out);
        return out;
      })
      .catch(() => {
        let failed = this.failures.get(buffer);
        if (!failed) this.failures.set(buffer, (failed = new Map()));
        failed.set(key, this.now() + SPECTRAL_FAILURE_TTL_MS);
        return null;
      })
      .finally(() => {
        this.jobs.get(buffer)?.delete(key);
      });
    if (!byKey) this.jobs.set(buffer, (byKey = new Map()));
    byKey.set(key, job);
    return job;
  }

  private store(buffer: AudioBuffer, key: string, value: AudioBuffer): void {
    let byKey = this.entries.get(buffer);
    if (!byKey) this.entries.set(buffer, (byKey = new Map()));
    if (byKey.size >= this.maxEntries) {
      const oldest = byKey.keys().next().value;
      if (oldest !== undefined) byKey.delete(oldest);
    }
    byKey.set(key, value);
  }
}

let sharedCache: SpectralRepairCache | null = null;

/** The process-wide cache used by preview and export, so a repair computed for one is reused by the other. */
export function getSharedSpectralRepairCache(makeBuffer: SpectralBufferFactory): SpectralRepairCache {
  if (!sharedCache) sharedCache = new SpectralRepairCache({ makeBuffer });
  else sharedCache.setBufferFactory(makeBuffer);
  return sharedCache;
}
