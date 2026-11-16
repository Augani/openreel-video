import type { ToneValues, VignetteValues } from "./color-grading-engine";

/**
 * Basic Correction tone curve and vignette.
 *
 * `buildToneCurve` is a pure function that bakes exposure, blacks, shadows,
 * highlights, whites and contrast into one 256-entry 1D LUT. The same LUT is
 * what the fused grading stage indexes per channel, so the Canvas2D fallback,
 * WebGL2 preview and export paths all run identical math.
 */

export const TONE_CURVE_SIZE = 256;

/** Peak lift/crush (in 0..1 output units) a slider at +/-1 applies at its mask centre. */
const BLACKS_AMOUNT = 0.12;
const SHADOWS_AMOUNT = 0.15;
const HIGHLIGHTS_AMOUNT = 0.15;
const WHITES_AMOUNT = 0.12;
/** Exposure +/-1 is +/-2 stops of gain. */
const EXPOSURE_STOPS = 2;
/** Contrast +/-1 is a gain of 2^(+/-1.5) about mid-gray. */
const CONTRAST_STOPS = 1.5;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 1 at 0 fading smoothly to 0 at `end`. */
function lowFalloff(x: number, end: number): number {
  return 1 - smoothstep(0, end, x);
}

/** 0 outside (start, end), a smooth sin-squared bump peaking at the midpoint. */
function bump(x: number, start: number, end: number): number {
  if (x <= start || x >= end) return 0;
  const s = Math.sin((Math.PI * (x - start)) / (end - start));
  return s * s;
}

function toneValue(x: number, tone: ToneValues): number {
  const exposure = clampUnit(tone.exposure);
  const contrast = clampUnit(tone.contrast);
  const blacks = clampUnit(tone.blacks);
  const shadows = clampUnit(tone.shadows);
  const highlights = clampUnit(tone.highlights);
  const whites = clampUnit(tone.whites);

  let y = clamp01(x * Math.pow(2, exposure * EXPOSURE_STOPS));
  y +=
    blacks * BLACKS_AMOUNT * lowFalloff(y, 0.25) +
    shadows * SHADOWS_AMOUNT * bump(y, 0, 0.5) +
    highlights * HIGHLIGHTS_AMOUNT * bump(y, 0.5, 1) +
    whites * WHITES_AMOUNT * lowFalloff(1 - y, 0.25);
  y = clamp01(y);
  return clamp01(0.5 + (y - 0.5) * Math.pow(2, contrast * CONTRAST_STOPS));
}

/**
 * Builds the 256-entry tone LUT (values 0..1, index = input level / 255).
 * All zeros yields the identity curve. The result is monotonic non-decreasing
 * and always within 0..1.
 */
export function buildToneCurve(tone: ToneValues): Float32Array {
  const curve = new Float32Array(TONE_CURVE_SIZE);
  let previous = 0;
  for (let i = 0; i < TONE_CURVE_SIZE; i++) {
    const x = i / (TONE_CURVE_SIZE - 1);
    // The running max makes monotonicity a guarantee even for slider
    // combinations whose range masks overlap.
    previous = Math.max(previous, toneValue(x, tone));
    curve[i] = previous;
  }
  return curve;
}

/** Samples a tone curve at a continuous 0..1 input with linear interpolation. */
export function sampleToneCurve(curve: Float32Array, x: number): number {
  const position = clamp01(x) * (curve.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(curve.length - 1, lower + 1);
  const fraction = position - lower;
  return curve[lower] * (1 - fraction) + curve[upper] * fraction;
}

/** Quantises the tone curve to the 8-bit table the pixel loops index. */
export function buildToneCurve8(tone: ToneValues): Uint8Array {
  const curve = buildToneCurve(tone);
  const lut = new Uint8Array(TONE_CURVE_SIZE);
  for (let i = 0; i < TONE_CURVE_SIZE; i++) {
    lut[i] = Math.round(curve[i] * 255);
  }
  return lut;
}

export function applyToneToData(
  data: Uint8ClampedArray,
  tone: ToneValues,
): void {
  const lut = buildToneCurve8(tone);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

/**
 * Vignette strength (0 at the centre .. 1 at the edge) for a normalised
 * position. `nx`/`ny` are in -1..1 across the frame.
 */
export function vignetteWeight(
  nx: number,
  ny: number,
  aspect: number,
  vignette: VignetteValues,
): number {
  const ellipse = Math.hypot(nx, ny) / Math.SQRT2;
  const circle = Math.hypot(nx * aspect, ny) / Math.hypot(aspect, 1);
  const rect = Math.max(Math.abs(nx), Math.abs(ny));
  const roundness = clampUnit(vignette.roundness);
  const distance =
    roundness >= 0
      ? ellipse + (circle - ellipse) * roundness
      : ellipse + (rect - ellipse) * -roundness;
  const midpoint = clamp01(vignette.midpoint);
  const feather = clamp01(vignette.feather);
  const edge0 = clamp01(midpoint - feather * 0.5);
  const edge1 = Math.max(edge0 + 1e-3, midpoint + feather * 0.5);
  return smoothstep(edge0, edge1, distance);
}

/** Darkens (amount < 0) or lightens (amount > 0) pixels radially. */
export function applyVignetteToData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  vignette: VignetteValues,
): void {
  const amount = clampUnit(vignette.amount);
  if (amount === 0 || width <= 0 || height <= 0) return;
  const aspect = width / height;
  for (let y = 0; y < height; y++) {
    const ny = ((y + 0.5) / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const nx = ((x + 0.5) / width) * 2 - 1;
      const weight = vignetteWeight(nx, ny, aspect, vignette);
      if (weight === 0) continue;
      const o = (y * width + x) * 4;
      if (amount < 0) {
        const gain = 1 + amount * weight;
        data[o] = Math.round(data[o] * gain);
        data[o + 1] = Math.round(data[o + 1] * gain);
        data[o + 2] = Math.round(data[o + 2] * gain);
      } else {
        const lift = amount * weight;
        data[o] = Math.round(data[o] + (255 - data[o]) * lift);
        data[o + 1] = Math.round(data[o + 1] + (255 - data[o + 1]) * lift);
        data[o + 2] = Math.round(data[o + 2] + (255 - data[o + 2]) * lift);
      }
    }
  }
}
