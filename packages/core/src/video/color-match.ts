import type { ColorWheelValues, ToneValues } from "./color-grading-engine";
import { DEFAULT_COLOR_WHEELS, DEFAULT_TONE } from "./color-grading-defaults";
import { downsampleForScopes, type ScopeImageLike } from "./scopes";

/**
 * Color Match: Reinhard-style statistics transfer in CIE Lab. Mean and
 * standard deviation of L, a and b of a reference frame are transferred onto a
 * source frame, then expressed with the controls the editor already has:
 * wheel offsets (cast), midtone gamma (brightness), tone contrast, and an
 * additive saturation delta. Pure and deterministic.
 */

const STATS_WIDTH = 128;
const D65 = { x: 0.95047, y: 1, z: 1.08883 };

export interface ChannelMoments {
  mean: number;
  std: number;
}

export interface ColorStats {
  /** Opaque pixels analysed. */
  pixels: number;
  l: ChannelMoments;
  a: ChannelMoments;
  b: ChannelMoments;
  /** Mean HSV saturation, 0..1. */
  saturation: number;
}

export interface ColorMatchResult {
  colorWheels: ColorWheelValues;
  tone: ToneValues;
  /** Additive HSL saturation shift (-0.5..0.5), applied to every hue band. */
  saturationDelta: number;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return v;
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

function labFInverse(t: number): number {
  const cube = t * t * t;
  return cube > 216 / 24389 ? cube : (116 * t - 16) / (24389 / 27);
}

export function rgbToLab(
  r: number,
  g: number,
  b: number,
): { l: number; a: number; b: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / D65.x;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / D65.y;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / D65.z;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Lab to gamma-coded sRGB in 0..1 (clamped). */
export function labToRgb(
  l: number,
  a: number,
  b: number,
): { r: number; g: number; b: number } {
  const fy = (l + 16) / 116;
  const x = labFInverse(fy + a / 500) * D65.x;
  const y = labFInverse(fy) * D65.y;
  const z = labFInverse(fy - b / 200) * D65.z;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const clamp = (v: number): number => Math.max(0, Math.min(1, linearToSrgb(Math.max(0, v))));
  return { r: clamp(lr), g: clamp(lg), b: clamp(lb) };
}

/** Lab lightness (0..100) to gamma-coded gray level (0..1). */
function lightnessToGray(l: number): number {
  return labToRgb(l, 0, 0).g;
}

/** Mean and standard deviation of Lab channels from a (downsampled) frame. */
export function computeColorStats(source: ScopeImageLike): ColorStats | null {
  const image = downsampleForScopes(source, STATS_WIDTH);
  const { data, width, height } = image;
  const total = width * height;
  if (total <= 0 || data.length < total * 4) return null;

  let n = 0;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumL2 = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  let sumSat = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue;
    const lab = rgbToLab(data[o], data[o + 1], data[o + 2]);
    n++;
    sumL += lab.l;
    sumA += lab.a;
    sumB += lab.b;
    sumL2 += lab.l * lab.l;
    sumA2 += lab.a * lab.a;
    sumB2 += lab.b * lab.b;
    const max = Math.max(data[o], data[o + 1], data[o + 2]);
    const min = Math.min(data[o], data[o + 1], data[o + 2]);
    sumSat += max === 0 ? 0 : (max - min) / max;
  }
  if (n === 0) return null;
  const moments = (sum: number, sumSquares: number): ChannelMoments => {
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sumSquares / n - mean * mean)) };
  };
  return {
    pixels: n,
    l: moments(sumL, sumL2),
    a: moments(sumA, sumA2),
    b: moments(sumB, sumB2),
    saturation: sumSat / n,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const MAX_CAST = 0.25;

export function identityColorMatch(): ColorMatchResult {
  return {
    colorWheels: {
      shadows: { ...DEFAULT_COLOR_WHEELS.shadows },
      midtones: { ...DEFAULT_COLOR_WHEELS.midtones },
      highlights: { ...DEFAULT_COLOR_WHEELS.highlights },
      shadowsLift: DEFAULT_COLOR_WHEELS.shadowsLift,
      midtonesGamma: DEFAULT_COLOR_WHEELS.midtonesGamma,
      highlightsGain: DEFAULT_COLOR_WHEELS.highlightsGain,
    },
    tone: { ...DEFAULT_TONE },
    saturationDelta: 0,
  };
}

/**
 * Wheels, tone and saturation that move `src` toward `ref`. `intensity` (0..1)
 * scales every delta; 0 and a self-match are exact identities.
 */
export function computeColorMatch(
  refStats: ColorStats,
  srcStats: ColorStats,
  intensity = 1,
): ColorMatchResult {
  const amount = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  const result = identityColorMatch();
  if (amount === 0) return result;

  // Cast: the a/b mean shift, rendered as a uniform RGB offset around mid-gray.
  const gray = labToRgb(50, 0, 0);
  const shifted = labToRgb(
    50,
    clamp(refStats.a.mean - srcStats.a.mean, -60, 60),
    clamp(refStats.b.mean - srcStats.b.mean, -60, 60),
  );
  const offset = {
    r: clamp((shifted.r - gray.r) * amount, -MAX_CAST, MAX_CAST),
    g: clamp((shifted.g - gray.g) * amount, -MAX_CAST, MAX_CAST),
    b: clamp((shifted.b - gray.b) * amount, -MAX_CAST, MAX_CAST),
  };
  result.colorWheels.shadows = { ...offset };
  result.colorWheels.midtones = { ...offset };
  result.colorWheels.highlights = { ...offset };

  // Contrast: ratio of lightness spreads, as the tone curve's 2^contrast gain about mid-gray.
  const spreadRatio =
    srcStats.l.std > 1e-3 ? clamp(refStats.l.std / srcStats.l.std, 0.25, 4) : 1;
  const contrast = clamp(Math.log2(spreadRatio) * amount, -1, 1);
  result.tone.contrast = contrast;

  // Brightness: a midtone gamma that carries the post-contrast mean onto the reference mean.
  const gain = Math.pow(2, contrast);
  const srcGray = lightnessToGray(srcStats.l.mean);
  const afterContrast = clamp(0.5 + (srcGray - 0.5) * gain, 0.02, 0.98);
  const refGray = clamp(lightnessToGray(refStats.l.mean), 0.02, 0.98);
  const gammaFull = Math.log(afterContrast) / Math.log(refGray);
  const gamma = Number.isFinite(gammaFull) && gammaFull > 0 ? gammaFull : 1;
  result.colorWheels.midtonesGamma = clamp(Math.pow(gamma, amount), 0.5, 2);

  // Saturation: ratio of chroma spreads, as an additive shift scaled by how saturated the source is.
  const chromaSrc = Math.hypot(srcStats.a.std, srcStats.b.std);
  const chromaRef = Math.hypot(refStats.a.std, refStats.b.std);
  if (chromaSrc > 1e-3) {
    const ratio = clamp(chromaRef / chromaSrc, 0.25, 4);
    result.saturationDelta = clamp(
      (ratio - 1) * srcStats.saturation * amount,
      -0.5,
      0.5,
    );
  }
  return result;
}

export function isIdentityColorMatch(result: ColorMatchResult, epsilon = 1e-6): boolean {
  const wheels = result.colorWheels;
  const channels = [wheels.shadows, wheels.midtones, wheels.highlights];
  return (
    channels.every((c) => Math.abs(c.r) < epsilon && Math.abs(c.g) < epsilon && Math.abs(c.b) < epsilon) &&
    Math.abs(wheels.midtonesGamma - 1) < epsilon &&
    Math.abs(wheels.shadowsLift) < epsilon &&
    Math.abs(wheels.highlightsGain - 1) < epsilon &&
    Object.values(result.tone).every((v) => Math.abs(v) < epsilon) &&
    Math.abs(result.saturationDelta) < epsilon
  );
}
