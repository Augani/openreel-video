import type { CurvePoint } from "../types/effects";

/**
 * Lumetri-style hue-keyed curves: Hue vs Sat, Hue vs Hue, Hue vs Luma and
 * Luma vs Sat.
 *
 * Every curve maps an input axis (hue 0..1 around the colour wheel, or luma
 * 0..1) to an output in 0..1 where 0.5 is neutral:
 *
 *  - Hue vs Sat / Luma vs Sat: saturation gain = 2 * y (0 = grey, 0.5 = none, 1 = x2).
 *  - Hue vs Hue: hue rotation = (y - 0.5) * 0.5 turns, i.e. +/-90 degrees.
 *  - Hue vs Luma: lightness offset = (y - 0.5) * 0.5.
 *
 * Each curve is baked into a 256-entry Float32 LUT (`buildHueCurveLut`) and the
 * pixel math (`applyHueCurvesToRgb`) is written once in plain float so the CPU
 * reference and the GLSL port (`HUE_CURVES_GLSL`) run the same arithmetic on
 * the same LUT data. Nothing in here quantises to 8 bits.
 */

export type HueCurveKind = "hueVsSat" | "hueVsHue" | "hueVsLuma" | "lumaVsSat";

export const HUE_CURVE_KINDS: readonly HueCurveKind[] = [
  "hueVsSat",
  "hueVsHue",
  "hueVsLuma",
  "lumaVsSat",
];

/** Serializable curve set stored on a clip's colour grading. */
export type HueCurvesValues = Record<HueCurveKind, CurvePoint[]>;

export const HUE_CURVE_LUT_SIZE = 256;

/** Hue-keyed adjustments fade out below this saturation so near-grey noise does not flicker in hue. */
const HUE_FADE_SATURATION = 0.08;
const HUE_SHIFT_TURNS = 0.5;
const HUE_LUMA_RANGE = 0.5;

const EPSILON = 1e-6;
const NEUTRAL_Y = 0.5;

export const HUE_CURVE_INFO: Record<
  HueCurveKind,
  { label: string; periodic: boolean; description: string }
> = {
  hueVsSat: {
    label: "Hue vs Sat",
    periodic: true,
    description: "Raise or lower saturation for one range of hues.",
  },
  hueVsHue: {
    label: "Hue vs Hue",
    periodic: true,
    description: "Rotate one range of hues (up to 90 degrees either way).",
  },
  hueVsLuma: {
    label: "Hue vs Luma",
    periodic: true,
    description: "Lighten or darken one range of hues.",
  },
  lumaVsSat: {
    label: "Luma vs Sat",
    periodic: false,
    description: "Raise or lower saturation in the shadows, mids or highlights.",
  },
};

export function createFlatHueCurve(): CurvePoint[] {
  return [
    { x: 0, y: NEUTRAL_Y },
    { x: 1, y: NEUTRAL_Y },
  ];
}

export function createDefaultHueCurves(): HueCurvesValues {
  return {
    hueVsSat: createFlatHueCurve(),
    hueVsHue: createFlatHueCurve(),
    hueVsLuma: createFlatHueCurve(),
    lumaVsSat: createFlatHueCurve(),
  };
}

export const DEFAULT_HUE_CURVES: HueCurvesValues = createDefaultHueCurves();

function isFlatCurve(points: CurvePoint[] | undefined): boolean {
  if (!points || points.length === 0) return true;
  return points.every((point) => Math.abs(point.y - NEUTRAL_Y) < EPSILON);
}

export function isNeutralHueCurves(value: HueCurvesValues | undefined): boolean {
  if (!value) return true;
  return HUE_CURVE_KINDS.every((kind) => isFlatCurve(value[kind]));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Clamps, drops non-finite points and orders by x. */
export function normalizeHueCurvePoints(points: CurvePoint[] | undefined): CurvePoint[] {
  const cleaned = (points ?? [])
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }))
    .sort((a, b) => a.x - b.x);
  const deduped: CurvePoint[] = [];
  for (const point of cleaned) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-4) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
}

/**
 * Monotone cubic Hermite (Fritsch-Carlson) through the points: passes through
 * every control point and never overshoots between neighbours, so a curve
 * drawn inside 0..1 stays inside 0..1.
 */
