import type { WaveformData, WaveformCacheEntry } from "./types";
import type { WaveformRecord, IStorageEngine } from "../storage/types";
import { MediaBunnyEngine, getMediaEngine } from "./mediabunny-engine";

interface WaveformGeneratorOptions {
  samplesPerSecond?: number;
  enableCaching?: boolean;
  signal?: AbortSignal;
}

interface MultiResolutionWaveform {
  mediaId: string;
  duration: number;
  resolutions: Map<number, WaveformData>;
}

const WAVEFORM_RESOLUTIONS = {
  OVERVIEW: 10,
  LOW: 50,
  MEDIUM: 100,
  HIGH: 200,
  MAX: 500,
} as const;

const DEFAULT_OPTIONS: Required<
  Pick<WaveformGeneratorOptions, "samplesPerSecond" | "enableCaching">
> = {
  samplesPerSecond: WAVEFORM_RESOLUTIONS.MEDIUM,
  enableCaching: true,
};

export class WaveformGenerator {
  private mediaEngine: MediaBunnyEngine;
  private storageEngine: IStorageEngine | null = null;
  private memoryCache: Map<string, WaveformCacheEntry> = new Map();
  private readonly MAX_MEMORY_CACHE_SIZE = 20;

  constructor(
    mediaEngine?: MediaBunnyEngine,
    storageEngine?: IStorageEngine | null,
  ) {
    this.mediaEngine = mediaEngine || getMediaEngine();
    this.storageEngine = storageEngine || null;
  }

  setStorageEngine(storageEngine: IStorageEngine): void {
    this.storageEngine = storageEngine;
  }

  async generateWaveform(
    file: File | Blob,
    mediaId: string,
    options: WaveformGeneratorOptions = {},
  ): Promise<WaveformData> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    opts.signal?.throwIfAborted();
    const memoryCached = this.memoryCache.get(mediaId);
    if (
      opts.enableCaching &&
      memoryCached &&
      memoryCached.data.samplesPerSecond === opts.samplesPerSecond
    ) {
      return memoryCached.data;
    }
    if (opts.enableCaching && this.storageEngine) {
      const cached = await this.loadFromCache(mediaId);
      opts.signal?.throwIfAborted();
      if (cached && cached.samplesPerSecond === opts.samplesPerSecond) {
        this.updateMemoryCache(mediaId, cached);
        return cached;
      }
    }
    const waveformData = await this.mediaEngine.generateWaveform(
      file,
      opts.samplesPerSecond,
      opts.signal,
    );
    opts.signal?.throwIfAborted();

    // Cache the result
    if (opts.enableCaching) {
      await this.saveToCache(mediaId, waveformData);
      opts.signal?.throwIfAborted();
      this.updateMemoryCache(mediaId, waveformData);
    }

