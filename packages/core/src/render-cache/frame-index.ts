import {
  framesInRange,
  framesToRuns,
  type FrameRange,
  type TimeRange,
} from "./time-ranges";

export interface FrameIndexPutResult {
  readonly stored: boolean;
  /** Frames dropped to stay inside the byte budget. */
  readonly evicted: readonly number[];
}

interface Entry {
  bytes: number;
  used: number;
}

/**
 * Byte-budgeted LRU bookkeeping for rendered cache frames. Holds no pixels,
 * only which frame indices exist, how big they are and when they were last
 * used; the bytes live in a ChunkStore.
 */
export class FrameIndex {
  private readonly entries = new Map<number, Entry>();
  private totalBytes = 0;
  private clock = 0;

  constructor(
    private maxBytes: number,
    private frameRate: number,
  ) {}

  get bytes(): number {
    return this.totalBytes;
  }

  get count(): number {
    return this.entries.size;
  }

  get budget(): number {
    return this.maxBytes;
  }

  get fps(): number {
    return this.frameRate;
  }

  setFrameRate(frameRate: number): void {
    this.frameRate = frameRate;
  }

  setBudget(maxBytes: number): number[] {
    this.maxBytes = maxBytes;
    return this.evictToBudget(() => false);
  }

  has(frame: number): boolean {
    return this.entries.has(frame);
  }

  bytesOf(frame: number): number {
    return this.entries.get(frame)?.bytes ?? 0;
  }

  touch(frame: number): void {
    const entry = this.entries.get(frame);
    if (entry) entry.used = ++this.clock;
  }

  /**
   * Record a stored frame. Frames matching `isProtected` (the range currently
   * being rendered) are never evicted; when nothing else can be evicted the
   * frame is refused so a render job cannot eat its own output.
   */
  put(
    frame: number,
    bytes: number,
    isProtected: (frame: number) => boolean = () => false,
  ): FrameIndexPutResult {
    if (bytes > this.maxBytes) return { stored: false, evicted: [] };
    const existing = this.entries.get(frame);
    if (existing) this.totalBytes -= existing.bytes;
    this.entries.set(frame, { bytes, used: ++this.clock });
    this.totalBytes += bytes;
    const evicted = this.evictToBudget((f) => f === frame || isProtected(f));
    if (this.totalBytes > this.maxBytes) {
      this.entries.delete(frame);
      this.totalBytes -= bytes;
      return { stored: false, evicted };
    }
    return { stored: true, evicted };
  }

  remove(frame: number): boolean {
    const entry = this.entries.get(frame);
    if (!entry) return false;
    this.entries.delete(frame);
    this.totalBytes -= entry.bytes;
    return true;
  }

  /** Drop every frame whose render time lies in any of the ranges. */
  invalidateRanges(ranges: readonly TimeRange[]): number[] {
    const removed: number[] = [];
    for (const range of ranges) {
      const span = framesInRange(range, this.frameRate);
      if (!span) continue;
      if (span.end - span.start > this.entries.size) {
        for (const frame of Array.from(this.entries.keys())) {
          if (frame >= span.start && frame <= span.end && this.remove(frame)) removed.push(frame);
        }
      } else {
        for (let frame = span.start; frame <= span.end; frame++) {
          if (this.remove(frame)) removed.push(frame);
        }
      }
    }
    return removed;
  }

  clear(): number[] {
    const frames = Array.from(this.entries.keys());
    this.entries.clear();
    this.totalBytes = 0;
    return frames;
  }

  frames(): number[] {
    return Array.from(this.entries.keys()).sort((a, b) => a - b);
  }

  /** Maximal inclusive runs of consecutive cached frames. */
  cachedRuns(): FrameRange[] {
    return framesToRuns(this.entries.keys());
  }

  private evictToBudget(isProtected: (frame: number) => boolean): number[] {
    const evicted: number[] = [];
    if (this.totalBytes <= this.maxBytes) return evicted;
    const candidates = Array.from(this.entries.entries())
      .filter(([frame]) => !isProtected(frame))
      .sort((a, b) => a[1].used - b[1].used);
    for (const [frame, entry] of candidates) {
      if (this.totalBytes <= this.maxBytes) break;
      this.entries.delete(frame);
      this.totalBytes -= entry.bytes;
      evicted.push(frame);
    }
    return evicted;
  }
}
