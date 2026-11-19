/**
 * White-balance eyedropper maths (Lumetri "WB Selector").
 *
 * The clip's Temperature / Tint sliders (-100..100) add a fixed per-channel
 * offset to the picture. The same coefficients drive the Canvas2D / export
 * path (`VideoEffectsEngine`), the effects shaders and the HDR grade
 * (`prepareHdrGrade`), so the eyedropper only has to invert one linear model:
 * pick the offset that makes a sampled colour grey.
 *
 *   r' = r + 0.2 T + 0.1 t
 *   g' = g + k T   - 0.2 t        k = 0.1 (T > 0, warm) or 0.05 (T <= 0, cool)
 *   b' = b - 0.2 T + 0.1 t
 *
 * with T = temperature / 100 and t = tint / 100. Setting r' = g' = b' gives a
 * closed form, so the result is exact (no iteration) whenever it fits the
 * slider range.
 */

export type Rgb01 = readonly [number, number, number];

export interface WhiteBalanceValues {
  /** -100..100, negative = cooler. */
  temperature: number;
  /** -100..100, negative = greener. */
  tint: number;
}

export interface WhiteBalanceSolution extends WhiteBalanceValues {
  /** True when the neutralising values did not fit the slider range and were clamped. */
  clamped: boolean;
  /** The sampled colour after the returned white balance (grey unless clamped), 0..1. */
  neutral: Rgb01;
}

/** Slider range of Temperature and Tint. */
export const WB_RANGE = 100;

/** Samples closer to black / white than this carry no usable colour information. */
export const WB_CLIP_MARGIN = 2 / 255;

const COOL_GREEN = 0.05;
const WARM_GREEN = 0.1;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** Per-channel offset (in 0..1 units) that Temperature / Tint add to a pixel. */
export function whiteBalanceOffset(temperature: number, tint: number): [number, number, number] {
  const T = (Number.isFinite(temperature) ? temperature : 0) / WB_RANGE;
  const t = (Number.isFinite(tint) ? tint : 0) / WB_RANGE;
  const k = T > 0 ? WARM_GREEN : COOL_GREEN;
  return [0.2 * T + 0.1 * t, k * T - 0.2 * t, -0.2 * T + 0.1 * t];
}

/** The colour after Temperature / Tint (unclamped, 0..1 units). */
export function applyWhiteBalance(rgb: Rgb01, temperature: number, tint: number): [number, number, number] {
  const [dr, dg, db] = whiteBalanceOffset(temperature, tint);
  return [rgb[0] + dr, rgb[1] + dg, rgb[2] + db];
}

/**
 * Whether a sample can drive the eyedropper. Pure black / pure white (or a
 * channel pinned at either rail) says nothing about the light colour.
 */
export function isUsableWhiteBalanceSample(rgb: Rgb01): boolean {
  return rgb.every((v) => Number.isFinite(v) && v > WB_CLIP_MARGIN && v < 1 - WB_CLIP_MARGIN);
}

/**
 * Temperature / Tint that turn the sampled colour neutral.
 *
 * `sample` is what the Program monitor shows, so it already contains the
 * clip's current white balance; that offset is removed first. The result is
 * absolute (it replaces the sliders), so picking twice never compounds.
 *
 * Returns null when the sample is unusable (see `isUsableWhiteBalanceSample`).
 */
export function solveNeutralWhiteBalance(
  sample: Rgb01,
  current: Partial<WhiteBalanceValues> = {},
): WhiteBalanceSolution | null {
  if (!isUsableWhiteBalanceSample(sample)) return null;
  const [cr, cg, cb] = whiteBalanceOffset(current.temperature ?? 0, current.tint ?? 0);
  const r = sample[0] - cr;
  const g = sample[1] - cg;
  const b = sample[2] - cb;

  // r' = b'  =>  r - b + 0.4 T = 0
  const T = (b - r) / 0.4;
  // g' = b'  =>  0.3 t = g - b + (k + 0.2) T, with k chosen by the sign of T
  const k = T > 0 ? WARM_GREEN : COOL_GREEN;
  const t = (g - b + (k + 0.2) * T) / 0.3;

  const temperature = clamp(Math.round(T * WB_RANGE * 10) / 10, -WB_RANGE, WB_RANGE);
  const tint = clamp(Math.round(t * WB_RANGE * 10) / 10, -WB_RANGE, WB_RANGE);
  const clamped = Math.abs(T * WB_RANGE) > WB_RANGE + 0.05 || Math.abs(t * WB_RANGE) > WB_RANGE + 0.05;
  return { temperature, tint, clamped, neutral: applyWhiteBalance([r, g, b], temperature, tint) };
}

/** Sample footprint of the eyedropper: a single pixel or a 5x5 average. */
export type WhiteBalanceSampleSize = 1 | 5;

export function whiteBalanceSampleRadius(size: WhiteBalanceSampleSize): number {
  return size === 5 ? 2 : 0;
}

/** Saturation (max-min)/max above which a sample is a coloured object, not a neutral reference. */
export const WB_MAX_SAMPLE_SATURATION = 0.5;

/** HSV saturation of a 0..1 colour. */
export function whiteBalanceSampleSaturation(rgb: Rgb01): number {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  return max > 0 ? (max - min) / max : 0;
}

/** True when the sample is so coloured that neutralising it would be a mistake (e.g. a brown wall, skin). */
export function isFarFromNeutral(rgb: Rgb01): boolean {
  return whiteBalanceSampleSaturation(rgb) > WB_MAX_SAMPLE_SATURATION;
}

interface WhiteBalanceInputGradingShape {
  pipelineVersion?: number;
  temperature?: number;
  tint?: number;
  inputLut?: unknown;
}

/**
 * The grade as it exists at the white-balance stage INPUT.
 *
 * Version 2 (Premiere order) runs white balance right after the input LUT and
 * before tone, curves, wheels, LUT, HSL and look, so only the input LUT is
 * kept. Version 1 runs white balance last, so everything stays and only the
 * white balance itself is removed.
 */
export function whiteBalanceInputGrading<T extends WhiteBalanceInputGradingShape>(grading: T): T {
  if (grading.pipelineVersion === 2) {
    const kept: WhiteBalanceInputGradingShape = { pipelineVersion: 2 };
    if (grading.inputLut !== undefined) kept.inputLut = grading.inputLut;
    return kept as T;
  }
  return { ...grading, temperature: 0, tint: 0 };
}

/**
 * Whether the displayed pixel differs from the white-balance stage input, so a
 * pick must render that input frame instead of reading the Program monitor.
 */
export function needsWhiteBalanceInputFrame<T extends WhiteBalanceInputGradingShape>(
  grading: T,
  isNeutral: (grading: T) => boolean,
): boolean {
  const wbActive = Math.abs(grading.temperature ?? 0) > 1e-6 || Math.abs(grading.tint ?? 0) > 1e-6;
  if (grading.pipelineVersion !== 2) return wbActive;
  return wbActive || !isNeutral({ ...grading, inputLut: undefined } as T);
}
