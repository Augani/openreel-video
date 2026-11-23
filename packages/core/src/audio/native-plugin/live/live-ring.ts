/**
 * Single producer / single consumer ring of planar float32 frames, laid out in one (Shared)ArrayBuffer so the producer and the
 * consumer can be different threads (an AudioWorklet and a pump; a worker and the renderer). Positions are two monotonically
 * increasing 32 bit frame counters in an Int32Array header, read and written with Atomics, so neither side ever takes a lock
 * and neither allocates: this is what runs inside the audio thread.
 *
 *   header  [0] write counter (producer only)  [1] read counter (consumer only)  [2] frames dropped on overflow
 *   data    channel 0 capacity frames | channel 1 capacity frames | ...
 *
 * A counter wraps at 2^32; `(write - read) | 0` is the fill level while it stays below 2^31, which `capacity` guarantees.
 */

const HEADER_INTS = 4;
const HEADER_BYTES = HEADER_INTS * 4;

export interface LiveRingInit {
  readonly channels: number;
  readonly capacityFrames: number;
}

export const liveRingByteLength = ({ channels, capacityFrames }: LiveRingInit): number => HEADER_BYTES + channels * capacityFrames * 4;

export class LiveRing {
  readonly channels: number;
  readonly capacityFrames: number;
  private readonly header: Int32Array;
  private readonly data: Float32Array;

  private constructor(readonly buffer: ArrayBufferLike, channels: number, capacityFrames: number) {
    this.channels = channels;
    this.capacityFrames = capacityFrames;
    this.header = new Int32Array(buffer, 0, HEADER_INTS);
    this.data = new Float32Array(buffer, HEADER_BYTES, channels * capacityFrames);
  }

  /** `shared` allocates a SharedArrayBuffer when the realm has one (cross-origin isolated pages, Node); otherwise a plain buffer for same-thread use. */
  static create(init: LiveRingInit, shared = true): LiveRing {
    if (!Number.isInteger(init.channels) || init.channels < 1 || init.channels > 16) throw new RangeError("a ring holds 1 to 16 channels");
    if (!Number.isInteger(init.capacityFrames) || init.capacityFrames < 2) throw new RangeError("a ring holds at least 2 frames");
    const bytes = liveRingByteLength(init);
    const canShare = shared && typeof SharedArrayBuffer !== "undefined";
    return new LiveRing(canShare ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes), init.channels, init.capacityFrames);
  }

  /** The other end of a ring created elsewhere (the buffer was transferred or shared). */
  static attach(buffer: ArrayBufferLike, init: LiveRingInit): LiveRing {
    if (buffer.byteLength < liveRingByteLength(init)) throw new RangeError("the buffer is too small for this ring");
    return new LiveRing(buffer, init.channels, init.capacityFrames);
  }

  /** Frames waiting to be read. */
  available(): number {
    return (Atomics.load(this.header, 0) - Atomics.load(this.header, 1)) | 0;
  }

  /** Frames that can be written before the ring is full. */
  space(): number {
    return this.capacityFrames - this.available();
  }

  /** Frames the producer had to drop because the consumer was behind. */
  dropped(): number {
    return Atomics.load(this.header, 2) >>> 0;
  }

  /**
   * Producer: appends up to `frames` frames of `source` (one array per channel, starting at `offset`). Writes what fits and
   * returns the count; the rest is counted as dropped and never overwrites unread audio.
   */
  write(source: readonly Float32Array[], frames: number, offset = 0): number {
    const free = this.space();
    const count = Math.max(0, Math.min(frames, free));
    if (count < frames) Atomics.add(this.header, 2, frames - count);
    if (count === 0) return 0;
    const w = Atomics.load(this.header, 0) >>> 0;
    for (let c = 0; c < this.channels; c += 1) {
      const src = source[c] ?? source[0];
      const base = c * this.capacityFrames;
      for (let i = 0; i < count; i += 1) this.data[base + ((w + i) % this.capacityFrames)] = src[offset + i] ?? 0;
    }
    Atomics.store(this.header, 0, (w + count) | 0);
    return count;
  }

  /** Consumer: moves up to `frames` frames into `target` (starting at `offset`) and removes them. Returns the count read. */
  read(target: readonly Float32Array[], frames: number, offset = 0): number {
    const count = this.peek(target, frames, 0, offset);
    if (count > 0) Atomics.store(this.header, 1, (((Atomics.load(this.header, 1) >>> 0) + count) | 0));
    return count;
  }

  /** Consumer: copies without removing, starting `skip` frames after the read position. */
  peek(target: readonly Float32Array[], frames: number, skip = 0, offset = 0): number {
    const have = Math.max(0, this.available() - skip);
    const count = Math.max(0, Math.min(frames, have));
    if (count === 0) return 0;
    const r = ((Atomics.load(this.header, 1) >>> 0) + skip) >>> 0;
    for (let c = 0; c < Math.min(this.channels, target.length); c += 1) {
      const dst = target[c];
      const base = c * this.capacityFrames;
      for (let i = 0; i < count; i += 1) dst[offset + i] = this.data[base + ((r + i) % this.capacityFrames)];
    }
    return count;
  }

  /** Consumer: discards up to `frames` frames. */
  skip(frames: number): number {
    const count = Math.max(0, Math.min(frames, this.available()));
    if (count > 0) Atomics.store(this.header, 1, (((Atomics.load(this.header, 1) >>> 0) + count) | 0));
    return count;
  }

  /** Empties the ring. Call from the consumer side only. */
  clear(): void {
    Atomics.store(this.header, 1, Atomics.load(this.header, 0));
  }
}
