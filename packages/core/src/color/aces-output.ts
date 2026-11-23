/**
 * ACES Output Transform (RRT + ODT) and its building blocks: the segmented splines, the RRT sweeteners, the SDR cinema
 * ODT and the 1000 nit HDR transform with its PQ / HLG encodings. Ported from the ACES 1.3 CTL reference (see `aces.ts`
 * for the sources and the units).
 *
 * This file is deliberately separate from `aces.ts` (the matrices, ACEScct and the settings helpers the startup bundle
 * needs): the Output Transform is only run by the compositors, so the video engine registers it with
 * `registerAcesOutputTransform` and the startup entry never carries it.
 */

import { gamutDef, gamutToXyz, invert3x3 } from "./camera-log";
import {
  AP0_TO_AP1,
  AP1_RGB2Y,
  AP1_TO_AP0,
  AP1_TO_XYZ,
  D60_TO_D65,
  XYZ_TO_AP1,
  type AcesMatrix3 as Matrix3,
  type AcesOutputId,
  type AcesSdrOutput,
} from "./aces";

const REC709_PRIMARIES = /* @__PURE__ */ gamutDef("rec709");
const REC2020_PRIMARIES = /* @__PURE__ */ gamutDef("bt2020");
// -- RRT building blocks (ACESlib.RRT_Common.ctl, ACESlib.Utilities_Color.ctl) ---------------------------------------

const HALF_MIN = 5.96046448e-8;
const HALF_MAX = 65504;
const TINY = 1e-10;
const log10 = Math.log10;

const RRT_GLOW_GAIN = 0.05;
const RRT_GLOW_MID = 0.08;
const RRT_RED_SCALE = 0.82;
const RRT_RED_PIVOT = 0.03;
const RRT_RED_HUE = 0;
const RRT_RED_WIDTH = 135;
const RRT_SAT_FACTOR = 0.96;
const ODT_SAT_FACTOR = 0.93;
const DIM_SURROUND_GAMMA = 0.9811;
const CINEMA_WHITE = 48;
const CINEMA_BLACK = 0.02;

/** The sat-adjust matrix of the CTL (`calc_sat_adjust_matrix`) in column-vector form: out = (1-s) Y + s c. */
function satMatrix(sat: number): Matrix3 {
  const [rw, gw, bw] = AP1_RGB2Y;
  const k = 1 - sat;
  return [
    [k * rw + sat, k * gw, k * bw],
    [k * rw, k * gw + sat, k * bw],
    [k * rw, k * gw, k * bw + sat],
  ];
}
export const RRT_SAT_MAT: Matrix3 = /* @__PURE__ */ satMatrix(RRT_SAT_FACTOR);
export const ODT_SAT_MAT: Matrix3 = /* @__PURE__ */ satMatrix(ODT_SAT_FACTOR);

function glowFwd(ycIn: number, glowGainIn: number, glowMid: number): number {
  if (ycIn <= (2 / 3) * glowMid) return glowGainIn;
  if (ycIn >= 2 * glowMid) return 0;
  return glowGainIn * (glowMid / ycIn - 0.5);
}

function sigmoidShaper(x: number): number {
  const t = Math.max(1 - Math.abs(x / 2), 0);
  return (1 + Math.sign(x) * (1 - t * t)) / 2;
}

function cubicBasisShaper(x: number, w: number): number {
  const knots0 = -w / 2;
  const knots4 = w / 2;
  let y = 0;
  if (x > knots0 && x < knots4) {
    const coord = ((x - knots0) * 4) / w;
    const j = Math.trunc(coord);
    const t = coord - j;
    const m0 = t * t * t;
    const m1 = t * t;
    // Columns of the CTL's M matrix, selected by j (3, 2, 1, 0), dotted with {t^3, t^2, t, 1}.
    if (j === 3) y = m0 * (-1 / 6) + m1 * (3 / 6) + t * (-3 / 6) + 1 / 6;
    else if (j === 2) y = m0 * (3 / 6) + m1 * (-6 / 6) + t * 0 + 4 / 6;
    else if (j === 1) y = m0 * (-3 / 6) + m1 * (3 / 6) + t * (3 / 6) + 1 / 6;
    else if (j === 0) y = m0 * (1 / 6);
  }
  return (y * 3) / 2;
}

function rgbToSaturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return (Math.max(mx, TINY) - Math.max(mn, TINY)) / Math.max(mx, 1e-2);
}

function rgbToYc(r: number, g: number, b: number): number {
  const chroma = Math.sqrt(Math.max(b * (b - g) + g * (g - r) + r * (r - b), 0));
  return (b + g + r + 1.75 * chroma) / 3;
}

/** Geometric hue in degrees; NaN for neutrals like the CTL (a NaN hue gives the red modifier weight 0). */
function rgbToHue(r: number, g: number, b: number): number {
  if (r === g && g === b) return Number.NaN;
  let hue = (180 / Math.PI) * Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
  if (hue < 0) hue += 360;
  return hue;
}

function centerHue(hue: number, center: number): number {
  const h = hue - center;
  if (h < -180) return h + 360;
  if (h > 180) return h - 360;
  return h;
}

/**
 * `rrt_sweeteners`: glow module, red modifier, AP0 -> AP1, global desaturation. Input ACES2065-1 (AP0), output AP1
 * with the RRT saturation applied, ready for a tone scale.
 */
function rrtSweeteners(r: number, g: number, b: number, out: number[]): void {
  const saturation = rgbToSaturation(r, g, b);
  const ycIn = rgbToYc(r, g, b);
  const s = sigmoidShaper((saturation - 0.4) / 0.2);
  const glow = 1 + glowFwd(ycIn, RRT_GLOW_GAIN * s, RRT_GLOW_MID);
  r *= glow;
  g *= glow;
  b *= glow;
  const hue = rgbToHue(r, g, b);
  const weight = cubicBasisShaper(centerHue(hue, RRT_RED_HUE), RRT_RED_WIDTH);
  r = r + weight * saturation * (RRT_RED_PIVOT - r) * (1 - RRT_RED_SCALE);
  r = Math.min(Math.max(r, 0), HALF_MAX);
  g = Math.min(Math.max(g, 0), HALF_MAX);
  b = Math.min(Math.max(b, 0), HALF_MAX);
  const a = AP0_TO_AP1;
  let pr = a[0][0] * r + a[0][1] * g + a[0][2] * b;
  let pg = a[1][0] * r + a[1][1] * g + a[1][2] * b;
  let pb = a[2][0] * r + a[2][1] * g + a[2][2] * b;
  pr = Math.min(Math.max(pr, 0), HALF_MAX);
  pg = Math.min(Math.max(pg, 0), HALF_MAX);
  pb = Math.min(Math.max(pb, 0), HALF_MAX);
  const m = RRT_SAT_MAT;
  out[0] = m[0][0] * pr + m[0][1] * pg + m[0][2] * pb;
  out[1] = m[1][0] * pr + m[1][1] * pg + m[1][2] * pb;
  out[2] = m[2][0] * pr + m[2][1] * pg + m[2][2] * pb;
}

// -- segmented splines (ACESlib.Tonescales.ctl, ACESlib.SSTS.ctl) ------------------------------------------------

export interface SplineParams {
  /** B-spline coefficients below the mid point (log10 of luminance): 6 for the c5 shape, 10 for c9. */
  readonly coefsLow: readonly number[];
  readonly coefsHigh: readonly number[];
  readonly minX: number;
  readonly minY: number;
  readonly midX: number;
  readonly midY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly slopeLow: number;
  readonly slopeHigh: number;
}

function quadratic(c0: number, c1: number, c2: number, t: number): number {
  return (0.5 * c0 - c1 + 0.5 * c2) * t * t + (-c0 + c1) * t + 0.5 * c0 + 0.5 * c1;
}

