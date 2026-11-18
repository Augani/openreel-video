import type { CfaColor } from "./dng";

/**
 * Writes synthetic DNG files with known content. It exists so the raw
 * pipeline can be tested numerically (known Bayer pattern in, known colours
 * out) and so end-to-end tests can import a camera file without shipping a
 * binary fixture. Not a general DNG authoring tool: one IFD, little endian,
 * RGB Bayer or LinearRaw.
 */

export interface DngWriteOptions {
  readonly width: number;
  readonly height: number;
  /** `width * height` samples for a CFA image, `width * height * 3` for LinearRaw. */
  readonly samples: Uint16Array;
  readonly linearRaw?: boolean;
  readonly cfa?: readonly [CfaColor, CfaColor, CfaColor, CfaColor];
  /** 8 to 16. Values are written packed MSB-first for anything other than 8 and 16. */
  readonly bitsPerSample?: number;
  readonly compression?: "none" | "lossless-jpeg";
  readonly tile?: { readonly width: number; readonly height: number };
  readonly rowsPerStrip?: number;
  readonly blackLevel?: number | readonly [number, number, number, number];
  readonly whiteLevel?: number;
  readonly colorMatrix1?: readonly number[];
  readonly colorMatrix2?: readonly number[];
  readonly forwardMatrix1?: readonly number[];
  readonly illuminant1?: number;
  readonly illuminant2?: number;
  readonly asShotNeutral?: readonly number[];
  readonly baselineExposure?: number;
  /** CinemaDNG FrameRate tag. */
  readonly frameRate?: number;
  readonly orientation?: number;
  readonly activeArea?: readonly [number, number, number, number];
  readonly cropOrigin?: readonly [number, number];
  readonly cropSize?: readonly [number, number];
  readonly make?: string;
  readonly model?: string;
}

// ---- lossless JPEG encoder (predictor 1, one fixed Huffman table) ----------

class BitWriter {
  readonly out: number[] = [];
  private acc = 0;
  private n = 0;
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >>> i) & 1);
      if (++this.n === 8) {
        this.out.push(this.acc);
        if (this.acc === 0xff) this.out.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush(): void {
    while (this.n !== 0) this.write(1, 1);
  }
}

/** Encodes interleaved samples (`width * components` per row) as lossless JPEG (SOF3). */
export function encodeLosslessJpeg(samples: Uint16Array, width: number, height: number, components: number, precision: number): Uint8Array {
  const bw = new BitWriter();
  const rowLen = width * components;
  const mask = 0xffff;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < components; c++) {
        const idx = y * rowLen + x * components + c;
        const pred = y === 0 && x === 0 ? 1 << (precision - 1) : y === 0 ? samples[idx - components] : x === 0 ? samples[idx - rowLen] : samples[idx - components];
        let diff = (samples[idx] - pred) & mask;
        if (diff >= 32768) diff -= 65536;
        if (diff === -32768) diff = 32768;
        const mag = Math.abs(diff);
        let s = 0;
        while (s < 16 && mag >> s) s++;
        bw.write(s, 5); // every category is a 5-bit code: the symbol value itself
        if (s > 0 && s < 16) bw.write(diff < 0 ? diff + (1 << s) - 1 : diff, s);
      }
    }
  }
  bw.flush();
  const header: number[] = [0xff, 0xd8];
  // DHT: 17 symbols (categories 0..16), all of length 5.
  const counts = new Array<number>(16).fill(0);
  counts[4] = 17;
  header.push(0xff, 0xc4, 0, 2 + 1 + 16 + 17, 0x00, ...counts, ...Array.from({ length: 17 }, (_, i) => i));
  header.push(0xff, 0xc3, 0, 8 + 3 * components, precision, height >> 8, height & 255, width >> 8, width & 255, components);
  for (let c = 0; c < components; c++) header.push(c + 1, 0x11, 0);
  header.push(0xff, 0xda, 0, 6 + 2 * components, components);
  for (let c = 0; c < components; c++) header.push(c + 1, 0x00);
  header.push(1, 0, 0);
  return Uint8Array.from([...header, ...bw.out, 0xff, 0xd9]);
}

