import { RawDecodeError } from "./tiff";

/**
 * Lossless JPEG (ITU T.81 process SOF3) decoder. DNG compression 7 stores raw
 * sensor data this way: Huffman-coded prediction differences, 2 to 16 bit
 * precision, 1 to 4 interleaved components (a Bayer mosaic is typically two
 * components of half width, or four of quarter width).
 *
 * Output is the interleaved samples row by row: `width * components` values
 * per line, which for a DNG tile is the mosaic row itself.
 */

export interface LosslessJpegImage {
  readonly precision: number;
  readonly width: number;
  readonly height: number;
  readonly components: number;
  /** `width * components * height` samples. */
  readonly data: Uint16Array;
}

interface HuffTable {
  /** Indexed by the next 16 bits: (length << 8) | symbol. 0 means invalid. */
  readonly lookup: Uint16Array;
}

function buildHuffTable(counts: Uint8Array, symbols: Uint8Array): HuffTable {
  const lookup = new Uint16Array(65536);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) {
      const symbol = symbols[k++];
      if (symbol > 16) throw new RawDecodeError("Corrupt lossless JPEG: invalid difference category.");
      const first = code << (16 - len);
      const span = 1 << (16 - len);
      if (first + span > 65536) throw new RawDecodeError("Corrupt lossless JPEG: bad Huffman table.");
      const entry = (len << 8) | symbol;
      lookup.fill(entry, first, first + span);
      code++;
    }
    code <<= 1;
  }
  return { lookup };
}

class BitReader {
  private pos: number;
  private bits = 0;
  private count = 0;
  /** Set when a marker (not stuffing) was reached; zeros are fed afterwards. */
  hitMarker = false;

  constructor(private readonly data: Uint8Array, start: number) {
    this.pos = start;
  }

  private fill(): void {
    while (this.count <= 24) {
      let byte = 0;
      if (!this.hitMarker && this.pos < this.data.length) {
        byte = this.data[this.pos];
        if (byte === 0xff) {
          const next = this.data[this.pos + 1];
          if (next === 0x00) this.pos += 2;
          else this.hitMarker = true, byte = 0;
        } else this.pos++;
      }
      this.bits = (this.bits << 8) | byte;
      this.count += 8;
    }
  }

  /** The next 16 bits without consuming them. */
  peek16(): number {
    if (this.count < 16) this.fill();
    return (this.bits >>> (this.count - 16)) & 0xffff;
  }

  skip(n: number): void {
    this.count -= n;
  }

  read(n: number): number {
    if (n === 0) return 0;
    if (this.count < n) this.fill();
    const v = (this.bits >>> (this.count - n)) & ((1 << n) - 1);
    this.count -= n;
    return v;
  }

  /** Position of the marker that ended the data, or -1. */
  alignToMarker(): number {
    this.bits = 0;
    this.count = 0;
    let p = this.pos;
    while (p + 1 < this.data.length) {
      if (this.data[p] === 0xff && this.data[p + 1] !== 0x00 && this.data[p + 1] !== 0xff) {
        this.pos = p;
        this.hitMarker = false;
        return p;
      }
      p++;
    }
    return -1;
  }

  resume(at: number): void {
    this.pos = at;
    this.hitMarker = false;
    this.bits = 0;
    this.count = 0;
  }
}

