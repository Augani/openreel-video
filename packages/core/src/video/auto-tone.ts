import type { ToneValues } from "./color-grading-engine";
import { DEFAULT_TONE } from "./color-grading-defaults";
import {
  computeRgbHistogram,
  downsampleForScopes,
  SCOPE_LEVELS,
  type ScopeHistogram,
  type ScopeImageLike,
} from "./scopes";
import { buildToneCurve, sampleToneCurve } from "./tone-curve";

/**
 * Auto Tone: measures a frame's luma histogram and fits Basic Correction
 * sliders that put the black point, median and white point in a pleasing
 * range. Pure and deterministic. Idempotent by construction: each anchor has
 * a dead band, so a frame that already sits inside the bands fits to zero.
 */

export const AUTO_TONE_BLACK_PERCENTILE = 0.005;
export const AUTO_TONE_WHITE_PERCENTILE = 0.995;
/** Median luma the correction aims for when the frame is too dark or bright. */
export const AUTO_TONE_TARGET_MEDIAN = 0.45;
const MEDIAN_BAND: readonly [number, number] = [0.38, 0.52];
/** Black point above this is pulled down to BLACK_TARGET. */
const BLACK_BAND_TOP = 0.04;
const BLACK_TARGET = 0.03;
/** White point below WHITE_BAND[0] is pulled up; clipped frames are backed off to WHITE_CLIPPED_TARGET. */
const WHITE_BAND: readonly [number, number] = [0.94, 0.985];
const WHITE_TARGET = 0.965;
const WHITE_CLIPPED_TARGET = 0.94;
/** Share of pixels at full white above which the frame counts as clipped. */
const WHITE_CLIP_SHARE = 0.02;
/** Gray-world casts smaller than this are ignored (natural scenes are rarely neutral). */
const CAST_DEAD_BAND = 0.03;
const MAX_WB = 40;

export interface AutoToneOptions {
  /** Also estimate temperature/tint from a gray-world assumption. Default false. */
  whiteBalance?: boolean;
}

export interface AutoToneResult {
  tone: ToneValues;
  /** -100..100 like the White Balance sliders; 0 unless `whiteBalance` is set. */
  temperature: number;
  tint: number;
  /** What was measured, 0..1 luma. */
  measured: {
    black: number;
    median: number;
    white: number;
    whiteClipShare: number;
  };
}

export type AutoToneInput = ScopeHistogram | ScopeImageLike;

function isHistogram(input: AutoToneInput): input is ScopeHistogram {
  return "luma" in input && "red" in input;
}

function percentile(
  histogram: Uint32Array,
  total: number,
  fraction: number,
): number {
  const target = total * fraction;
  let cumulative = 0;
  for (let level = 0; level < SCOPE_LEVELS; level++) {
    cumulative += histogram[level];
    if (cumulative >= target && cumulative > 0) return level / (SCOPE_LEVELS - 1);
  }
  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function histogramMean(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let level = 0; level < SCOPE_LEVELS; level++) sum += histogram[level] * level;
  return sum / (total * (SCOPE_LEVELS - 1));
}

const PARAMETERS: ReadonlyArray<{ key: keyof ToneValues; weight: number }> = [
  { key: "exposure", weight: 1e-4 },
  { key: "contrast", weight: 1e-4 },
  { key: "blacks", weight: 1e-4 },
  { key: "whites", weight: 1e-4 },
  // Shadows/highlights are fitted only when the broader sliders cannot reach an anchor.
  { key: "shadows", weight: 2e-2 },
  { key: "highlights", weight: 2e-2 },
];

function fitTone(
  anchors: ReadonlyArray<{ at: number; target: number }>,
): ToneValues {
  const tone: ToneValues = { ...DEFAULT_TONE };
  const cost = (candidate: ToneValues): number => {
    const curve = buildToneCurve(candidate);
    let error = 0;
    for (const anchor of anchors) {
      const delta = sampleToneCurve(curve, anchor.at) - anchor.target;
      error += delta * delta;
    }
    for (const { key, weight } of PARAMETERS) error += weight * candidate[key] ** 2;
    return error;
  };

  let best = cost(tone);
  for (let step = 0.5; step > 0.0005; step *= 0.6) {
    for (let sweep = 0; sweep < 3; sweep++) {
      let improved = false;
      for (const { key } of PARAMETERS) {
        for (const direction of [1, -1]) {
          const next = clamp(tone[key] + direction * step, -1, 1);
          if (next === tone[key]) continue;
          const candidate = { ...tone, [key]: next };
          const value = cost(candidate);
          if (value < best - 1e-12) {
            tone[key] = next;
            best = value;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  }
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    exposure: round(tone.exposure),
    contrast: round(tone.contrast),
    highlights: round(tone.highlights),
    shadows: round(tone.shadows),
    whites: round(tone.whites),
    blacks: round(tone.blacks),
  };
}

export function computeAutoTone(
  input: AutoToneInput,
  options: AutoToneOptions = {},
): AutoToneResult {
  const histogram = isHistogram(input)
    ? input
    : computeRgbHistogram(downsampleForScopes(input, 256));
  let total = 0;
  for (let level = 0; level < SCOPE_LEVELS; level++) total += histogram.luma[level];

  const neutral: AutoToneResult = {
    tone: { ...DEFAULT_TONE },
    temperature: 0,
    tint: 0,
    measured: { black: 0, median: 0.5, white: 1, whiteClipShare: 0 },
  };
  if (total <= 0) return neutral;

  const black = percentile(histogram.luma, total, AUTO_TONE_BLACK_PERCENTILE);
  const median = percentile(histogram.luma, total, 0.5);
  const white = percentile(histogram.luma, total, AUTO_TONE_WHITE_PERCENTILE);
  const whiteClipShare = histogram.luma[SCOPE_LEVELS - 1] / total;

  const blackTarget = black > BLACK_BAND_TOP ? BLACK_TARGET : black;
  let whiteTarget = white;
  if (whiteClipShare > WHITE_CLIP_SHARE) whiteTarget = WHITE_CLIPPED_TARGET;
  else if (white < WHITE_BAND[0]) whiteTarget = WHITE_TARGET;
  else if (white > WHITE_BAND[1]) whiteTarget = WHITE_BAND[1];
  const medianTarget =
    median < MEDIAN_BAND[0] || median > MEDIAN_BAND[1]
      ? AUTO_TONE_TARGET_MEDIAN
      : median;

  const tone = fitTone([
    { at: black, target: blackTarget },
    { at: median, target: medianTarget },
    { at: white, target: whiteTarget },
  ]);

  let temperature = 0;
  let tint = 0;
  if (options.whiteBalance) {
    const red = histogramMean(histogram.red, total);
    const green = histogramMean(histogram.green, total);
    const blue = histogramMean(histogram.blue, total);
    const sum = red + green + blue;
    if (sum > 0.05) {
      // Warm cast (red over blue) is cancelled with a negative temperature.
      const warmth = (red - blue) / (sum / 3);
      const magenta = ((red + blue) / 2 - green) / (sum / 3);
      if (Math.abs(warmth) > CAST_DEAD_BAND) {
        temperature = clamp(Math.round(-warmth * 100), -MAX_WB, MAX_WB);
      }
      if (Math.abs(magenta) > CAST_DEAD_BAND) {
        tint = clamp(Math.round(-magenta * 100), -MAX_WB, MAX_WB);
      }
    }
  }

  return {
    tone,
    temperature,
    tint,
    measured: { black, median, white, whiteClipShare },
  };
}
