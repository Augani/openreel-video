export interface FrameBitmapLike {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export interface MotionFrameCacheOptions {
  readonly maxBytes?: number;
}

export interface CachedRange {
  readonly start: number;
  readonly end: number;
}

const DEFAULT_MAX_BYTES = 384 * 1024 * 1024;

function assertValidIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`MotionFrameCache: index must be a non-negative integer, received ${index}`);
  }
}

function bitmapBytes(bitmap: FrameBitmapLike): number {
  return bitmap.width * bitmap.height * 4;
}

export class MotionFrameCache<T extends FrameBitmapLike = ImageBitmap> {
  private readonly frames = new Map<number, T>();
  private readonly maxBytes: number;
  private bytes = 0;
  private lastAccessIndex = 0;
  private disposed = false;

  constructor(options: MotionFrameCacheOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new Error(`MotionFrameCache: maxBytes must be a positive number, received ${maxBytes}`);
    }
    this.maxBytes = maxBytes;
  }

  get frameCount(): number {
    return this.frames.size;
  }

  get byteEstimate(): number {
    return this.bytes;
  }

  has(index: number): boolean {
    assertValidIndex(index);
    return this.frames.has(index);
  }

  getFrame(index: number): T | undefined {
    assertValidIndex(index);
    const frame = this.frames.get(index);
    if (frame === undefined) {
      return undefined;
    }
    this.lastAccessIndex = index;
    return frame;
  }

  setFrame(index: number, bitmap: T): void {
    assertValidIndex(index);
    const existing = this.frames.get(index);
    if (existing === bitmap) {
      this.lastAccessIndex = index;
      return;
    }
    if (existing !== undefined) {
      this.bytes -= bitmapBytes(existing);
      existing.close();
    }
    this.frames.set(index, bitmap);
    this.bytes += bitmapBytes(bitmap);
    this.lastAccessIndex = index;
    this.evictToBudget(index);
  }

  cachedRanges(): ReadonlyArray<CachedRange> {
    if (this.frames.size === 0) {
      return [];
    }
    const indices = [...this.frames.keys()].sort((a, b) => a - b);
    const ranges: CachedRange[] = [];
    let start = indices[0];
    let prev = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      const current = indices[i];
      if (current === prev + 1) {
        prev = current;
        continue;
      }
      ranges.push({ start, end: prev });
      start = current;
      prev = current;
    }
    ranges.push({ start, end: prev });
    return ranges;
  }

  invalidateAll(): void {
    for (const frame of this.frames.values()) {
      frame.close();
    }
    this.frames.clear();
    this.bytes = 0;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.invalidateAll();
  }

  private evictToBudget(protectedIndex: number): void {
    if (this.bytes <= this.maxBytes) {
      return;
    }
    const candidates = [...this.frames.keys()]
      .filter((index) => index !== protectedIndex)
      .sort(
        (a, b) => Math.abs(b - this.lastAccessIndex) - Math.abs(a - this.lastAccessIndex),
      );
    for (const index of candidates) {
      if (this.bytes <= this.maxBytes) {
        return;
      }
      const frame = this.frames.get(index);
      if (frame === undefined) {
        continue;
      }
      this.bytes -= bitmapBytes(frame);
      frame.close();
      this.frames.delete(index);
    }
  }
}

export interface ResolvedPreviewFrame {
  readonly index: number;
  readonly cached: boolean;
}

export function resolvePreviewFrame<T extends FrameBitmapLike>(
  cache: MotionFrameCache<T>,
  time: number,
  fps: number,
): ResolvedPreviewFrame {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`resolvePreviewFrame: fps must be a positive finite number, received ${fps}`);
  }
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
  const index = Math.floor(safeTime * fps);
  return { index, cached: cache.has(index) };
}

export function drawAndMaybeCache<T extends FrameBitmapLike>(
  cache: MotionFrameCache<T>,
  index: number,
  bitmap: T,
  draw: (bitmap: T) => void,
): void {
  draw(bitmap);
  if (cache.has(index)) {
    bitmap.close();
    return;
  }
  cache.setFrame(index, bitmap);
}

export interface FrameCacheInvalidationKey {
  readonly id: string;
  readonly modifiedAt: number;
  readonly width: number;
  readonly height: number;
  readonly quality: string;
}

export function shouldInvalidateFrameCache(
  prev: FrameCacheInvalidationKey,
  next: FrameCacheInvalidationKey,
): boolean {
  return (
    prev.id !== next.id ||
    prev.modifiedAt !== next.modifiedAt ||
    prev.width !== next.width ||
    prev.height !== next.height ||
    prev.quality !== next.quality
  );
}
