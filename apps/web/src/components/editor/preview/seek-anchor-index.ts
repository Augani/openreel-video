/**
 * Byte-budgeted store of seek anchors (sparse low-res frames, see core
 * `sampleSeekAnchors`) grouped per media blob. Anchor sets are only useful as a
 * whole, so the budget evicts the least recently used *blob*, closing every
 * bitmap it owns.
 */
export interface AnchorFrame {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface BlobAnchors<T extends AnchorFrame> {
  /** Sorted ascending. */
  times: number[];
  frames: Map<number, T>;
  bytes: number;
}

export interface NearestAnchor<T extends AnchorFrame> {
  readonly time: number;
  readonly frame: T;
}

export class SeekAnchorIndex<T extends AnchorFrame = ImageBitmap> {
  private readonly blobs = new Map<number, BlobAnchors<T>>();
  private bytes = 0;

  constructor(private maxBytes: number) {}

  get budgetBytes(): number {
    return this.maxBytes;
  }

  /** Resizes the budget (media memory budget changed) and evicts least recently used blobs if it shrank. */
  setMaxBytes(maxBytes: number): void {
    this.maxBytes = Math.max(0, maxBytes);
    this.evict(-1);
  }

  get byteLength(): number {
    return this.bytes;
  }

  get blobCount(): number {
    return this.blobs.size;
  }

  count(blobId: number): number {
    return this.blobs.get(blobId)?.times.length ?? 0;
  }

  /** Takes ownership of `frame` (closed if rejected, replaced or evicted). */
  add(blobId: number, time: number, frame: T): void {
    const size = frame.width * frame.height * 4;
    if (size > this.maxBytes) {
      frame.close();
      return;
    }
    let entry = this.blobs.get(blobId);
    if (!entry) {
      entry = { times: [], frames: new Map(), bytes: 0 };
      this.blobs.set(blobId, entry);
    } else {
      // Refresh recency (Map iterates in insertion order).
      this.blobs.delete(blobId);
      this.blobs.set(blobId, entry);
    }
    const previous = entry.frames.get(time);
    if (previous) {
      previous.close();
      const delta = previous.width * previous.height * 4;
      entry.bytes -= delta;
      this.bytes -= delta;
    } else {
      const at = lowerBound(entry.times, time);
      entry.times.splice(at, 0, time);
    }
    entry.frames.set(time, frame);
    entry.bytes += size;
    this.bytes += size;
    this.evict(blobId);
  }

  /**
   * Nearest anchor to `time` within `maxDistance` seconds, preferring the one
   * at or before `time` when two are equally close. Refreshes blob recency.
   */
  nearest(
    blobId: number,
    time: number,
    maxDistance = Number.POSITIVE_INFINITY,
  ): NearestAnchor<T> | null {
    const entry = this.blobs.get(blobId);
    if (!entry || entry.times.length === 0) return null;
    const at = lowerBound(entry.times, time);
    const after = entry.times[at];
    const before = at > 0 ? entry.times[at - 1] : undefined;
    let best: number | undefined;
    if (before === undefined) best = after;
    else if (after === undefined) best = before;
    else best = time - before <= after - time ? before : after;
    if (best === undefined || Math.abs(best - time) > maxDistance) return null;
    const frame = entry.frames.get(best);
    if (!frame) return null;
    this.blobs.delete(blobId);
    this.blobs.set(blobId, entry);
    return { time: best, frame };
  }

  deleteBlob(blobId: number): void {
    const entry = this.blobs.get(blobId);
    if (!entry) return;
    for (const frame of entry.frames.values()) frame.close();
    this.bytes -= entry.bytes;
    this.blobs.delete(blobId);
  }

  clear(): void {
    for (const id of [...this.blobs.keys()]) this.deleteBlob(id);
    this.bytes = 0;
  }

  private evict(keep: number): void {
    while (this.bytes > this.maxBytes) {
      const oldest = this.blobs.keys().next();
      if (oldest.done) break;
      if (oldest.value === keep) {
        // Only the blob being filled is left and it alone exceeds the budget:
        // drop its oldest-time anchors from the far end instead of itself.
        const entry = this.blobs.get(keep);
        if (!entry || entry.times.length <= 1) break;
        const victimTime = entry.times.pop() as number;
        const victim = entry.frames.get(victimTime);
        entry.frames.delete(victimTime);
        if (victim) {
          const size = victim.width * victim.height * 4;
          entry.bytes -= size;
          this.bytes -= size;
          victim.close();
        }
        continue;
      }
      this.deleteBlob(oldest.value);
    }
  }
}

function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
