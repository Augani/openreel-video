/**
 * Streaming xxHash64 (seed 0) in plain JavaScript, so the copy verifier can offer xxHash without a native
 * dependency. 64-bit lanes are kept as two 32-bit halves (BigInt arithmetic was measured at about a third of the speed:
 * roughly 250 MB/s here against 700 MB/s for Node's native MD5 on one core).
 * It is a non-cryptographic checksum: right for catching a bad copy, not for security. Checked against the
 * reference vectors and a BigInt reference implementation in test/xxhash64.test.ts.
 */
const P1H = 0x9e3779b1 | 0, P1L = 0x85ebca87 | 0;
const P2H = 0xc2b2ae3d | 0, P2L = 0x27d4eb4f | 0;
const P3H = 0x165667b1 | 0, P3L = 0x9e3779f9 | 0;
const P4H = 0x85ebca77 | 0, P4L = 0xc2b2ae63 | 0;
const P5H = 0x27d4eb2f | 0, P5L = 0x165667c5 | 0;

// Result registers of the 64-bit helpers (avoids allocating a pair per operation).
let rh = 0;
let rl = 0;

/** (ah:al) * (bh:bl) mod 2^64 into rh:rl. */
function mul(ah: number, al: number, bh: number, bl: number): void {
  const a0 = al & 0xffff, a1 = al >>> 16, b0 = bl & 0xffff, b1 = bl >>> 16;
  const mid = a0 * b1 + a1 * b0;
  const midHi = Math.floor(mid / 65536);
  const low = a0 * b0 + (mid - midHi * 65536) * 65536;
  rl = low | 0;
  rh = (a1 * b1 + midHi + Math.floor(low / 4294967296) + Math.imul(ah, bl) + Math.imul(al, bh)) | 0;
}

function add(ah: number, al: number, bh: number, bl: number): void {
  const lo = (al >>> 0) + (bl >>> 0);
  rl = lo | 0;
  rh = (ah + bh + (lo > 0xffffffff ? 1 : 0)) | 0;
}

function rotl(h: number, l: number, r: number): void {
  rh = ((h << r) | (l >>> (32 - r))) | 0;
  rl = ((l << r) | (h >>> (32 - r))) | 0;
}

/** acc = rotl(acc + input * P2, 31) * P1, returned in rh:rl. */
function round(accH: number, accL: number, inH: number, inL: number): void {
  mul(inH, inL, P2H, P2L);
  add(accH, accL, rh, rl);
  rotl(rh, rl, 31);
  mul(rh, rl, P1H, P1L);
}

export class XxHash64 {
  private v1h = 0; private v1l = 0; private v2h = 0; private v2l = 0;
  private v3h = 0; private v3l = 0; private v4h = 0; private v4l = 0;
  private total = 0;
  private buf = Buffer.alloc(32);
  private bufLen = 0;

  constructor() {
    add(P1H, P1L, P2H, P2L);
    this.v1h = rh; this.v1l = rl;
    this.v2h = P2H; this.v2l = P2L;
    // v4 = -P1 (mod 2^64)
    const nl = (~P1L + 1) | 0;
    this.v4h = ((~P1H | 0) + (nl === 0 ? 1 : 0)) | 0;
    this.v4l = nl;
  }

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
    round(this.v1h, this.v1l, b.readInt32LE(o + 4), b.readInt32LE(o)); this.v1h = rh; this.v1l = rl;
    round(this.v2h, this.v2l, b.readInt32LE(o + 12), b.readInt32LE(o + 8)); this.v2h = rh; this.v2l = rl;
    round(this.v3h, this.v3l, b.readInt32LE(o + 20), b.readInt32LE(o + 16)); this.v3h = rh; this.v3l = rl;
    round(this.v4h, this.v4l, b.readInt32LE(o + 28), b.readInt32LE(o + 24)); this.v4h = rh; this.v4l = rl;
  }

  /** 16 lower-case hex digits. */
  digest(): string {
    let hh: number, hl: number;
    if (this.total >= 32) {
      rotl(this.v1h, this.v1l, 1); let ah = rh, al = rl;
      rotl(this.v2h, this.v2l, 7); add(ah, al, rh, rl); ah = rh; al = rl;
      rotl(this.v3h, this.v3l, 12); add(ah, al, rh, rl); ah = rh; al = rl;
      rotl(this.v4h, this.v4l, 18); add(ah, al, rh, rl); hh = rh; hl = rl;
      for (const [vh, vl] of [[this.v1h, this.v1l], [this.v2h, this.v2l], [this.v3h, this.v3l], [this.v4h, this.v4l]]) {
        // h = (h ^ round(0, v)) * P1 + P4
        round(0, 0, vh, vl);
        hh = (hh ^ rh) | 0; hl = (hl ^ rl) | 0;
        mul(hh, hl, P1H, P1L);
        add(rh, rl, P4H, P4L);
        hh = rh; hl = rl;
      }
    } else {
      hh = P5H; hl = P5L;
    }
    add(hh, hl, Math.floor(this.total / 4294967296) | 0, this.total | 0);
    hh = rh; hl = rl;
    const b = this.buf;
    let p = 0;
    const end = this.bufLen;
    while (p + 8 <= end) {
      round(0, 0, b.readInt32LE(p + 4), b.readInt32LE(p));
      hh = (hh ^ rh) | 0; hl = (hl ^ rl) | 0;
      rotl(hh, hl, 27);
      mul(rh, rl, P1H, P1L);
      add(rh, rl, P4H, P4L);
      hh = rh; hl = rl;
      p += 8;
    }
    if (p + 4 <= end) {
      mul(0, b.readInt32LE(p), P1H, P1L);
      hh = (hh ^ rh) | 0; hl = (hl ^ rl) | 0;
      rotl(hh, hl, 23);
      mul(rh, rl, P2H, P2L);
      add(rh, rl, P3H, P3L);
      hh = rh; hl = rl;
      p += 4;
    }
    while (p < end) {
      mul(0, b[p], P5H, P5L);
      hh = (hh ^ rh) | 0; hl = (hl ^ rl) | 0;
      rotl(hh, hl, 11);
      mul(rh, rl, P1H, P1L);
      hh = rh; hl = rl;
      p++;
    }
    // avalanche
    hl = (hl ^ ((hh >>> 1) | 0)) | 0; // h ^= h >> 33: only the low half changes (shift by 32 + 1)
    mul(hh, hl, P2H, P2L); hh = rh; hl = rl;
    hl = (hl ^ ((hl >>> 29) | (hh << 3))) | 0; hh = (hh ^ (hh >>> 29)) | 0; // h ^= h >> 29
    mul(hh, hl, P3H, P3L); hh = rh; hl = rl;
    hl = (hl ^ hh) | 0; // h ^= h >> 32
    return (hh >>> 0).toString(16).padStart(8, "0") + (hl >>> 0).toString(16).padStart(8, "0");
  }
}

export const xxh64 = (data: Uint8Array): string => new XxHash64().update(data).digest();
