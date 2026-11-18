/**
 * Animated GIF89a encoder: one global palette (median cut over a sample of every frame), optional
 * Floyd-Steinberg-free nearest-colour mapping through a 15-bit lookup, LZW compression, NETSCAPE2.0
 * loop count. Pure TypeScript so it runs in a worker, the browser and the tests alike.
 */

export interface GifFrame {
  /** RGBA, width * height * 4 bytes. Pixels with alpha below 128 become the transparent index when `transparency` is on. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface GifOptions {
  readonly width: number;
  readonly height: number;
  /** Playback rate; the frame delay is whole centiseconds (GIF's resolution), at least 2. */
  readonly fps: number;
  /** Palette size 2..256 (default 256). */
  readonly maxColors?: number;
  /** Loop count: 0 = forever (default), n = play n times, "none" = play once and stop. */
  readonly loop?: number | "none";
  /** Reserve a transparent palette entry for transparent pixels (default false). */
  readonly transparency?: boolean;
}

export const GIF_MAX_DIMENSION = 4096;
/** Every frame's RGBA pixels are held in memory until the GIF is encoded: cap the frame count and the total bytes. */
export const GIF_MAX_FRAMES = 1500;
export const GIF_MAX_RGBA_BYTES = 768 * 1024 * 1024;

/** Error message when `frames` frames of width x height would not fit the in-memory budget, else null. */
export function validateGifFrameBudget(width: number, height: number, frames: number): string | null {
  if (frames > GIF_MAX_FRAMES) return `That GIF would have more than ${GIF_MAX_FRAMES} frames; shorten the range or lower the frame rate.`;
  if (width * height * 4 * frames > GIF_MAX_RGBA_BYTES) return "That GIF is too large to build in memory; reduce its size, range or frame rate.";
  return null;
}

export function gifFrameDelayCs(fps: number): number {
  return Math.max(2, Math.round(100 / fps));
}

/** The frame rate a GIF really plays at once the delay is rounded to whole centiseconds: sample frames at this rate. */
export function gifPlaybackFps(fps: number): number {
  return 100 / gifFrameDelayCs(fps);
}

/** Returns an error message, or null. */
export function validateGifOptions(o: GifOptions): string | null {
  if (!Number.isInteger(o.width) || !Number.isInteger(o.height) || o.width < 1 || o.height < 1) return "GIF width and height must be whole numbers.";
  if (o.width > GIF_MAX_DIMENSION || o.height > GIF_MAX_DIMENSION) return `A GIF can be at most ${GIF_MAX_DIMENSION} pixels on a side.`;
  if (!Number.isFinite(o.fps) || o.fps <= 0 || o.fps > 50) return "GIF frame rate must be between 0 and 50 fps.";
  if (o.maxColors !== undefined && (!Number.isInteger(o.maxColors) || o.maxColors < 2 || o.maxColors > 256)) return "GIF palette size must be 2 to 256 colours.";
  if (typeof o.loop === "number" && (!Number.isInteger(o.loop) || o.loop < 0 || o.loop > 65535)) return "GIF loop count must be 0 (forever) to 65535.";
  return null;
}

type Rgb = [number, number, number];

/** Median-cut palette from packed RGB samples (r<<16|g<<8|b). */
function medianCut(samples: Uint32Array, colors: number): Rgb[] {
  interface Box {
    lo: number;
    hi: number;
  }
  const px = Uint32Array.from(samples);
  const boxes: Box[] = [{ lo: 0, hi: px.length }];
  const channel = (v: number, c: number): number => (v >> (16 - 8 * c)) & 255;
  const range = (b: Box): { c: number; span: number } => {
    const min = [255, 255, 255];
    const max = [0, 0, 0];
    for (let i = b.lo; i < b.hi; i++)
      for (let c = 0; c < 3; c++) {
        const v = channel(px[i], c);
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    let best = 0;
    for (let c = 1; c < 3; c++) if (max[c] - min[c] > max[best] - min[best]) best = c;
    return { c: best, span: max[best] - min[best] };
  };
  while (boxes.length < colors) {
    let target = -1;
    let targetScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2) continue;
      const score = range(b).span * Math.sqrt(b.hi - b.lo);
      if (score > targetScore) {
        target = i;
        targetScore = score;
      }
    }
    if (target < 0) break;
    const b = boxes[target];
    const { c } = range(b);
    const slice = Array.from(px.subarray(b.lo, b.hi)).sort((x, y) => channel(x, c) - channel(y, c));
    px.set(slice, b.lo);
    const mid = b.lo + (b.hi - b.lo) / 2 | 0;
    boxes.splice(target, 1, { lo: b.lo, hi: mid }, { lo: mid, hi: b.hi });
  }
  return boxes.map((b) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    const n = Math.max(1, b.hi - b.lo);
    for (let i = b.lo; i < b.hi; i++) {
      r += channel(px[i], 0);
      g += channel(px[i], 1);
      bl += channel(px[i], 2);
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] as Rgb;
  });
}

