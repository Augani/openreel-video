interface CachedTexture {
  texture: GPUTexture;
  lastUsed: number;
  size: number;
  clipId: string;
  frameTime: number;
}

interface TextureCacheConfig {
  maxSize?: number;
  onEvict?: (entry: CachedTexture) => void;
}

const DEFAULT_MAX_SIZE = 500 * 1024 * 1024;

function getCacheKey(clipId: string, frameTime: number): string {
  return `${clipId}:${frameTime.toFixed(6)}`;
}

export class TextureCache {
  private cache: Map<string, CachedTexture> = new Map();
  private maxSize: number;
  private currentSize: number = 0;
  private onEvict?: (entry: CachedTexture) => void;

  constructor(config: TextureCacheConfig = {}) {
    this.maxSize = config.maxSize ?? DEFAULT_MAX_SIZE;
    this.onEvict = config.onEvict;
  }

  get(clipId: string, frameTime: number): GPUTexture | null {
    const key = getCacheKey(clipId, frameTime);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }
    entry.lastUsed = Date.now();
    return entry.texture;
  }

  set(
    clipId: string,
    frameTime: number,
    texture: GPUTexture,
    size: number,
  ): void {
    const key = getCacheKey(clipId, frameTime);
    if (this.cache.has(key)) {
      this.evictKey(key);
    }

    // Evict entries until we have room for the new texture
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }
    const entry: CachedTexture = {
      texture,
      lastUsed: Date.now(),
      size,
      clipId,
      frameTime,
    };

    this.cache.set(key, entry);
    this.currentSize += size;
  }

  evict(clipId: string): void {
    const keysToRemove: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.clipId === clipId) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      this.evictKey(key);
    }
  }

  evictLRU(): void {
    if (this.cache.size === 0) {
      return;
    }

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.evictKey(oldestKey);
    }
  }

  private evictKey(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }

    // Notify callback before destroying
    if (this.onEvict) {
      this.onEvict(entry);
    }

    // Destroy the GPU texture
    entry.texture.destroy();
    this.currentSize -= entry.size;
    this.cache.delete(key);
  }

  clear(): void {
    for (const [key] of this.cache.entries()) {
      this.evictKey(key);
    }
  }

  getMemoryUsage(): number {
    return this.currentSize;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  getCount(): number {
    return this.cache.size;
  }

  has(clipId: string, frameTime: number): boolean {
    const key = getCacheKey(clipId, frameTime);
    return this.cache.has(key);
  }

  getEntriesForClip(clipId: string): CachedTexture[] {
    const entries: CachedTexture[] = [];
    for (const entry of this.cache.values()) {
      if (entry.clipId === clipId) {
        entries.push(entry);
      }
    }
    return entries;
  }

  getAllEntries(): CachedTexture[] {
    return Array.from(this.cache.values());
  }
}

export function calculateTextureSize(
  width: number,
  height: number,
  format: string = "rgba8unorm",
): number {
  // Bytes per pixel based on format
  const bytesPerPixel: Record<string, number> = {
    rgba8unorm: 4,
    rgba8snorm: 4,
    rgba16float: 8,
    rgba32float: 16,
    bgra8unorm: 4,
    r8unorm: 1,
    rg8unorm: 2,
  };

  const bpp = bytesPerPixel[format] ?? 4;
  return width * height * bpp;
}
