/**
 * Byte-budgeted LRU of downscaled decoded video frames used while the playhead
 * is being dragged. Seeking a long-GOP clip through an HTMLVideoElement costs
 * ~100 ms per frame (decode from the previous keyframe), so a scrub that
 * revisits a frame it already decoded can be answered immediately. Frames are
 * stored small (the paused/settled render always re-decodes at full quality).
 */
import { ByteBudgetCache } from "@openreel/core/device/byte-budget-cache";

export interface CachedFrame {
  readonly width: number;
  readonly height: number;
  close(): void;
}

export class ScrubFrameCache<T extends CachedFrame = ImageBitmap> {
  private readonly cache: ByteBudgetCache<string, T>;

  constructor(maxBytes: number) {
    this.cache = new ByteBudgetCache<string, T>(maxBytes, {
      sizeOf: ScrubFrameCache.byteSize,
      dispose: (frame) => frame.close(),
    });
  }

  static byteSize(frame: CachedFrame): number {
    return frame.width * frame.height * 4;
  }

  get size(): number {
    return this.cache.size;
  }

  get byteLength(): number {
    return this.cache.byteLength;
  }

  get maxBytes(): number {
    return this.cache.maxBytes;
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  /** Takes ownership of `frame`; evicted/replaced/oversized frames are closed. */
  set(key: string, frame: T): void {
    this.cache.set(key, frame);
  }

  /** Resizes the budget (device memory probe); frames over the new budget are closed now. */
  setMaxBytes(maxBytes: number): void {
    this.cache.setBudget(maxBytes);
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Frame-accurate cache key: one entry per source frame of one media blob. */
export function scrubFrameKey(
  blobId: number,
  mediaTimeSeconds: number,
  frameRate: number,
): string {
  return `${blobId}:${Math.round(mediaTimeSeconds * Math.max(1, frameRate))}`;
}

const blobIds = new WeakMap<object, number>();
let nextBlobId = 1;
/** Stable small id for a Blob so replaced media never serves stale frames. */
export function blobIdentity(blob: object): number {
  let id = blobIds.get(blob);
  if (id === undefined) {
    id = nextBlobId++;
    blobIds.set(blob, id);
  }
  return id;
}

/** Cached scrub frames are at most `maxWidth` wide and never upscaled. */
export function scrubCacheSize(
  width: number,
  height: number,
  maxWidth = 960,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((maxWidth * height) / width)) };
}
