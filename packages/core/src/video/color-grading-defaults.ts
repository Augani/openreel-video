import type {
  ColorWheelValues,
  CurvesValues,
  HSLValues,
  LUTData,
} from "./color-grading-engine";
import type { CurvePoint } from "../types/effects";

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
  if (!value.data || value.data.length === 0 || value.size <= 0) {
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

export interface NeutralColorGradingInput {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: LUTData;
  hsl?: HSLValues;
  temperature?: number;
  tint?: number;
}

export function isNeutralColorGrading(
  settings: NeutralColorGradingInput,
): boolean {
  return (
    isNeutralColorWheels(settings.colorWheels) &&
    isNeutralCurves(settings.curves) &&
    isNeutralLut(settings.lut) &&
    isNeutralHsl(settings.hsl) &&
    approxEqual(settings.temperature ?? 0, 0) &&
    approxEqual(settings.tint ?? 0, 0)
  );
}