/** `segmented_spline_c5_fwd`, `segmented_spline_c9_fwd` and `ssts`: one implementation, the knot count follows the coefficient count. */
export function splineForward(x: number, c: SplineParams): number {
  const nLow = c.coefsLow.length - 2;
  const nHigh = c.coefsHigh.length - 2;
  const logx = log10(Math.max(x, HALF_MIN));
  const logMinX = log10(c.minX);
  const logMidX = log10(c.midX);
  const logMaxX = log10(c.maxX);
  let logy: number;
  if (logx <= logMinX) {
    logy = logx * c.slopeLow + (log10(c.minY) - c.slopeLow * logMinX);
  } else if (logx < logMidX) {
    const coord = ((nLow - 1) * (logx - logMinX)) / (logMidX - logMinX);
    const j = Math.trunc(coord);
    logy = quadratic(c.coefsLow[j], c.coefsLow[j + 1], c.coefsLow[j + 2], coord - j);
  } else if (logx < logMaxX) {
    const coord = ((nHigh - 1) * (logx - logMidX)) / (logMaxX - logMidX);
    const j = Math.trunc(coord);
    logy = quadratic(c.coefsHigh[j], c.coefsHigh[j + 1], c.coefsHigh[j + 2], coord - j);
  } else {
    logy = logx * c.slopeHigh + (log10(c.maxY) - c.slopeHigh * logMaxX);
  }
  return Math.pow(10, logy);
}

/** `segmented_spline_*_rev` / `inv_ssts`. */
export function splineInverse(y: number, c: SplineParams): number {
  const nLow = c.coefsLow.length - 2;
  const nHigh = c.coefsHigh.length - 2;
  const logMinX = log10(c.minX);
  const logMidX = log10(c.midX);
  const logMaxX = log10(c.maxX);
  const knotIncLow = (logMidX - logMinX) / (nLow - 1);
  const knotIncHigh = (logMaxX - logMidX) / (nHigh - 1);
  const logy = log10(Math.max(y, 1e-10));
  const solve = (coefs: readonly number[], nKnots: number, base: number, inc: number): number => {
    const knotY: number[] = [];
    for (let i = 0; i < nKnots; i++) knotY.push((coefs[i] + coefs[i + 1]) / 2);
    let j = 0;
    for (let k = 0; k < nKnots - 1; k++) {
      if (logy > knotY[k] && logy <= knotY[k + 1]) {
        j = k;
        break;
      }
      if (k === 0 && logy === knotY[0]) {
        j = 0;
        break;
      }
    }
    const c0 = coefs[j];
    const c1 = coefs[j + 1];
    const c2 = coefs[j + 2];
    const a = 0.5 * c0 - c1 + 0.5 * c2;
    const b = -c0 + c1;
    const c = 0.5 * c0 + 0.5 * c1 - logy;
    const d = Math.sqrt(b * b - 4 * a * c);
    const t = (2 * c) / (-d - b);
    return base + (t + j) * inc;
  };
  let logx: number;
  if (logy <= log10(c.minY)) logx = logMinX;
  else if (logy <= log10(c.midY)) logx = solve(c.coefsLow, nLow, logMinX, knotIncLow);
  else if (logy < log10(c.maxY)) logx = solve(c.coefsHigh, nHigh, logMidX, knotIncHigh);
  else logx = logMaxX;
  return Math.pow(10, logx);
}

/** RRT tone scale (c5): `RRT_PARAMS` of ACESlib.Tonescales.ctl. */
export const RRT_SPLINE: SplineParams = {
  coefsLow: [-4.0, -4.0, -3.1573765773, -0.4852499958, 1.8477324706, 1.8477324706],
  coefsHigh: [-0.7185482425, 2.0810307172, 3.6681241237, 4.0, 4.0, 4.0],
  minX: 0.18 * Math.pow(2, -15),
  minY: 0.0001,
  midX: 0.18,
  midY: 4.8,
  maxX: 0.18 * Math.pow(2, 18),
  maxY: 10000,
  slopeLow: 0,
  slopeHigh: 0,
};