function buildPalette(frames: readonly GifFrame[], colors: number, alphaCutoff: boolean): Rgb[] {
  const perFrame = Math.max(1, Math.floor(16384 / Math.max(1, frames.length)));
  const samples: number[] = [];
  for (const frame of frames) {
    const pixels = frame.data.length / 4;
    const step = Math.max(1, Math.floor(pixels / perFrame));
    for (let p = 0; p < pixels; p += step) {
      const i = p * 4;
      if (alphaCutoff && frame.data[i + 3] < 128) continue;
      samples.push((frame.data[i] << 16) | (frame.data[i + 1] << 8) | frame.data[i + 2]);
    }
  }
  if (samples.length === 0) return [[0, 0, 0]];
  const distinct = new Set(samples);
  if (distinct.size <= colors) {
    return [...distinct].map((v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255] as Rgb);
  }
  return medianCut(Uint32Array.from(samples), colors);
}

/** LZW as GIF specifies: variable code size, clear / end codes, 12-bit table cap. */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  let table = new Map<number, number>();
  let next = end + 1;
  const reset = (): void => {
    table = new Map();
    next = end + 1;
    codeSize = minCodeSize + 1;
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      table.set(key, next++);
      if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bitCount > 0) out.push(bitBuffer & 255);
  return Uint8Array.from(out);
}

export function encodeGif(frames: readonly GifFrame[], options: GifOptions): Uint8Array {
  const problem = validateGifOptions(options);
  if (problem) throw new Error(problem);
  if (frames.length === 0) throw new Error("A GIF needs at least one frame.");
  const { width, height } = options;
  for (const f of frames) if (f.data.length !== width * height * 4) throw new Error("A frame does not match the GIF size.");

  const transparency = options.transparency === true;
  const wanted = Math.min(256, Math.max(2, options.maxColors ?? 256)) - (transparency ? 1 : 0);
  const rgb = buildPalette(frames, Math.max(1, wanted), transparency);
  const transparentIndex = transparency ? rgb.length : -1;
  const entries = rgb.length + (transparency ? 1 : 0);
  let bits = 1;
  while (1 << bits < entries) bits++;
  const tableSize = 1 << bits;

  // 15-bit colour -> nearest palette index, filled lazily.
  const lut = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cached = lut[key];
    if (cached >= 0) return cached;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rgb.length; i++) {
      const dr = rgb[i][0] - r;
      const dg = rgb[i][1] - g;
      const db = rgb[i][2] - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    lut[key] = best;
    return best;
  };

  const bytes: number[] = [];
  const push = (...v: number[]): void => {
    for (const x of v) bytes.push(x);
  };
  const u16 = (v: number): void => push(v & 255, (v >> 8) & 255);
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // GIF89a
  u16(width);
  u16(height);
  push(0x80 | 0x70 | (bits - 1), 0, 0); // global table, 8-bit colour resolution, background 0, aspect 0
  for (let i = 0; i < tableSize; i++) {
    const c = rgb[i] ?? [0, 0, 0];
    push(c[0], c[1], c[2]);
  }
  if (options.loop !== "none") {
    const loops = options.loop ?? 0;
    push(0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01);
    u16(loops);
    push(0x00);
  }
  const delay = gifFrameDelayCs(options.fps);
  const minCodeSize = Math.max(2, bits);
  for (const frame of frames) {
    // Transparent frames use disposal 2 (restore to background) so a later frame's transparent pixels do not show the previous frame.
    push(0x21, 0xf9, 0x04, (transparency ? 1 : 0) | ((transparency ? 2 : 1) << 2));
    u16(delay);
    push(transparency ? transparentIndex : 0, 0x00);
    push(0x2c);
    u16(0);
    u16(0);
    u16(width);
    u16(height);
    push(0x00);
    const indices = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
      indices[p] = transparency && frame.data[i + 3] < 128 ? transparentIndex : nearest(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
    }
    push(minCodeSize);
    const packed = lzwEncode(indices, minCodeSize);
    for (let i = 0; i < packed.length; i += 255) {
      const chunk = packed.subarray(i, Math.min(packed.length, i + 255));
      push(chunk.length);
      for (const b of chunk) bytes.push(b);
    }
    push(0x00);
  }
  push(0x3b);
  return Uint8Array.from(bytes);
}

