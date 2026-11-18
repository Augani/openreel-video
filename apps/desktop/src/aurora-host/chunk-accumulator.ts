/**
 * Reassembles length-prefixed frames from stream chunks without the quadratic
 * `Buffer.concat([everything, chunk])` per chunk: an 8 MB RGBA response arrives
 * in ~64 KiB pipe reads, so concatenating on each read copied ~500 MB per frame.
 * Chunks are queued and copied exactly once when a complete frame is taken.
 */
export class ChunkAccumulator {
  private chunks: Buffer[] = [];
  private total = 0;

  get byteLength(): number {
    return this.total;
  }

  push(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.total += chunk.byteLength;
  }

  /** Little-endian uint32 at the front of the stream, or null if fewer than 4 bytes are buffered. */
  peekUInt32LE(): number | null {
    if (this.total < 4) return null;
    const head = Buffer.alloc(4);
    let copied = 0;
    for (const chunk of this.chunks) {
      const take = Math.min(4 - copied, chunk.byteLength);
      chunk.copy(head, copied, 0, take);
      copied += take;
      if (copied === 4) break;
    }
    return head.readUInt32LE(0);
  }

  /** Remove and return the first `length` bytes. Throws if not enough bytes are buffered. */
  take(length: number): Buffer {
    if (length > this.total) {
      throw new Error(`ChunkAccumulator holds ${this.total} bytes, ${length} requested.`);
    }
    if (length === 0) return Buffer.alloc(0);
    const first = this.chunks[0];
    if (first.byteLength === length) {
      this.chunks.shift();
      this.total -= length;
      return first;
    }
    const out = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const chunk = this.chunks[0];
      const need = length - written;
      if (chunk.byteLength <= need) {
        chunk.copy(out, written);
        written += chunk.byteLength;
        this.chunks.shift();
      } else {
        chunk.copy(out, written, 0, need);
        this.chunks[0] = chunk.subarray(need);
        written += need;
      }
    }
    this.total -= length;
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }
}