/** The 48 nit cinema ODT tone scale (c9): `ODT_48nits`, whose points are the RRT spline at the stops 0.18 x 2^-6.5, 0.18 and 0.18 x 2^6.5. */
export const ODT_48_SPLINE: SplineParams = {
  coefsLow: [-1.6989700043, -1.6989700043, -1.4779, -1.2291, -0.8648, -0.448, 0.00518, 0.4511080334, 0.9113744414, 0.9113744414],
  coefsHigh: [0.5154386965, 0.8470437783, 1.1358, 1.3802, 1.5197, 1.5985, 1.6467, 1.6746091357, 1.6878733390, 1.6878733390],
  minX: /* @__PURE__ */ splineForward(0.18 * Math.pow(2, -6.5), RRT_SPLINE),
  minY: 0.02,
  midX: /* @__PURE__ */ splineForward(0.18, RRT_SPLINE),
  midY: 4.8,
  maxX: /* @__PURE__ */ splineForward(0.18 * Math.pow(2, 6.5), RRT_SPLINE),
  maxY: 48,
  slopeLow: 0,
  slopeHigh: 0.04,
};

// -- single stage tone scale (ACESlib.SSTS.ctl) ------------------------------------------------------------------

const MIN_STOP_SDR = -6.5;
const MAX_STOP_SDR = 6.5;
const MIN_STOP_RRT = -15;
const MAX_STOP_RRT = 18;
const MIN_LUM_SDR = 0.02;
const MAX_LUM_SDR = 48;
const MIN_LUM_RRT = 0.0001;
const MAX_LUM_RRT = 10000;

