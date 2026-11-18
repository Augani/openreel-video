/**
 * Pure video-scope math (waveform, RGB parade, vectorscope, histogram).
 * All functions take ImageData-like input and return typed arrays, so they run
 * unchanged on the main thread, in a worker, or under test.
 */

export interface ScopeImageLike {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ScopeWaveform {
  /** width * 256 hit counts, row index = level (0 = black, 255 = white). */
  bins: Uint32Array;
  width: number;
  height: number;
  /** Largest bin value, for normalisation. */
  max: number;
}

export interface ScopeParade {
  red: ScopeWaveform;
  green: ScopeWaveform;
  blue: ScopeWaveform;
}

export interface ScopeVectorscope {
  /** size * size hit counts, origin at centre. +Cr is up, +Cb is right. */
  bins: Uint32Array;
  size: number;
  max: number;
}

export interface ScopeHistogram {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luma: Uint32Array;
  max: number;
}

export const SCOPE_LEVELS = 256;

/** Rec.709 luma. */
export function rec709Luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rec.709 Cb/Cr in range [-0.5, 0.5] for inputs 0..255. */
export function rgbToCbCr(
  r: number,
  g: number,
  b: number,
): { cb: number; cr: number } {
  const y = rec709Luma(r, g, b);
  return {
    cb: (b - y) / (2 * (255 - 0.0722 * 255)),
    cr: (r - y) / (2 * (255 - 0.2126 * 255)),
  };
}

/**
 * Nearest-neighbour downsample so analysis cost is bounded regardless of
 * source resolution. Returns the input untouched when already small enough.
 */
export function downsampleForScopes(
  src: ScopeImageLike,
  targetWidth = 256,
): ScopeImageLike {
  if (src.width <= targetWidth || targetWidth <= 0) return src;
  const scale = targetWidth / src.width;
  const w = targetWidth;
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = src.data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

function emptyWaveform(width: number): ScopeWaveform {
  return {
    bins: new Uint32Array(width * SCOPE_LEVELS),
    width,
    height: SCOPE_LEVELS,
    max: 0,
  };
}

function clampLevel(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

export function computeLumaWaveform(img: ScopeImageLike): ScopeWaveform {
  const { data, width, height } = img;
  const wf = emptyWaveform(width);
  const bins = wf.bins;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = clampLevel(rec709Luma(data[i], data[i + 1], data[i + 2]));
      const n = ++bins[luma * width + x];
      if (n > max) max = n;
    }
  }
  wf.max = max;
  return wf;
}

/** RGB parade: three side-by-side channel waveforms. */
export function computeRgbParade(img: ScopeImageLike): ScopeParade {
  const { data, width, height } = img;
  const red = emptyWaveform(width);
  const green = emptyWaveform(width);
  const blue = emptyWaveform(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const nr = ++red.bins[data[i] * width + x];
      const ng = ++green.bins[data[i + 1] * width + x];
      const nb = ++blue.bins[data[i + 2] * width + x];
      if (nr > red.max) red.max = nr;
      if (ng > green.max) green.max = ng;
      if (nb > blue.max) blue.max = nb;
    }
  }
  return { red, green, blue };
}

function clampIndex(v: number, size: number): number {
  return v < 0 ? 0 : v > size - 1 ? size - 1 : v;
}

export function computeVectorscope(
  img: ScopeImageLike,
  size = 256,
): ScopeVectorscope {
  const { data } = img;
  const bins = new Uint32Array(size * size);
  const half = size / 2;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const { cb, cr } = rgbToCbCr(data[i], data[i + 1], data[i + 2]);
    // Clamp rather than drop: max-chroma colours (pure blue/red) round to
    // index `size` or -1 and would otherwise vanish from the scope.
    const x = clampIndex(Math.round(half + cb * (size - 1)), size);
    const y = clampIndex(Math.round(half - cr * (size - 1)), size);
    const n = ++bins[y * size + x];
    if (n > max) max = n;
  }
  return { bins, size, max };
}

export function computeRgbHistogram(img: ScopeImageLike): ScopeHistogram {
  const { data } = img;
  const red = new Uint32Array(SCOPE_LEVELS);
  const green = new Uint32Array(SCOPE_LEVELS);
  const blue = new Uint32Array(SCOPE_LEVELS);
  const luma = new Uint32Array(SCOPE_LEVELS);
  for (let i = 0; i < data.length; i += 4) {
    red[data[i]]++;
    green[data[i + 1]]++;
    blue[data[i + 2]]++;
    luma[clampLevel(rec709Luma(data[i], data[i + 1], data[i + 2]))]++;
  }
  let max = 0;
  // Ignore the extreme bins when normalising so clipped black/white do not flatten the rest.
  for (let i = 1; i < SCOPE_LEVELS - 1; i++) {
    max = Math.max(max, red[i], green[i], blue[i]);
  }
  if (max === 0) {
    for (let i = 0; i < SCOPE_LEVELS; i++) {
      max = Math.max(max, red[i], green[i], blue[i]);
    }
  }
  return { red, green, blue, luma, max };
}

/** Skin-tone (I-line) angle in degrees, CCW from the +Cb axis. */
export const SKIN_TONE_ANGLE_DEG = 123;

/** 75% colour-bar targets (R, Mg, B, Cy, G, Yl) as 0..255 RGB. */
export const VECTORSCOPE_TARGETS: ReadonlyArray<{
  label: string;
  rgb: readonly [number, number, number];
}> = [
  { label: "R", rgb: [191, 0, 0] },
  { label: "Mg", rgb: [191, 0, 191] },
  { label: "B", rgb: [0, 0, 191] },
  { label: "Cy", rgb: [0, 191, 191] },
  { label: "G", rgb: [0, 191, 0] },
  { label: "Yl", rgb: [191, 191, 0] },
];

/** Position of an RGB colour on a size x size vectorscope, in pixels. */
export function vectorscopePoint(
  rgb: readonly [number, number, number],
  size: number,
): { x: number; y: number } {
  const { cb, cr } = rgbToCbCr(rgb[0], rgb[1], rgb[2]);
  return {
    x: size / 2 + cb * (size - 1),
    y: size / 2 - cr * (size - 1),
  };
}