function packSamples(samples: Uint16Array, bits: number): Uint8Array {
  if (bits === 16) {
    const out = new Uint8Array(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      out[i * 2] = samples[i] & 255; // TIFF data here is little endian
      out[i * 2 + 1] = samples[i] >> 8;
    }
    return out;
  }
  if (bits === 8) return Uint8Array.from(samples, (v) => v & 255);
  const raw: number[] = [];
  let acc = 0;
  let n = 0;
  for (const v of samples) {
    acc = (acc << bits) | v;
    n += bits;
    while (n >= 8) {
      raw.push((acc >> (n - 8)) & 255);
      n -= 8;
    }
    acc &= (1 << n) - 1;
  }
  if (n > 0) raw.push((acc << (8 - n)) & 255);
  return Uint8Array.from(raw);
}

// ---- TIFF assembly ----------------------------------------------------------

interface Entry {
  tag: number;
  type: number; // 1 byte, 2 ascii, 3 short, 4 long, 5 rational, 10 srational, 12 double
  values: number[] | string;
}

/** Bytes per element of `Entry.values` (rationals are stored as flattened numerator/denominator pairs). */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 10: 4 };
const valueCount = (e: { type: number; values: number[] | string }): number =>
  typeof e.values === "string" ? e.values.length + 1 : e.type === 5 || e.type === 10 ? e.values.length / 2 : e.values.length;

function fraction(v: number): [number, number] {
  const d = 1_000_000;
  return [Math.round(v * d), d];
}