/** CTL `interpolate1D` over a two-row table, clamped at both ends. */
function interpolate2(table: readonly [readonly [number, number], readonly [number, number]], x: number): number {
  const [[x0, y0], [x1, y1]] = table;
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

function lookupAcesMin(minLum: number): number {
  return 0.18 * Math.pow(2, interpolate2([[log10(MIN_LUM_RRT), MIN_STOP_RRT], [log10(MIN_LUM_SDR), MIN_STOP_SDR]], log10(minLum)));
}
function lookupAcesMax(maxLum: number): number {
  return 0.18 * Math.pow(2, interpolate2([[log10(MAX_LUM_SDR), MAX_STOP_SDR], [log10(MAX_LUM_RRT), MAX_STOP_RRT]], log10(maxLum)));
}

/** `init_TsParams(minLum, maxLum, expShift)`. */
export function initTsParams(minLum: number, maxLum: number, expShift = 0): SplineParams {
  const minPt = { x: lookupAcesMin(minLum), y: minLum, slope: 0 };
  const midPt = { x: 0.18, y: 4.8, slope: 1.55 };
  const maxPt = { x: lookupAcesMax(maxLum), y: maxLum, slope: 0 };

  const knotIncLow = (log10(midPt.x) - log10(minPt.x)) / 3;
  const lowLine = (p: { x: number; y: number; slope: number }, dx: number): number => p.slope * (log10(p.x) + dx) + (log10(p.y) - p.slope * log10(p.x));
  const cLow = [0, 0, 0, 0, 0];
  cLow[0] = lowLine(minPt, -0.5 * knotIncLow);
  cLow[1] = lowLine(minPt, 0.5 * knotIncLow);
  cLow[3] = lowLine(midPt, -0.5 * knotIncLow);
  cLow[4] = lowLine(midPt, 0.5 * knotIncLow);
  const pctLow = interpolate2([[MIN_STOP_RRT, 0.18], [MIN_STOP_SDR, 0.35]], Math.log2(minPt.x / 0.18));
  cLow[2] = log10(minPt.y) + pctLow * (log10(midPt.y) - log10(minPt.y));

  const knotIncHigh = (log10(maxPt.x) - log10(midPt.x)) / 3;
  const cHigh = [0, 0, 0, 0, 0];
  cHigh[0] = lowLine(midPt, -0.5 * knotIncHigh);
  cHigh[1] = lowLine(midPt, 0.5 * knotIncHigh);
  cHigh[3] = lowLine(maxPt, -0.5 * knotIncHigh);
  cHigh[4] = lowLine(maxPt, 0.5 * knotIncHigh);
  const pctHigh = interpolate2([[MAX_STOP_SDR, 0.89], [MAX_STOP_RRT, 0.9]], Math.log2(maxPt.x / 0.18));
  cHigh[2] = log10(midPt.y) + pctHigh * (log10(maxPt.y) - log10(midPt.y));

  const shift = (x: number): number => Math.pow(2, Math.log2(x) - expShift);
  return {
    coefsLow: [cLow[0], cLow[1], cLow[2], cLow[3], cLow[4], cLow[4]],
    coefsHigh: [cHigh[0], cHigh[1], cHigh[2], cHigh[3], cHigh[4], cHigh[4]],
    minX: shift(minPt.x),
    minY: minPt.y,
    midX: shift(midPt.x),
    midY: midPt.y,
    maxX: shift(maxPt.x),
    maxY: maxPt.y,
    slopeLow: minPt.slope,
    slopeHigh: maxPt.slope,
  };
}

/** The HDR tone scale of an `outputTransform(Y_MIN, Y_MID, Y_MAX)`: init_TsParams with the exposure shift that puts 0.18 at Y_MID. */
export function hdrToneScale(yMin: number, yMid: number, yMax: number): SplineParams {
  const base = initTsParams(yMin, yMax);
  const expShift = Math.log2(splineInverse(yMid, base)) - Math.log2(0.18);
  return initTsParams(yMin, yMax, expShift);
}

/** Mastering display of the HDR output transforms (`Rec2020_1000nits_15nits`): black, mid grey and peak in nits. */
export const HDR_1000_Y_MIN = 0.0001;
export const HDR_1000_Y_MID = 15;
export const HDR_1000_Y_MAX = 1000;
export const HDR_1000_SPLINE: SplineParams = /* @__PURE__ */ hdrToneScale(HDR_1000_Y_MIN, HDR_1000_Y_MID, HDR_1000_Y_MAX);

// -- display encodings (ACESlib.Utilities_Color.ctl) -------------------------------------------------------------

/** `moncurve_r(y, 2.4, 0.055)`: the sRGB OETF with the exact 0.0031308 break. */
function srgbOetf(y: number): number {
  const gamma = 2.4;
  const offs = 0.055;
  const yb = Math.pow((offs * gamma) / ((gamma - 1) * (1 + offs)), gamma);
  const rs = Math.pow((gamma - 1) / offs, gamma - 1) * Math.pow((1 + offs) / gamma, gamma);
  return y >= yb ? (1 + offs) * Math.pow(y, 1 / gamma) - offs : y * rs;
}

/** `bt1886_r(L, 2.4, 1, 0)`: the BT.1886 inverse EOTF for a display with zero black. */
function bt1886Oetf(l: number): number {
  return Math.pow(Math.max(l, 0), 1 / 2.4);
}

const PQ_M1 = 0.1593017578125;
const PQ_M2 = 78.84375;
const PQ_C1 = 0.8359375;
const PQ_C2 = 18.8515625;
const PQ_C3 = 18.6875;

/** `Y_2_ST2084`: absolute luminance in nits to the PQ signal. */
export function nitsToPq(nits: number): number {
  const lm = Math.pow(Math.max(nits, 0) / 10000, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * lm) / (1 + PQ_C3 * lm), PQ_M2);
}

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;

/**
 * Display luminance (nits, 1000 nit peak, black 0) to the HLG signal: the inverse HLG OOTF for L_w = 1000 and gamma
 * 1.2 (BT.2100 table 5), then the HLG OETF. `ST2084_2_HLG_1000nits_f3` of the CTL, entered from nits directly.
 */