export function decodeLosslessJpeg(bytes: Uint8Array): LosslessJpegImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new RawDecodeError("Not a JPEG stream (missing SOI).");
  const tables: Array<HuffTable | undefined> = [];
  let precision = 0;
  let height = 0;
  let width = 0;
  let nComp = 0;
  let restartInterval = 0;
  let pos = 2;
  let scan: { tableIds: number[]; predictor: number; pointTransform: number; dataStart: number } | null = null;

  while (pos + 4 <= bytes.length && !scan) {
    if (bytes[pos] !== 0xff) { pos++; continue; }
    const marker = bytes[pos + 1];
    if (marker === 0xff || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8)) { pos += marker === 0xff ? 1 : 2; continue; }
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    const seg = pos + 4;
    const end = pos + 2 + len;
    if (end > bytes.length) throw new RawDecodeError("Truncated lossless JPEG header.");
    if (marker === 0xc4) {
      let p = seg;
      while (p < end) {
        const th = bytes[p++] & 0x0f;
        const counts = bytes.subarray(p, p + 16);
        p += 16;
        let total = 0;
        for (let i = 0; i < 16; i++) total += counts[i];
        if (p + total > end) throw new RawDecodeError("Corrupt lossless JPEG: Huffman table overruns its segment.");
        tables[th] = buildHuffTable(counts, bytes.subarray(p, p + total));
        p += total;
      }
    } else if (marker === 0xc3) {
      precision = bytes[seg];
      height = (bytes[seg + 1] << 8) | bytes[seg + 2];
      width = (bytes[seg + 3] << 8) | bytes[seg + 4];
      nComp = bytes[seg + 5];
      for (let i = 0; i < nComp; i++) {
        const hv = bytes[seg + 7 + i * 3];
        if (hv !== 0x11) throw new RawDecodeError("Unsupported lossless JPEG: subsampled components.");
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      throw new RawDecodeError("Unsupported JPEG process (only lossless SOF3 is used for raw data).");
    } else if (marker === 0xdd) {
      restartInterval = (bytes[seg] << 8) | bytes[seg + 1];
    } else if (marker === 0xda) {
      const ns = bytes[seg];
      const tableIds: number[] = [];
      for (let i = 0; i < ns; i++) tableIds.push(bytes[seg + 1 + i * 2 + 1] >> 4);
      const ss = bytes[seg + 1 + ns * 2];
      const al = bytes[seg + 3 + ns * 2] & 0x0f;
      scan = { tableIds, predictor: ss, pointTransform: al, dataStart: end };
    }
    pos = end;
  }
  if (!scan) throw new RawDecodeError("Lossless JPEG has no scan.");
  if (!(precision >= 2 && precision <= 16) || width <= 0 || height <= 0 || nComp < 1 || nComp > 4 || scan.tableIds.length !== nComp)
    throw new RawDecodeError("Unsupported or corrupt lossless JPEG frame header.");
  if (width * height * nComp > 1 << 28) throw new RawDecodeError("Lossless JPEG is too large.");
  // Every coded sample costs at least one bit, so a short stream cannot justify a big image: refuse before allocating.
  if ((bytes.length - scan.dataStart) * 8 < width * height * nComp) throw new RawDecodeError("Truncated lossless JPEG: the data is smaller than the frame header claims.");

  const comps = scan.tableIds.map((id) => {
    const t = tables[id];
    if (!t) throw new RawDecodeError("Lossless JPEG references a missing Huffman table.");
    return t.lookup;
  });
  const out = new Uint16Array(width * height * nComp);
  const reader = new BitReader(bytes, scan.dataStart);
  const rowLen = width * nComp;
  const pt = scan.pointTransform;
  if (pt !== 0) throw new RawDecodeError("Unsupported lossless JPEG: point transform.");
  const initial = 1 << (precision - pt - 1);
  const predictor = scan.predictor;
  const mask = 0xffff;
  let sinceRestart = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (restartInterval && sinceRestart === restartInterval) {
        const m = reader.alignToMarker();
        if (m >= 0 && bytes[m + 1] >= 0xd0 && bytes[m + 1] <= 0xd7) reader.resume(m + 2);
        sinceRestart = 0;
      }
      const restartStart = restartInterval !== 0 && sinceRestart === 0 && (x !== 0 || y !== 0);
      for (let c = 0; c < nComp; c++) {
        const lookup = comps[c];
        const entry = lookup[reader.peek16()];
        if (entry === 0) throw new RawDecodeError("Corrupt lossless JPEG: invalid Huffman code.");
        reader.skip(entry >> 8);
        const s = entry & 0xff;
        let diff: number;
        if (s === 0) diff = 0;
        else if (s === 16) diff = 32768;
        else {
          diff = reader.read(s);
          if (diff < 1 << (s - 1)) diff -= (1 << s) - 1;
        }
        const idx = y * rowLen + x * nComp + c;
        let pred: number;
        if ((y === 0 && x === 0) || restartStart) pred = initial;
        else if (y === 0) pred = out[idx - nComp];
        else if (x === 0) pred = out[idx - rowLen];
        else {
          const ra = out[idx - nComp];
          const rb = out[idx - rowLen];
          const rc = out[idx - rowLen - nComp];
          switch (predictor) {
            case 1: pred = ra; break;
            case 2: pred = rb; break;
            case 3: pred = rc; break;
            case 4: pred = ra + rb - rc; break;
            case 5: pred = ra + ((rb - rc) >> 1); break;
            case 6: pred = rb + ((ra - rc) >> 1); break;
            case 7: pred = (ra + rb) >> 1; break;
            default: pred = initial; break;
          }
        }
        out[idx] = ((pred + diff) & mask) << pt;
      }
      sinceRestart++;
    }
  }
  return { precision, width, height, components: nComp, data: out };
}