function hermiteEvaluator(points: CurvePoint[]): (x: number) => number {
  const n = points.length;
  if (n === 1) return () => points[0].y;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    secants.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x));
  }
  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangents[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(secants[i]) < 1e-12) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / secants[i];
    const b = tangents[i + 1] / secants[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangents[i] = tau * a * secants[i];
      tangents[i + 1] = tau * b * secants[i];
    }
  }
  return (x: number): number => {
    if (x <= points[0].x) return points[0].y;
    if (x >= points[n - 1].x) return points[n - 1].y;
    let segment = 0;
    while (segment < n - 2 && x > points[segment + 1].x) segment++;
    const p0 = points[segment];
    const p1 = points[segment + 1];
    const h = p1.x - p0.x;
    const t = (x - p0.x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * p0.y +
      (t3 - 2 * t2 + t) * h * tangents[segment] +
      (-2 * t3 + 3 * t2) * p1.y +
      (t3 - t2) * h * tangents[segment + 1]
    );
  };
}

/**
 * Bakes control points into a 256-entry LUT, index i = input i / 255 (luma
 * axis) or i / 256 (hue axis, whose 1.0 wraps back to 0.0).
 *
 * `periodic` curves wrap: the control points are replicated one turn either
 * side so the curve is continuous (and smooth) across red.
 */
export function buildHueCurveLut(
  points: CurvePoint[] | undefined,
  periodic: boolean,
): Float32Array {
  const lut = new Float32Array(HUE_CURVE_LUT_SIZE);
  const normalized = normalizeHueCurvePoints(points);
  if (normalized.length === 0 || isFlatCurve(normalized)) {
    lut.fill(NEUTRAL_Y);
    return lut;
  }
  let control = normalized;
  if (periodic) {
    // x = 0 and x = 1 are the same hue: merge them (average) so the replicated
    // control points never share an x.
    let ring = normalized;
    if (ring.length > 1 && ring[0].x < 1e-4 && ring[ring.length - 1].x > 1 - 1e-4) {
      const merged = { x: 0, y: (ring[0].y + ring[ring.length - 1].y) / 2 };
      ring = [merged, ...ring.slice(1, -1)];
    }
    control = [
      ...ring.map((p) => ({ x: p.x - 1, y: p.y })),
      ...ring,
      ...ring.map((p) => ({ x: p.x + 1, y: p.y })),
    ];
  }
  const evaluate = hermiteEvaluator(control);
  const divisor = periodic ? HUE_CURVE_LUT_SIZE : HUE_CURVE_LUT_SIZE - 1;
  for (let i = 0; i < HUE_CURVE_LUT_SIZE; i++) {
    lut[i] = clamp01(evaluate(i / divisor));
  }
  return lut;
}

/** Evaluates a baked LUT at x with linear interpolation, wrapping when `periodic`. */
export function sampleHueCurveLut(lut: Float32Array, x: number, periodic: boolean): number {
  const size = lut.length;
  if (periodic) {
    const wrapped = x - Math.floor(x);
    const position = wrapped * size;
    const lower = Math.floor(position);
    const fraction = position - lower;
    const a = lut[lower % size];
    const b = lut[(lower + 1) % size];
    return a + (b - a) * fraction;
  }
  const position = clamp01(x) * (size - 1);
  const lower = Math.floor(position);
  const upper = Math.min(size - 1, lower + 1);
  const fraction = position - lower;
  return lut[lower] + (lut[upper] - lut[lower]) * fraction;
}

export type HueCurveLuts = Record<HueCurveKind, Float32Array>;

export function buildHueCurveLuts(values: HueCurvesValues): HueCurveLuts {
  return {
    hueVsSat: buildHueCurveLut(values.hueVsSat, HUE_CURVE_INFO.hueVsSat.periodic),
    hueVsHue: buildHueCurveLut(values.hueVsHue, HUE_CURVE_INFO.hueVsHue.periodic),
    hueVsLuma: buildHueCurveLut(values.hueVsLuma, HUE_CURVE_INFO.hueVsLuma.periodic),
    lumaVsSat: buildHueCurveLut(values.lumaVsSat, HUE_CURVE_INFO.lumaVsSat.periodic),
  };
}

/**
 * RGBA32F texel data for the GPU: one texel per LUT index with
 * (hueVsSat, hueVsHue, hueVsLuma, lumaVsSat) in r, g, b, a.
 */