export function displayNitsToHlg(r: number, g: number, b: number, out: number[]): void {
  const yd = 0.2627 * r + 0.678 * g + 0.0593 * b;
  const k = yd === 0 ? 0 : Math.pow(yd / 1000, (1 - 1.2) / 1.2);
  const enc = (c: number): number => {
    const scene = yd === 0 ? 0 : k * (c / 1000);
    return scene <= 1 / 12 ? Math.sqrt(3 * scene) : HLG_A * Math.log(12 * scene - HLG_B) + HLG_C;
  };
  out[0] = enc(r);
  out[1] = enc(g);
  out[2] = enc(b);
}

// -- output transforms ---------------------------------------------------------------------------------------------

export const XYZ_TO_REC709: Matrix3 = /* @__PURE__ */ invert3x3(/* @__PURE__ */ gamutToXyz(REC709_PRIMARIES));
export const XYZ_TO_REC2020: Matrix3 = /* @__PURE__ */ invert3x3(/* @__PURE__ */ gamutToXyz(REC2020_PRIMARIES));
export const REC2020_TO_XYZ: Matrix3 = /* @__PURE__ */ gamutToXyz(REC2020_PRIMARIES);

/** `darkSurround_to_dimSurround` on AP1 linearCV (a gamma of 0.9811 on luminance Y of xyY). */
function darkToDim(r: number, g: number, b: number, out: number[]): void {
  const a = AP1_TO_XYZ;
  const X = a[0][0] * r + a[0][1] * g + a[0][2] * b;
  const Y0 = a[1][0] * r + a[1][1] * g + a[1][2] * b;
  const Z = a[2][0] * r + a[2][1] * g + a[2][2] * b;
  let sum = X + Y0 + Z;
  if (sum === 0) sum = 1e-10;
  const x = X / sum;
  const y = Y0 / sum;
  const Y = Math.pow(Math.min(Math.max(Y0, 0), HALF_MAX), DIM_SURROUND_GAMMA);
  const yy = Math.max(y, 1e-10);
  const X2 = (x * Y) / yy;
  const Z2 = ((1 - x - y) * Y) / yy;
  const m = XYZ_TO_AP1;
  out[0] = m[0][0] * X2 + m[0][1] * Y + m[0][2] * Z2;
  out[1] = m[1][0] * X2 + m[1][1] * Y + m[1][2] * Z2;
  out[2] = m[2][0] * X2 + m[2][1] * Y + m[2][2] * Z2;
}

const scratch = [0, 0, 0];
const scratch2 = [0, 0, 0];

/**
 * ACES2065-1 (AP0, scene-linear) to the display-encoded signal of an SDR output, per the CTL: RRT then
 * `ODT.Academy.sRGB_100nits_dim` / `ODT.Academy.Rec709_100nits_dim`. Alpha is not touched.
 */
export function acesToSdrDisplay(r: number, g: number, b: number, output: AcesSdrOutput, out: number[]): void {
  acesToSdrLinear(r, g, b, out);
  const encode = output === "srgb" ? srgbOetf : bt1886Oetf;
  out[0] = encode(out[0]);
  out[1] = encode(out[1]);
  out[2] = encode(out[2]);
}

