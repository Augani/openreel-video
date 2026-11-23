/**
 * Raw DEFLATE (RFC 1951) decoder, synchronous and dependency-free. It only unpacks the embedded
 * AAF dictionary template (see template.ts), so it favours size and clarity over speed.
 */

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman {
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

function buildHuffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

export function inflateRaw(input: Uint8Array, expectedSize = 0, maxOutput = Infinity): Uint8Array {
  let out = new Uint8Array(expectedSize > 0 ? expectedSize : input.length * 4);
  let outPos = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const bits = (n: number): number => {
    while (bitCount < n) {
      if (pos >= input.length) throw new Error("Unexpected end of deflate data.");
      bitBuf |= input[pos++] << bitCount;
      bitCount += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("Invalid Huffman code.");
  };
  const ensure = (extra: number): void => {
    if (outPos + extra > maxOutput) throw new Error("Deflate output exceeds the allowed size.");
    if (outPos + extra <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, outPos + extra));
    grown.set(out);
    out = grown;
  };

  const fixedLit = (() => {
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    return buildHuffman(l);
  })();
  const fixedDist = buildHuffman(new Uint8Array(30).fill(5));

  let final = 0;
  while (!final) {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCount = 0;
      const len = input[pos] | (input[pos + 1] << 8);
      pos += 4;
      ensure(len);
      out.set(input.subarray(pos, pos + len), outPos);
      pos += len;
      outPos += len;
      continue;
    }
    let lit = fixedLit;
    let dist = fixedDist;
    if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const clLengths = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clLengths[CODE_LENGTH_ORDER[i]] = bits(3);
      const clHuff = buildHuffman(clLengths);
      const lengths = new Uint8Array(hlit + hdist);
      let i = 0;
      while (i < lengths.length) {
        const sym = decode(clHuff);
        if (sym < 16) {
          lengths[i++] = sym;
        } else {
          let repeat: number;
          let value = 0;
          if (sym === 16) {
            if (i === 0) throw new Error("Invalid deflate repeat.");
            value = lengths[i - 1];
            repeat = 3 + bits(2);
          } else if (sym === 17) {
            repeat = 3 + bits(3);
          } else {
            repeat = 11 + bits(7);
          }
          while (repeat--) lengths[i++] = value;
        }
      }
      lit = buildHuffman(lengths.subarray(0, hlit));
      dist = buildHuffman(lengths.subarray(hlit));
    } else if (type !== 1) {
      throw new Error("Invalid deflate block.");
    }
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[outPos++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        const length = LENGTH_BASE[li] + bits(LENGTH_EXTRA[li]);
        const di = decode(dist);
        const distance = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        ensure(length);
        for (let k = 0; k < length; k++) {
          out[outPos] = out[outPos - distance];
          outPos++;
        }
      }
    }
  }
  return out.slice(0, outPos);
}