export function writeDng(o: DngWriteOptions): Uint8Array<ArrayBuffer> {
  const bits = o.bitsPerSample ?? 16;
  const linear = o.linearRaw === true;
  const spp = linear ? 3 : 1;
  const compression = o.compression ?? "none";
  if (compression === "lossless-jpeg" && bits !== 16 && bits < 8) throw new Error("bad precision");
  const stride = o.width * spp;
  const chunks: Uint8Array[] = [];
  const tile = o.tile;
  const entries: Entry[] = [];
  const encodeBlock = (block: Uint16Array, bw: number, bh: number): Uint8Array => {
    if (compression === "lossless-jpeg") {
      // Bayer data is carried as 2 interleaved components of half width, like most cameras do.
      const comps = linear ? 3 : 2;
      const jw = linear ? bw : bw / 2;
      return encodeLosslessJpeg(block, jw, bh, comps, bits);
    }
    const rowBytes = Math.ceil((bw * spp * bits) / 8);
    const out = new Uint8Array(rowBytes * bh);
    for (let r = 0; r < bh; r++) out.set(packSamples(block.subarray(r * bw * spp, (r + 1) * bw * spp), bits), r * rowBytes);
    return out;
  };

  if (tile) {
    const across = Math.ceil(o.width / tile.width);
    const down = Math.ceil(o.height / tile.height);
    for (let ty = 0; ty < down; ty++)
      for (let tx = 0; tx < across; tx++) {
        const block = new Uint16Array(tile.width * tile.height * spp);
        for (let r = 0; r < tile.height; r++) {
          const sy = Math.min(ty * tile.height + r, o.height - 1);
          for (let c = 0; c < tile.width; c++) {
            const sx = Math.min(tx * tile.width + c, o.width - 1);
            for (let k = 0; k < spp; k++) block[(r * tile.width + c) * spp + k] = o.samples[sy * stride + sx * spp + k];
          }
        }
        chunks.push(encodeBlock(block, tile.width, tile.height));
      }
  } else {
    const rps = o.rowsPerStrip ?? o.height;
    for (let y = 0; y < o.height; y += rps) {
      const rows = Math.min(rps, o.height - y);
      chunks.push(encodeBlock(o.samples.subarray(y * stride, (y + rows) * stride), o.width, rows));
    }
  }

  const add = (tag: number, type: number, values: number[] | string) => entries.push({ tag, type, values });
  add(254, 4, [0]);
  add(256, 4, [o.width]);
  add(257, 4, [o.height]);
  add(258, 3, new Array<number>(spp).fill(bits));
  add(259, 3, [compression === "lossless-jpeg" ? 7 : 1]);
  add(262, 3, [linear ? 34892 : 32803]);
  if (o.make) add(271, 2, o.make);
  if (o.model) add(272, 2, o.model);
  add(274, 3, [o.orientation ?? 1]);
  add(277, 3, [spp]);
  add(284, 3, [1]);
  if (tile) {
    add(322, 4, [tile.width]);
    add(323, 4, [tile.height]);
  } else {
    add(278, 4, [o.rowsPerStrip ?? o.height]);
  }
  if (!linear) {
    add(33421, 3, [2, 2]);
    const cfa = o.cfa ?? [0, 1, 1, 2];
    add(33422, 1, [...cfa]);
  }
  add(50706, 1, [1, 4, 0, 0]);
  add(50707, 1, [1, 1, 0, 0]);
  add(50708, 2, `${o.make ?? "OpenReel"} ${o.model ?? "Synthetic"}`);
  if (o.frameRate) add(51044, 10, fraction(o.frameRate));
  const black = o.blackLevel ?? 0;
  if (typeof black === "number") add(50714, 3, [black]);
  else {
    add(50713, 3, [2, 2]);
    add(50714, 3, [...black]);
  }
  add(50717, 3, [o.whiteLevel ?? 2 ** bits - 1]);
  if (o.cropOrigin) add(50719, 5, o.cropOrigin.flatMap(fraction));
  if (o.cropSize) add(50720, 5, o.cropSize.flatMap(fraction));
  const matrixEntry = (tag: number, m: readonly number[] | undefined) => {
    if (m) add(tag, 10, m.flatMap(fraction));
  };
  matrixEntry(50721, o.colorMatrix1);
  matrixEntry(50722, o.colorMatrix2);
  if (o.asShotNeutral) add(50728, 5, o.asShotNeutral.flatMap(fraction));
  if (o.baselineExposure !== undefined) add(50730, 10, fraction(o.baselineExposure));
  if (o.illuminant1 !== undefined) add(50778, 3, [o.illuminant1]);
  if (o.illuminant2 !== undefined) add(50779, 3, [o.illuminant2]);
  if (o.activeArea) add(50829, 4, [...o.activeArea]);
  matrixEntry(50964, o.forwardMatrix1);
  // Image data pointers; values filled in once the layout is known.
  const dataTags = tile ? [324, 325] : [273, 279];
  add(dataTags[0], 4, new Array<number>(chunks.length).fill(0));
  add(dataTags[1], 4, chunks.map((c) => c.length));
  entries.sort((a, b) => a.tag - b.tag);

  const byteLength = (e: Entry): number =>
    typeof e.values === "string" ? e.values.length + 1 : e.values.length * TYPE_SIZE[e.type];
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraSize = 0;
  for (const e of entries) {
    const n = byteLength(e);
    if (n > 4) extraSize += n + (n & 1);
  }
  const dataStart = 8 + ifdSize + extraSize;
  let cursor = dataStart;
  const offsets = chunks.map((c) => {
    const at = cursor;
    cursor += c.length + (c.length & 1);
    return at;
  });
  entries.find((e) => e.tag === dataTags[0])!.values = offsets;

  const total = cursor;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  buf[0] = 0x49;
  buf[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, entries.length, true);
  let extraAt = 8 + ifdSize;
  entries.forEach((e, i) => {
    const at = 10 + i * 12;
    view.setUint16(at, e.tag, true);
    view.setUint16(at + 2, e.type, true);
    const count = valueCount(e);
    view.setUint32(at + 4, count, true);
    const n = byteLength(e);
    let dest = at + 8;
    if (n > 4) {
      view.setUint32(at + 8, extraAt, true);
      dest = extraAt;
      extraAt += n + (n & 1);
    }
    if (typeof e.values === "string") {
      for (let k = 0; k < e.values.length; k++) buf[dest + k] = e.values.charCodeAt(k);
      return;
    }
    e.values.forEach((v, k) => {
      const p = dest + k * TYPE_SIZE[e.type];
      switch (e.type) {
        case 1: buf[p] = v; break;
        case 3: view.setUint16(p, v, true); break;
        case 4: view.setUint32(p, v, true); break;
        case 5: view.setUint32(p, v, true); break;
        case 10: view.setInt32(p, v, true); break;
        default: break;
      }
    });
  });
  chunks.forEach((c, i) => buf.set(c, offsets[i]));
  return buf;
}
