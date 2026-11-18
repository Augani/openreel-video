/**
 * Additional scope math: YC waveform, HLS vectorscope, nit scales for HDR
 * waveforms, and the false-colour exposure overlay. Pure typed-array code so
 * it runs on the main thread, in a worker, or under test.
 */
import {
  SCOPE_LEVELS,
  rec709Luma,
  rgbToCbCr,
  type ScopeImageLike,
  type ScopeWaveform,
} from "./scopes";

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

function clampIndex(v: number, size: number): number {
  return v < 0 ? 0 : v > size - 1 ? size - 1 : v;
}

export interface ScopeYcWaveform {
  luma: ScopeWaveform;
  /** Chroma magnitude per column (255 = fully saturated primary). */
  chroma: ScopeWaveform;
}

/** Luma waveform with a chroma-magnitude waveform over it (Premiere "YC"). */
export function computeYcWaveform(img: ScopeImageLike): ScopeYcWaveform {
  const { data, width, height } = img;
  const luma = emptyWaveform(width);
  const chroma = emptyWaveform(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const nl = ++luma.bins[clampLevel(rec709Luma(r, g, b)) * width + x];
      if (nl > luma.max) luma.max = nl;
      const { cb, cr } = rgbToCbCr(r, g, b);
      const mag = Math.sqrt(cb * cb + cr * cr);
      const nc = ++chroma.bins[clampLevel(mag * 2 * 255) * width + x];
      if (nc > chroma.max) chroma.max = nc;
    }
  }
  return { luma, chroma };
}

/** Hue (degrees), lightness and saturation (0..1) of an 0..255 RGB colour. */
export function rgbToHls(
  r: number,
  g: number,
  b: number,
): { h: number; l: number; s: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, l, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, l, s: Math.min(1, s) };
}

export interface ScopeHlsVectorscope {
  /** size * size hit counts. Angle = hue (0 = +x, counter-clockwise), radius = saturation. */
  bins: Uint32Array;
  /** Sum of lightness (0..1) per bin; divide by `bins` for the mean. */
  lightnessSum: Float32Array;
  size: number;
  max: number;
}

/** Hue / saturation polar plot whose trace brightness follows lightness. */
export function computeHlsVectorscope(
  img: ScopeImageLike,
  size = 256,
): ScopeHlsVectorscope {
  const { data } = img;
  const bins = new Uint32Array(size * size);
  const lightnessSum = new Float32Array(size * size);
  const half = size / 2;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const { h, l, s } = rgbToHls(data[i], data[i + 1], data[i + 2]);
    const a = (h * Math.PI) / 180;
    const rad = s * (half - 1);
    const x = clampIndex(Math.round(half + Math.cos(a) * rad), size);
    const y = clampIndex(Math.round(half - Math.sin(a) * rad), size);
    const idx = y * size + x;
    const n = ++bins[idx];
    lightnessSum[idx] += l;
    if (n > max) max = n;
  }
  return { bins, lightnessSum, size, max };
}

/** Position of an RGB colour on an HLS vectorscope of `size` pixels. */
export function hlsVectorscopePoint(
  rgb: readonly [number, number, number],
  size: number,
): { x: number; y: number } {
  const { h, s } = rgbToHls(rgb[0], rgb[1], rgb[2]);
  const a = (h * Math.PI) / 180;
  const rad = s * (size / 2 - 1);
  return { x: size / 2 + Math.cos(a) * rad, y: size / 2 - Math.sin(a) * rad };
}

export type ScopeLevelScale = "ire" | "pq" | "hlg";

/** Display nits for a 0..1 signal. `hlg` assumes a 1000 nit reference display. */
export function signalToNits(signal: number, scale: "pq" | "hlg"): number {
  const v = Math.min(1, Math.max(0, signal));
  if (scale === "pq") {
    const m1 = 2610 / 16384;
    const m2 = (2523 / 4096) * 128;
    const c1 = 3424 / 4096;
    const c2 = (2413 / 4096) * 32;
    const c3 = (2392 / 4096) * 32;
    const p = Math.pow(v, 1 / m2);
    const num = Math.max(p - c1, 0);
    const den = c2 - c3 * p;
    return 10000 * Math.pow(num / den, 1 / m1);
  }
  const a = 0.17883277;
  const b = 1 - 4 * a;
  const c = 0.5 - a * Math.log(4 * a);
  const scene = v <= 0.5 ? (v * v) / 3 : (Math.exp((v - c) / a) + b) / 12;
  return 1000 * Math.pow(Math.min(1, scene), 1.2);
}

/** Inverse of `signalToNits` (0..1 signal). */
export function nitsToSignal(nits: number, scale: "pq" | "hlg"): number {
  const target = Math.max(0, nits);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (signalToNits(mid, scale) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Graticule marks for a nit scale, in nits (203 = HDR reference white). */
export const NIT_GRATICULE: Readonly<Record<"pq" | "hlg", readonly number[]>> = {
  pq: [0, 10, 100, 203, 1000, 4000, 10000],
  hlg: [0, 5, 50, 203, 500, 1000],
};

export interface FalseColorBand {
  /** Inclusive lower luma bound, in IRE percent. */
  from: number;
  /** Exclusive upper bound. */
  to: number;
  label: string;
  rgb: readonly [number, number, number];
}

/** Exposure bands for the false-colour overlay; everything else stays grey. */
export const FALSE_COLOR_BANDS: readonly FalseColorBand[] = [
  { from: 0, to: 2, label: "Crushed", rgb: [120, 0, 170] },
  { from: 2, to: 10, label: "Near black", rgb: [30, 70, 220] },
  { from: 38, to: 48, label: "18% grey", rgb: [40, 170, 60] },
  { from: 52, to: 62, label: "Skin", rgb: [240, 140, 170] },
  { from: 90, to: 98, label: "Near clip", rgb: [240, 220, 40] },
  { from: 98, to: 101, label: "Clipped", rgb: [235, 30, 30] },
];

/** Band colour for a luma level (0..255), or null outside every band. */
export function falseColorFor(
  luma255: number,
): readonly [number, number, number] | null {
  const ire = (luma255 / 255) * 100;
  for (const band of FALSE_COLOR_BANDS) {
    if (ire >= band.from && ire < band.to) return band.rgb;
  }
  return null;
}

/** New RGBA buffer: IRE bands painted over a greyscale copy of `img`. */
export function applyFalseColor(img: ScopeImageLike): Uint8ClampedArray {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const y = Math.round(rec709Luma(data[i], data[i + 1], data[i + 2]));
    const band = falseColorFor(y);
    if (band) {
      out[i] = band[0];
      out[i + 1] = band[1];
      out[i + 2] = band[2];
    } else {
      out[i] = out[i + 1] = out[i + 2] = y;
    }
    out[i + 3] = data[i + 3];
  }
  return out;
}