/** The ACES 1.3 SDR video output transform up to CIE XYZ (D65), 1.0 = 100 nit, before any display gamut clamp or encoding. */
export function acesToSdrXyz(r: number, g: number, b: number, out: number[]): void {
  // RRT
  rrtSweeteners(r, g, b, scratch);
  const rr = splineForward(scratch[0], RRT_SPLINE);
  const rg = splineForward(scratch[1], RRT_SPLINE);
  const rb = splineForward(scratch[2], RRT_SPLINE);
  // OCES = AP1 -> AP0, then the ODT takes it back to AP1 (the CTLs do both multiplications).
  const a10 = AP1_TO_AP0;
  const oR = a10[0][0] * rr + a10[0][1] * rg + a10[0][2] * rb;
  const oG = a10[1][0] * rr + a10[1][1] * rg + a10[1][2] * rb;
  const oB = a10[2][0] * rr + a10[2][1] * rg + a10[2][2] * rb;
  const a01 = AP0_TO_AP1;
  const pR = a01[0][0] * oR + a01[0][1] * oG + a01[0][2] * oB;
  const pG = a01[1][0] * oR + a01[1][1] * oG + a01[1][2] * oB;
  const pB = a01[2][0] * oR + a01[2][1] * oG + a01[2][2] * oB;
  // ODT tone scale and scaling to linear code values
  const scale = 1 / (CINEMA_WHITE - CINEMA_BLACK);
  const lr = (splineForward(pR, ODT_48_SPLINE) - CINEMA_BLACK) * scale;
  const lg = (splineForward(pG, ODT_48_SPLINE) - CINEMA_BLACK) * scale;
  const lb = (splineForward(pB, ODT_48_SPLINE) - CINEMA_BLACK) * scale;
  darkToDim(lr, lg, lb, scratch2);
  const s = ODT_SAT_MAT;
  const sr = s[0][0] * scratch2[0] + s[0][1] * scratch2[1] + s[0][2] * scratch2[2];
  const sg = s[1][0] * scratch2[0] + s[1][1] * scratch2[1] + s[1][2] * scratch2[2];
  const sb = s[2][0] * scratch2[0] + s[2][1] * scratch2[1] + s[2][2] * scratch2[2];
  // AP1 -> XYZ -> D60 to D65 -> Rec.709 primaries
  const x1 = AP1_TO_XYZ;
  let X = x1[0][0] * sr + x1[0][1] * sg + x1[0][2] * sb;
  let Y = x1[1][0] * sr + x1[1][1] * sg + x1[1][2] * sb;
  let Z = x1[2][0] * sr + x1[2][1] * sg + x1[2][2] * sb;
  const c = D60_TO_D65;
  const X2 = c[0][0] * X + c[0][1] * Y + c[0][2] * Z;
  const Y2 = c[1][0] * X + c[1][1] * Y + c[1][2] * Z;
  const Z2 = c[2][0] * X + c[2][1] * Y + c[2][2] * Z;
  X = X2;
  Y = Y2;
  Z = Z2;
  out[0] = X;
  out[1] = Y;
  out[2] = Z;
}

/** The same up to the display encoding: linear Rec.709 / D65 light of the 100 nit SDR display, clamped to 0..1. */
export function acesToSdrLinear(r: number, g: number, b: number, out: number[]): void {
  acesToSdrXyz(r, g, b, out);
  const d = XYZ_TO_REC709;
  const X = out[0];
  const Y = out[1];
  const Z = out[2];
  out[0] = Math.min(Math.max(d[0][0] * X + d[0][1] * Y + d[0][2] * Z, 0), 1);
  out[1] = Math.min(Math.max(d[1][0] * X + d[1][1] * Y + d[1][2] * Z, 0), 1);
  out[2] = Math.min(Math.max(d[2][0] * X + d[2][1] * Y + d[2][2] * Z, 0), 1);
}

/**
 * ACES2065-1 to the display luminance (nits, Rec.2020 primaries, D65) of the 1000 nit HDR output transform: the
 * `outputTransform` of ACESlib.OutputTransforms.ctl with Y_MIN 0.0001, Y_MID 15, Y_MAX 1000, Rec.2020 display and
 * limiting primaries, stretched black.
 */