export function packHueCurveLuts(luts: HueCurveLuts): Float32Array {
  const packed = new Float32Array(HUE_CURVE_LUT_SIZE * 4);
  for (let i = 0; i < HUE_CURVE_LUT_SIZE; i++) {
    packed[i * 4] = luts.hueVsSat[i];
    packed[i * 4 + 1] = luts.hueVsHue[i];
    packed[i * 4 + 2] = luts.hueVsLuma[i];
    packed[i * 4 + 3] = luts.lumaVsSat[i];
  }
  return packed;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hueChannel(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueChannel(p, q, h + 1 / 3), hueChannel(p, q, h), hueChannel(p, q, h - 1 / 3)];
}

/**
 * Applies the four curves to one pixel (components 0..1, any rounding is the
 * caller's). This is the single float reference the GLSL port mirrors.
 */
export function applyHueCurvesToRgb(
  r: number,
  g: number,
  b: number,
  luts: HueCurveLuts,
): [number, number, number] {
  const cr = clamp01(r);
  const cg = clamp01(g);
  const cb = clamp01(b);
  const luma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
  const [h, s, l] = rgbToHsl(cr, cg, cb);
  const weight = smoothstep(0, HUE_FADE_SATURATION, s);

  const hueSat = sampleHueCurveLut(luts.hueVsSat, h, true);
  const hueShift = sampleHueCurveLut(luts.hueVsHue, h, true);
  const hueLuma = sampleHueCurveLut(luts.hueVsLuma, h, true);
  const lumaSat = sampleHueCurveLut(luts.lumaVsSat, luma, false);

  const satGain = (1 + (2 * hueSat - 1) * weight) * (2 * lumaSat);
  const nextHue = h + (hueShift - NEUTRAL_Y) * HUE_SHIFT_TURNS * weight;
  const nextSat = clamp01(s * satGain);
  const nextLight = clamp01(l + (hueLuma - NEUTRAL_Y) * HUE_LUMA_RANGE * weight);
  return hslToRgb(nextHue - Math.floor(nextHue), nextSat, nextLight);
}

/**
 * GLSL ES 3.00 port of `applyHueCurvesToRgb`. Expects a `sampler2D u_hueCurves`
 * (RGBA32F, 256x1, fetched with texelFetch so no float-linear extension is
 * needed) and provides `vec3 applyHueCurves(vec3 rgb)`.
 */
export const HUE_CURVES_GLSL = `
uniform sampler2D u_hueCurves;

vec3 hcRgb2Hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = (maxC + minC) / 2.0;
  if (maxC == minC) return vec3(0.0, 0.0, l);
  float d = maxC - minC;
  float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
  float h;
  if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

float hcHueChannel(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hcHsl2Rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hcHueChannel(p, q, hsl.x + 1.0 / 3.0),
    hcHueChannel(p, q, hsl.x),
    hcHueChannel(p, q, hsl.x - 1.0 / 3.0)
  );
}

vec4 hcFetch(int index) {
  return texelFetch(u_hueCurves, ivec2(index, 0), 0);
}

vec4 hcSamplePeriodic(float x) {
  float wrapped = x - floor(x);
  float position = wrapped * 256.0;
  float lower = floor(position);
  float fraction = position - lower;
  int i0 = int(lower) % 256;
  int i1 = (i0 + 1) % 256;
  return mix(hcFetch(i0), hcFetch(i1), fraction);
}

vec4 hcSampleClamped(float x) {
  float position = clamp(x, 0.0, 1.0) * 255.0;
  float lower = floor(position);
  float fraction = position - lower;
  int i0 = int(lower);
  int i1 = min(255, i0 + 1);
  return mix(hcFetch(i0), hcFetch(i1), fraction);
}

vec3 applyHueCurves(vec3 rgb) {
  vec3 c = clamp(rgb, 0.0, 1.0);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 hsl = hcRgb2Hsl(c);
  float weight = smoothstep(0.0, ${HUE_FADE_SATURATION.toFixed(2)}, hsl.y);
  vec4 byHue = hcSamplePeriodic(hsl.x);
  vec4 byLuma = hcSampleClamped(luma);
  float satGain = (1.0 + (2.0 * byHue.r - 1.0) * weight) * (2.0 * byLuma.a);
  float nextHue = hsl.x + (byHue.g - 0.5) * ${HUE_SHIFT_TURNS.toFixed(2)} * weight;
  float nextSat = clamp(hsl.y * satGain, 0.0, 1.0);
  float nextLight = clamp(hsl.z + (byHue.b - 0.5) * ${HUE_LUMA_RANGE.toFixed(2)} * weight, 0.0, 1.0);
  return hcHsl2Rgb(vec3(nextHue - floor(nextHue), nextSat, nextLight));
}
`;
