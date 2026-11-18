import type {
  ColorWheelValues,
  CurvesValues,
  HSLValues,
  LUTData,
  ToneValues,
  VignetteValues,
} from "./color-grading-engine";
import type { CurvePoint } from "../types/effects";
import { isNeutralHueCurves, type HueCurvesValues } from "./hue-curves";

export const DEFAULT_COLOR_WHEELS: ColorWheelValues = {
  shadows: { r: 0, g: 0, b: 0 },
  midtones: { r: 0, g: 0, b: 0 },
  highlights: { r: 0, g: 0, b: 0 },
  shadowsLift: 0,
  midtonesGamma: 1,
  highlightsGain: 1,
};

export const DEFAULT_CURVES: CurvesValues = {
  rgb: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  blue: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

export const DEFAULT_HSL: HSLValues = {
  hue: [0, 0, 0, 0, 0, 0, 0, 0],
  saturation: [0, 0, 0, 0, 0, 0, 0, 0],
  luminance: [0, 0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_TONE: ToneValues = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
};

export const DEFAULT_VIGNETTE: VignetteValues = {
  amount: 0,
  midpoint: 0.5,
  roundness: 0,
  feather: 0.5,
};

const EPSILON = 1e-6;

function approxEqual(value: number, target: number): boolean {
  return Math.abs(value - target) < EPSILON;
}

function isNeutralRgbChannel(channel: {
  r: number;
  g: number;
  b: number;
}): boolean {
  return (
    approxEqual(channel.r, 0) &&
    approxEqual(channel.g, 0) &&
    approxEqual(channel.b, 0)
  );
}

function isIdentityCurve(points: CurvePoint[] | undefined): boolean {
  if (!points || points.length === 0) {
    return true;
  }
  if (points.length !== 2) {
    return false;
  }
  const [first, second] = points;
  return (
    approxEqual(first.x, 0) &&
    approxEqual(first.y, 0) &&
    approxEqual(second.x, 1) &&
    approxEqual(second.y, 1)
  );
}

function isAllZero(values: number[] | undefined): boolean {
  if (!values || values.length === 0) {
    return true;
  }
  return values.every((value) => approxEqual(value, 0));
}

export function isNeutralColorWheels(
  value: ColorWheelValues | undefined,
): boolean {
  if (!value) {
    return true;
  }
  return (
    isNeutralRgbChannel(value.shadows) &&
    isNeutralRgbChannel(value.midtones) &&
    isNeutralRgbChannel(value.highlights) &&
    approxEqual(value.shadowsLift, 0) &&
    approxEqual(value.midtonesGamma, 1) &&
    approxEqual(value.highlightsGain, 1)
  );
}

export function isNeutralCurves(value: CurvesValues | undefined): boolean {
  if (!value) {
    return true;
  }
  return (
    isIdentityCurve(value.rgb) &&
    isIdentityCurve(value.red) &&
    isIdentityCurve(value.green) &&
    isIdentityCurve(value.blue)
  );
}

export function isNeutralLut(value: LUTData | undefined): boolean {
  if (!value) {
    return true;
  }
  // A table is a float table, an 8-bit table or an exact 1D curve; the 8-bit table alone is not required.
  const hasTable =
    (!!value.data && value.data.length > 0) ||
    (!!value.floatData && value.floatData.length > 0) ||
    !!value.curve1d;
  if (!hasTable || value.size <= 0) {
    return true;
  }
  return approxEqual(value.intensity, 0);
}

export function isNeutralHsl(value: HSLValues | undefined): boolean {
  if (!value) {
    return true;
  }
  return (
    isAllZero(value.hue) &&
    isAllZero(value.saturation) &&
    isAllZero(value.luminance)
  );
}

export function isNeutralTone(value: ToneValues | undefined): boolean {
  if (!value) {
    return true;
  }
  return (
    approxEqual(value.exposure, 0) &&
    approxEqual(value.contrast, 0) &&
    approxEqual(value.highlights, 0) &&
    approxEqual(value.shadows, 0) &&
    approxEqual(value.whites, 0) &&
    approxEqual(value.blacks, 0)
  );
}

/** A vignette is neutral whenever its amount is 0, whatever the shape. */
export function isNeutralVignette(value: VignetteValues | undefined): boolean {
  return !value || approxEqual(value.amount, 0);
}

export interface NeutralColorGradingInput {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: LUTData;
  /** Input LUT, applied before the grade. */
  inputLut?: LUTData;
  hsl?: HSLValues;
  temperature?: number;
  tint?: number;
  tone?: ToneValues;
  vignette?: VignetteValues;
  hueCurves?: HueCurvesValues;
  /** 2 = Premiere-order pipeline. Hue curves only render on it. */
  pipelineVersion?: number;
}

export function isNeutralColorGrading(
  settings: NeutralColorGradingInput,
): boolean {
  return (
    isNeutralColorWheels(settings.colorWheels) &&
    isNeutralCurves(settings.curves) &&
    isNeutralLut(settings.lut) &&
    isNeutralLut(settings.inputLut) &&
    isNeutralHsl(settings.hsl) &&
    approxEqual(settings.temperature ?? 0, 0) &&
    approxEqual(settings.tint ?? 0, 0) &&
    isNeutralTone(settings.tone) &&
    isNeutralVignette(settings.vignette) &&
    (settings.pipelineVersion !== 2 || isNeutralHueCurves(settings.hueCurves))
  );
}