/**
 * Minimal GIF reader for tests: header, palette size, loop extension, per-frame delay and decoded
 * indices. Throws on malformed data.
 */
export function readGif(bytes: Uint8Array): {
  width: number;
  height: number;
  palette: Rgb[];
  loop: number | null;
  frames: { delayCs: number; disposal: number; indices: Uint8Array; transparentIndex: number | null }[];
} {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== "GIF89a" && sig !== "GIF87a") throw new Error("Not a GIF.");
  let p = 6;
  const u16 = (): number => {
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };
  const width = u16();
  const height = u16();
  const flags = bytes[p++];
  p += 2;
  const palette: Rgb[] = [];
  if (flags & 0x80) {
    const n = 1 << ((flags & 7) + 1);
    for (let i = 0; i < n; i++) {
      palette.push([bytes[p], bytes[p + 1], bytes[p + 2]]);
      p += 3;
    }
  }
  let loop: number | null = null;
  const frames: { delayCs: number; disposal: number; indices: Uint8Array; transparentIndex: number | null }[] = [];
  let delayCs = 0;
  let disposal = 0;
  let transparentIndex: number | null = null;
  const readBlocks = (): Uint8Array => {
    const out: number[] = [];
    for (;;) {
      const n = bytes[p++];
      if (n === 0) break;
      for (let i = 0; i < n; i++) out.push(bytes[p++]);
    }
    return Uint8Array.from(out);
  };
  for (;;) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p++];
      if (label === 0xf9) {
        p++; // block size 4
        const f = bytes[p++];
        disposal = (f >> 2) & 7;
        delayCs = u16();
        transparentIndex = f & 1 ? bytes[p] : null;
        p += 2; // transparent index + terminator
      } else if (label === 0xff) {
        const size = bytes[p++];
        const name = String.fromCharCode(...bytes.subarray(p, p + size));
        p += size;
        const data = readBlocks();
        if (name === "NETSCAPE2.0" && data[0] === 1) loop = data[1] | (data[2] << 8);
      } else readBlocks();
    } else if (b === 0x2c) {
      p += 8;
      const local = bytes[p++];
      if (local & 0x80) p += 3 * (1 << ((local & 7) + 1));
      const minCode = bytes[p++];
      const data = readBlocks();
      frames.push({ delayCs, disposal, indices: lzwDecode(data, minCode, width * height), transparentIndex });
    } else throw new Error(`Unexpected GIF block 0x${b.toString(16)}.`);
  }
  return { width, height, palette, loop, frames };
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixels: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out = new Uint8Array(pixels);
  let outPos = 0;
  let codeSize = minCodeSize + 1;
  let table: number[][] = [];
  const resetTable = (): void => {
    table = [];
    for (let i = 0; i < clear; i++) table[i] = [i];
    table[clear] = [];
    table[end] = [];
    codeSize = minCodeSize + 1;
  };
  resetTable();
  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 0;
  let prev: number[] | null = null;
  while (outPos < pixels) {
    while (bitCount < codeSize && pos < data.length) {
      bitBuffer |= data[pos++] << bitCount;
      bitCount += 8;
    }
    if (bitCount < codeSize) break;
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>>= codeSize;
    bitCount -= codeSize;
    if (code === clear) {
      resetTable();
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error("Corrupt GIF data.");
    for (const v of entry) if (outPos < pixels) out[outPos++] = v;
    if (prev && table.length < 4096) {
      table.push([...prev, entry[0]]);
      if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out;
}