    return waveformData;
  }

  async generateMultiResolutionWaveform(
    file: File | Blob,
    mediaId: string,
    resolutions: number[] = [
      WAVEFORM_RESOLUTIONS.OVERVIEW,
      WAVEFORM_RESOLUTIONS.MEDIUM,
      WAVEFORM_RESOLUTIONS.HIGH,
    ],
  ): Promise<MultiResolutionWaveform> {
    const result: MultiResolutionWaveform = {
      mediaId,
      duration: 0,
      resolutions: new Map(),
    };
    const sortedResolutions = [...resolutions].sort((a, b) => b - a);
    const highestRes = sortedResolutions[0];
    const highResWaveform = await this.generateWaveform(file, mediaId, {
      samplesPerSecond: highestRes,
      enableCaching: true,
    });

    result.duration = highResWaveform.duration;
    result.resolutions.set(highestRes, highResWaveform);

    // Downsample for lower resolutions
    for (let i = 1; i < sortedResolutions.length; i++) {
      const targetRes = sortedResolutions[i];
      const downsampled = this.downsampleWaveform(highResWaveform, targetRes);
      result.resolutions.set(targetRes, downsampled);
    }

    return result;
  }

  getWaveformForZoomLevel(
    multiRes: MultiResolutionWaveform,
    pixelsPerSecond: number,
  ): WaveformData | null {
    // We want roughly 1-2 samples per pixel for smooth rendering
    const idealSamplesPerSecond = Math.max(
      10,
      Math.min(500, pixelsPerSecond * 2),
    );
    let bestMatch: WaveformData | null = null;
    let bestDiff = Infinity;

    for (const [resolution, data] of multiRes.resolutions) {
      const diff = Math.abs(resolution - idealSamplesPerSecond);
      // Prefer higher resolution if close
      if (
        diff < bestDiff ||
        (diff === bestDiff && resolution > (bestMatch?.samplesPerSecond || 0))
      ) {
        bestDiff = diff;
        bestMatch = data;
      }
    }

    return bestMatch;
  }

  downsampleWaveform(
    source: WaveformData,
    targetSamplesPerSecond: number,
  ): WaveformData {
    if (targetSamplesPerSecond >= source.samplesPerSecond) {
      // No downsampling needed
      return source;
    }

    const ratio = source.samplesPerSecond / targetSamplesPerSecond;
    const targetLength = Math.ceil(source.peaks.length / ratio);

    const peaks = new Float32Array(targetLength);
    const rms = new Float32Array(targetLength);

    for (let i = 0; i < targetLength; i++) {
      const startIdx = Math.floor(i * ratio);
      const endIdx = Math.min(Math.floor((i + 1) * ratio), source.peaks.length);

      // For peaks, take the maximum value in the range
      let maxPeak = 0;
      let sumRmsSquares = 0;
      let count = 0;

      for (let j = startIdx; j < endIdx; j++) {
        maxPeak = Math.max(maxPeak, source.peaks[j]);
        sumRmsSquares += source.rms[j] * source.rms[j];
        count++;
      }

      peaks[i] = maxPeak;
      rms[i] = count > 0 ? Math.sqrt(sumRmsSquares / count) : 0;
    }

    return {
      peaks,
      rms,
      sampleRate: targetSamplesPerSecond,
      duration: source.duration,
      samplesPerSecond: targetSamplesPerSecond,
    };
  }

  getWaveformSlice(
    waveform: WaveformData,
    startTime: number,
    endTime: number,
  ): WaveformData {
    const startIdx = Math.max(
      0,
      Math.floor(startTime * waveform.samplesPerSecond),
    );
    const endIdx = Math.min(
      waveform.peaks.length,
      Math.ceil(endTime * waveform.samplesPerSecond),
    );

    return {
      peaks: waveform.peaks.slice(startIdx, endIdx),
      rms: waveform.rms.slice(startIdx, endIdx),
      sampleRate: waveform.sampleRate,
      duration: endTime - startTime,
      samplesPerSecond: waveform.samplesPerSecond,
    };
  }

  private async loadFromCache(mediaId: string): Promise<WaveformData | null> {
    if (!this.storageEngine) {
      return null;
    }

    try {
      const record = await this.storageEngine.loadWaveform(mediaId);
      if (!record) {
        return null;
      }

      return this.waveformRecordToData(record);
    } catch (error) {
      console.warn("Failed to load waveform from cache:", error);
      return null;
    }
  }

  private async saveToCache(
    mediaId: string,
    waveformData: WaveformData,
  ): Promise<void> {
    if (!this.storageEngine) {
      return;
    }

    try {
      const record = this.waveformDataToRecord(mediaId, waveformData);
      await this.storageEngine.saveWaveform(record);
    } catch (error) {
      console.warn("Failed to save waveform to cache:", error);
    }
  }

  private waveformRecordToData(record: WaveformRecord): WaveformData {
    // We need to reconstruct Float32Arrays
    const dataLength = record.data.length / 2;
    const peaks = new Float32Array(dataLength);
    const rms = new Float32Array(dataLength);

    for (let i = 0; i < dataLength; i++) {
      peaks[i] = record.data[i];
      rms[i] = record.data[dataLength + i];
    }
    const duration = dataLength / record.sampleRate;

    return {
      peaks,
      rms,
      sampleRate: record.sampleRate,
      duration,
      samplesPerSecond: record.sampleRate,
    };
  }

  private waveformDataToRecord(
    mediaId: string,
    waveformData: WaveformData,
  ): WaveformRecord {
    const data: number[] = [];
    for (let i = 0; i < waveformData.peaks.length; i++) {
      data.push(waveformData.peaks[i]);
    }
    for (let i = 0; i < waveformData.rms.length; i++) {
      data.push(waveformData.rms[i]);
    }

    return {
      mediaId,
      data,
      sampleRate: waveformData.samplesPerSecond,
    };
  }

  private updateMemoryCache(mediaId: string, data: WaveformData): void {
    // Evict oldest entry if cache is full
    if (this.memoryCache.size >= this.MAX_MEMORY_CACHE_SIZE) {
      let oldestKey = "";
      let oldestTime = Infinity;

      for (const [key, entry] of this.memoryCache.entries()) {
        if (entry.createdAt < oldestTime) {
          oldestTime = entry.createdAt;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(mediaId, {
      mediaId,
      data,
      createdAt: Date.now(),
    });
  }

  async clearCache(mediaId: string): Promise<void> {
    this.memoryCache.delete(mediaId);

    if (this.storageEngine) {
      try {
        await this.storageEngine.deleteWaveform(mediaId);
      } catch (error) {
        console.warn("Failed to delete waveform from cache:", error);
      }
    }
  }

  clearAllCache(): void {
    this.memoryCache.clear();
  }

  async isCached(mediaId: string): Promise<boolean> {
    if (this.memoryCache.has(mediaId)) {
      return true;
    }

    if (this.storageEngine) {
      const record = await this.storageEngine.loadWaveform(mediaId);
      return record !== null;
    }

    return false;
  }
}
let waveformGeneratorInstance: WaveformGenerator | null = null;

export function getWaveformGenerator(): WaveformGenerator {
  if (!waveformGeneratorInstance) {
    waveformGeneratorInstance = new WaveformGenerator();
  }
  return waveformGeneratorInstance;
}
