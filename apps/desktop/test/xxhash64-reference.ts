/**
 * TEST REFERENCE: the straightforward BigInt xxHash64 the fast implementation is checked against.
 * Streaming xxHash64 (seed 0) in plain JavaScript with BigInt, so the copy verifier can offer xxHash without
 * a native dependency. It is a non-cryptographic checksum: right for catching a bad copy, not for security.
 * BigInt arithmetic makes it slower than Node's built-in MD5 / SHA-256, which the copy dialog says.
 */
const MASK = 0xffffffffffffffffn;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;

const rotl = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (64n - r))) & MASK;
const round = (acc: bigint, input: bigint): bigint => (rotl((acc + input * P2) & MASK, 31n) * P1) & MASK;
const mergeRound = (acc: bigint, val: bigint): bigint => (((acc ^ round(0n, val)) * P1) + P4) & MASK;

export class XxHash64Reference {
  private v1 = (P1 + P2) & MASK;
  private v2 = P2;
  private v3 = 0n;
  private v4 = (0n - P1) & MASK;
  private total = 0;
  private buf = Buffer.alloc(32);
  private bufLen = 0;

  update(chunk: Uint8Array): this {
    let pos = 0;
    const len = chunk.length;
    this.total += len;
    if (this.bufLen + len < 32) {
      this.buf.set(chunk, this.bufLen);
      this.bufLen += len;
      return this;
    }
    if (this.bufLen > 0) {
      const take = 32 - this.bufLen;
      this.buf.set(chunk.subarray(0, take), this.bufLen);
      this.stripe(this.buf, 0);
      this.bufLen = 0;
      pos = take;
    }
    const view = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    while (pos + 32 <= len) {
      this.stripe(view, pos);
      pos += 32;
    }
    if (pos < len) {
      this.buf.set(chunk.subarray(pos), 0);
      this.bufLen = len - pos;
    }
    return this;
  }

  private stripe(b: Buffer, o: number): void {
    this.v1 = round(this.v1, b.readBigUInt64LE(o));
    this.v2 = round(this.v2, b.readBigUInt64LE(o + 8));
    this.v3 = round(this.v3, b.readBigUInt64LE(o + 16));
    this.v4 = round(this.v4, b.readBigUInt64LE(o + 24));
  }

  /** 16 lower-case hex digits. */
  digest(): string {
    let h: bigint;
    if (this.total >= 32) {
      h = (rotl(this.v1, 1n) + rotl(this.v2, 7n) + rotl(this.v3, 12n) + rotl(this.v4, 18n)) & MASK;
      h = mergeRound(h, this.v1);
      h = mergeRound(h, this.v2);
      h = mergeRound(h, this.v3);
      h = mergeRound(h, this.v4);
    } else {
      h = P5;
    }
    h = (h + BigInt(this.total)) & MASK;
    const b = this.buf;
    let p = 0;
    const end = this.bufLen;
    while (p + 8 <= end) {
      h ^= round(0n, b.readBigUInt64LE(p));
      h = ((rotl(h, 27n) * P1) + P4) & MASK;
      p += 8;
    }
    if (p + 4 <= end) {
      h ^= (BigInt(b.readUInt32LE(p)) * P1) & MASK;
      h = ((rotl(h, 23n) * P2) + P3) & MASK;
      p += 4;
    }
    while (p < end) {
      h ^= (BigInt(b[p]) * P5) & MASK;
      h = (rotl(h, 11n) * P1) & MASK;
      p++;
    }
    h ^= h >> 33n;
    h = (h * P2) & MASK;
    h ^= h >> 29n;
    h = (h * P3) & MASK;
    h ^= h >> 32n;
    return h.toString(16).padStart(16, "0");
  }
}

export const xxh64Reference = (data: Uint8Array): string => new XxHash64Reference().update(data).digest();