export function acesToHdr1000Xyz(r: number, g: number, b: number, out: number[]): void {
  rrtSweeteners(r, g, b, scratch);
  const tr = splineForward(scratch[0], HDR_1000_SPLINE);
  const tg = splineForward(scratch[1], HDR_1000_SPLINE);
  const tb = splineForward(scratch[2], HDR_1000_SPLINE);
  const span = 1 / (HDR_1000_Y_MAX - HDR_1000_Y_MIN);
  const lr = (tr - HDR_1000_Y_MIN) * span;
  const lg = (tg - HDR_1000_Y_MIN) * span;
  const lb = (tb - HDR_1000_Y_MIN) * span;
  const x1 = AP1_TO_XYZ;
  const X = x1[0][0] * lr + x1[0][1] * lg + x1[0][2] * lb;
  const Y = x1[1][0] * lr + x1[1][1] * lg + x1[1][2] * lb;
  const Z = x1[2][0] * lr + x1[2][1] * lg + x1[2][2] * lb;
  // limit_to_primaries (Rec.2020 limiting): clamp in the limiting RGB, back to XYZ
  const q = XYZ_TO_REC2020;
  const lim0 = Math.min(Math.max(q[0][0] * X + q[0][1] * Y + q[0][2] * Z, 0), 1);
  const lim1 = Math.min(Math.max(q[1][0] * X + q[1][1] * Y + q[1][2] * Z, 0), 1);
  const lim2 = Math.min(Math.max(q[2][0] * X + q[2][1] * Y + q[2][2] * Z, 0), 1);
  const p = REC2020_TO_XYZ;
  const Xl = p[0][0] * lim0 + p[0][1] * lim1 + p[0][2] * lim2;
  const Yl = p[1][0] * lim0 + p[1][1] * lim1 + p[1][2] * lim2;
  const Zl = p[2][0] * lim0 + p[2][1] * lim1 + p[2][2] * lim2;
  const c = D60_TO_D65;
  const X2 = c[0][0] * Xl + c[0][1] * Yl + c[0][2] * Zl;
  const Y2 = c[1][0] * Xl + c[1][1] * Yl + c[1][2] * Zl;
  const Z2 = c[2][0] * Xl + c[2][1] * Yl + c[2][2] * Zl;
  out[0] = X2;
  out[1] = Y2;
  out[2] = Z2;
}

export function acesToHdr1000Nits(r: number, g: number, b: number, out: number[]): void {
  acesToHdr1000Xyz(r, g, b, out);
  const X2 = out[0];
  const Y2 = out[1];
  const Z2 = out[2];
  const d = XYZ_TO_REC2020;
  out[0] = Math.min(Math.max(d[0][0] * X2 + d[0][1] * Y2 + d[0][2] * Z2, 0), HALF_MAX) * HDR_1000_Y_MAX;
  out[1] = Math.min(Math.max(d[1][0] * X2 + d[1][1] * Y2 + d[1][2] * Z2, 0), HALF_MAX) * HDR_1000_Y_MAX;
  out[2] = Math.min(Math.max(d[2][0] * X2 + d[2][1] * Y2 + d[2][2] * Z2, 0), HALF_MAX) * HDR_1000_Y_MAX;
}

/**
 * ACEScg (linear AP1, the pipeline's working space) to the display-encoded signal of an output transform.
 * `out` receives R'G'B' in 0..1: sRGB / BT.1886 for the SDR ids, the PQ or HLG signal of a 1000 nit display for
 * the Rec.2020 ids.
 */
export function acesOutputTransform(r: number, g: number, b: number, output: AcesOutputId, out: number[] = [0, 0, 0]): number[] {
  const m = AP1_TO_AP0;
  const ar = m[0][0] * r + m[0][1] * g + m[0][2] * b;
  const ag = m[1][0] * r + m[1][1] * g + m[1][2] * b;
  const ab = m[2][0] * r + m[2][1] * g + m[2][2] * b;
  acesAp0Output(ar, ag, ab, output, out);
  return out;
}

/** The same for an ACES2065-1 (AP0) input. */
export function acesAp0Output(r: number, g: number, b: number, output: AcesOutputId, out: number[] = [0, 0, 0]): number[] {
  if (output === "srgb" || output === "rec709") {
    acesToSdrDisplay(r, g, b, output, out);
    return out;
  }
  const nits = [0, 0, 0];
  acesToHdr1000Nits(r, g, b, nits);
  if (output === "rec2020-pq") {
    out[0] = nitsToPq(nits[0]);
    out[1] = nitsToPq(nits[1]);
    out[2] = nitsToPq(nits[2]);
  } else {
    displayNitsToHlg(nits[0], nits[1], nits[2], out);
  }
  return out;
}

