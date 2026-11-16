/**
 * Raw colour science: the DNG camera model (ColorMatrix / ForwardMatrix
 * interpolation by illuminant temperature), white balance as temperature and
 * tint, and the matrices into the output colour spaces.
 *
 * Conventions: all matrices are row-major 3x3 `number[9]`. XYZ is relative
 * (Y = 1 for white). "D50" is the DNG / ICC profile connection space.
 */

export type Mat3 = readonly number[];
export type Vec3 = readonly [number, number, number];

export function mulMat3(a: Mat3, b: Mat3): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function mulMat3Vec(m: Mat3, v: readonly number[]): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function invMat3(m: Mat3): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("Singular colour matrix.");
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function diag3(v: readonly number[]): number[] {
  return [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];
}

export function xyToXYZ(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

export const D50_XY: readonly [number, number] = [0.3457, 0.3585];
export const D65_XY: readonly [number, number] = [0.3127, 0.3290];
export const D50_XYZ: Vec3 = xyToXYZ(D50_XY[0], D50_XY[1]);
export const D65_XYZ: Vec3 = xyToXYZ(D65_XY[0], D65_XY[1]);

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

/** Bradford chromatic adaptation matrix taking XYZ under `src` white to XYZ under `dst` white. */
export function bradfordAdapt(src: Vec3, dst: Vec3): number[] {
  const s = mulMat3Vec(BRADFORD, src);
  const d = mulMat3Vec(BRADFORD, dst);
  const scale = diag3([d[0] / s[0], d[1] / s[1], d[2] / s[2]]);
  return mulMat3(invMat3(BRADFORD), mulMat3(scale, BRADFORD));
}

// ---------------------------------------------------------------------------
// Temperature / tint
// ---------------------------------------------------------------------------

export const TEMPERATURE_MIN = 2000;
export const TEMPERATURE_MAX = 25000;
export const TINT_LIMIT = 150;
/** CIE 1960 distance from the Planckian locus per tint unit. Positive tint = illuminant above the locus (green), so the picture goes magenta. */
const DUV_PER_TINT = 0.00033;

/** CIE xy of a Planckian radiator (Kim et al. 2002 cubic spline, 1667 K to 25000 K). */
export function planckianXY(kelvin: number): [number, number] {
  const t = Math.min(25000, Math.max(1667, kelvin));
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    t <= 4000
      ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039;
  const y =
    t <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

function xyToUv(x: number, y: number): [number, number] {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
}

function uvToXy(u: number, v: number): [number, number] {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}

function planckianUv(kelvin: number): [number, number] {
  const [x, y] = planckianXY(kelvin);
  return xyToUv(x, y);
}

/** xy of the assumed illuminant for a temperature (K) and a tint (+ pushes the picture magenta, - green; about -150..150). */
export function kelvinTintToXY(kelvin: number, tint: number): [number, number] {
  const [u, v] = planckianUv(kelvin);
  const step = Math.max(1, kelvin * 0.001);
  const [u0, v0] = planckianUv(kelvin - step);
  const [u1, v1] = planckianUv(kelvin + step);
  let du = u1 - u0;
  let dv = v1 - v0;
  const len = Math.hypot(du, dv) || 1;
  du /= len;
  dv /= len;
  // Normal pointing toward +v (green side) for a locus that runs toward +u.
  let nu = -dv;
  let nv = du;
  if (nv < 0) {
    nu = -nu;
    nv = -nv;
  }
  const duv = tint * DUV_PER_TINT;
  return uvToXy(u + nu * duv, v + nv * duv);
}

/** Inverse of `kelvinTintToXY`: the nearest point on the Planckian locus, and the signed distance as tint. */
export function xyToKelvinTint(x: number, y: number): { kelvin: number; tint: number } {
  const [u, v] = xyToUv(x, y);
  const dist = (logK: number): number => {
    const [pu, pv] = planckianUv(Math.exp(logK));
    return Math.hypot(u - pu, v - pv);
  };
  let lo = Math.log(1667);
  let hi = Math.log(25000);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = dist(c);
  let fd = dist(d);
  for (let i = 0; i < 60; i++) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = dist(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = dist(d);
    }
  }
  const kelvin = Math.exp((lo + hi) / 2);
  const [pu, pv] = planckianUv(kelvin);
  // Signed: positive Duv means above the locus (green) which is negative tint.
  const sign = v >= pv ? 1 : -1;
  const duv = sign * Math.hypot(u - pu, v - pv);
  return { kelvin, tint: duv / DUV_PER_TINT };
}

// ---------------------------------------------------------------------------
// DNG camera model
// ---------------------------------------------------------------------------

/** The slice of a DNG the colour model needs (a `DngRaw` satisfies it). */
export interface CameraColorModel {
  readonly colorMatrix1: Mat3 | null;
  readonly colorMatrix2: Mat3 | null;
  readonly forwardMatrix1: Mat3 | null;
  readonly forwardMatrix2: Mat3 | null;
  readonly cameraCalibration1: Mat3 | null;
  readonly cameraCalibration2: Mat3 | null;
  readonly analogBalance: readonly number[] | null;
  readonly illuminant1: number;
  readonly illuminant2: number;
  readonly asShotNeutral: readonly number[] | null;
  readonly asShotWhiteXY: readonly [number, number] | null;
}

/** Correlated colour temperature of an EXIF LightSource code (DNG CalibrationIlluminant). */
export function illuminantKelvin(code: number): number {
  switch (code) {
    case 1: return 5500;
    case 2: return 4150;
    case 3: return 2850;
    case 4: return 5500;
    case 9: return 5500;
    case 10: return 6500;
    case 11: return 7500;
    case 12: return 6430;
    case 13: return 5000;
    case 14: return 4200;
    case 15: return 3450;
    case 17: return 2856;
    case 18: return 4874;
    case 19: return 6774;
    case 20: return 5503;
    case 21: return 6504;
    case 22: return 7504;
    case 23: return 5003;
    case 24: return 3200;
    default: return 6504;
  }
}

/** sRGB (D65) treated as the camera when a DNG carries no ColorMatrix (every real DNG has one). */
const FALLBACK_XYZ_TO_CAMERA: Mat3 = invMat3(mulMat3(bradfordAdapt(D65_XYZ, D50_XYZ), rgbToXyzMatrix(
  [0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65_XY,
)));

function lerpMat(a: Mat3, b: Mat3, t: number): number[] {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

/** Weight (0..1) of the second calibration for a scene temperature, interpolated in inverse kelvin (DNG spec). */
function illuminantWeight(model: CameraColorModel, kelvin: number): number {
  let t1 = illuminantKelvin(model.illuminant1);
  let t2 = illuminantKelvin(model.illuminant2);
  if (t1 === t2) return 0;
  let swap = false;
  if (t1 > t2) {
    [t1, t2] = [t2, t1];
    swap = true;
  }
  const k = Math.min(t2, Math.max(t1, kelvin));
  const w = (1 / k - 1 / t2) / (1 / t1 - 1 / t2); // weight of the lower-temperature profile
  return swap ? w : 1 - w; // weight of calibration 2
}

function interpolated(a: Mat3 | null, b: Mat3 | null, w2: number): Mat3 | null {
  if (a && b) return lerpMat(a, b, w2);
  return a ?? b;
}

/** Camera calibration product: XYZ (scene illuminant) -> camera RGB, at a temperature. */
export function xyzToCamera(model: CameraColorModel, kelvin: number): Mat3 {
  const w2 = illuminantWeight(model, kelvin);
  const cm = interpolated(model.colorMatrix1, model.colorMatrix2, w2) ?? FALLBACK_XYZ_TO_CAMERA;
  const cc = interpolated(model.cameraCalibration1, model.cameraCalibration2, w2);
  const ab = model.analogBalance ? diag3(model.analogBalance) : null;
  let m: Mat3 = cm;
  if (cc) m = mulMat3(cc, m);
  if (ab) m = mulMat3(ab, m);
  return m;
}

/** The camera RGB (green = 1) a neutral surface produces under the illuminant at `xy`. */
export function cameraNeutralForXY(model: CameraColorModel, xy: readonly [number, number]): Vec3 {
  const { kelvin } = xyToKelvinTint(xy[0], xy[1]);
  const n = mulMat3Vec(xyzToCamera(model, kelvin), xyToXYZ(xy[0], xy[1]));
  const g = n[1] || 1;
  return [n[0] / g, 1, n[2] / g];
}

/** Solves AsShotNeutral for the illuminant xy (DNG spec iteration). */
export function xyForCameraNeutral(model: CameraColorModel, neutral: readonly number[]): [number, number] {
  let xy: [number, number] = [D50_XY[0], D50_XY[1]];
  for (let i = 0; i < 40; i++) {
    const { kelvin } = xyToKelvinTint(xy[0], xy[1]);
    const xyz = mulMat3Vec(invMat3(xyzToCamera(model, kelvin)), neutral);
    const sum = xyz[0] + xyz[1] + xyz[2];
    if (!(sum > 0)) break;
    const next: [number, number] = [xyz[0] / sum, xyz[1] / sum];
    const moved = Math.hypot(next[0] - xy[0], next[1] - xy[1]);
    xy = next;
    if (moved < 1e-7) break;
  }
  return xy;
}

/** The illuminant the camera recorded as shot, in kelvin / tint (the panel's "As Shot"). */
export function asShotKelvinTint(model: CameraColorModel): { kelvin: number; tint: number } {
  let xy: readonly [number, number] | null = null;
  if (model.asShotNeutral) xy = xyForCameraNeutral(model, model.asShotNeutral);
  else if (model.asShotWhiteXY) xy = model.asShotWhiteXY;
  if (!xy) return { kelvin: 5003, tint: 0 };
  const r = xyToKelvinTint(xy[0], xy[1]);
  return { kelvin: Math.round(r.kelvin), tint: Math.round(r.tint * 10) / 10 };
}

export interface CameraToOutput {
  /** Per-channel multipliers applied to the (black-subtracted, white-normalised) sensor RGB. */
  readonly whiteBalance: Vec3;
  /** White-balanced camera RGB -> linear output RGB. */
  readonly matrix: number[];
}

/** Linear output primaries the developer can target. */
export type RawOutputColorSpace = "srgb" | "display-p3" | "rec2020";

export function rgbToXyzMatrix(
  r: readonly [number, number],
  g: readonly [number, number],
  b: readonly [number, number],
  white: readonly [number, number],
): number[] {
  const cols = [xyToXYZ(r[0], r[1]), xyToXYZ(g[0], g[1]), xyToXYZ(b[0], b[1])];
  const m = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]];
  const w = xyToXYZ(white[0], white[1]);
  const s = mulMat3Vec(invMat3(m), w);
  return [m[0] * s[0], m[1] * s[1], m[2] * s[2], m[3] * s[0], m[4] * s[1], m[5] * s[2], m[6] * s[0], m[7] * s[1], m[8] * s[2]];
}

const PRIMARIES: Readonly<Record<RawOutputColorSpace, [readonly [number, number], readonly [number, number], readonly [number, number]]>> = {
  srgb: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]],
  "display-p3": [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
  rec2020: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
};

const outputCache = new Map<RawOutputColorSpace, { fromD50: number[]; lumaRow: Vec3 }>();

/** XYZ (D50) -> linear RGB of the output space (Bradford adapted to its D65 white), and its luma weights. */
export function outputSpaceMatrices(space: RawOutputColorSpace): { fromD50: number[]; lumaRow: Vec3 } {
  const cached = outputCache.get(space);
  if (cached) return cached;
  const [r, g, b] = PRIMARIES[space];
  const rgbToXyz = rgbToXyzMatrix(r, g, b, D65_XY);
  const fromD50 = mulMat3(invMat3(rgbToXyz), bradfordAdapt(D50_XYZ, D65_XYZ));
  const result = { fromD50, lumaRow: [rgbToXyz[3], rgbToXyz[4], rgbToXyz[5]] as Vec3 };
  outputCache.set(space, result);
  return result;
}

/**
 * The DNG reference pipeline for one illuminant: white balance multipliers and
 * the matrix taking white-balanced camera RGB to linear output RGB.
 *
 *   ForwardMatrix present:  XYZ(D50) = FM * diag(1/neutral) * camera
 *   otherwise:              XYZ(D50) = inv(CM) * diag(refNeutral) * diag(1/neutral) * camera
 *                           (refNeutral = CM * D50, so neutral maps to D50 white)
 */
export function cameraToOutput(
  model: CameraColorModel,
  kelvin: number,
  tint: number,
  space: RawOutputColorSpace,
): CameraToOutput {
  const xy = kelvinTintToXY(kelvin, tint);
  const neutral = cameraNeutralForXY(model, xy);
  const whiteBalance: Vec3 = [1 / neutral[0], 1 / neutral[1], 1 / neutral[2]];
  const actual = xyToKelvinTint(xy[0], xy[1]).kelvin;
  const w2 = illuminantWeight(model, actual);
  const fm = interpolated(model.forwardMatrix1, model.forwardMatrix2, w2);
  let wbCameraToXyz: number[];
  if (fm) {
    wbCameraToXyz = [...fm];
  } else {
    const cm = xyzToCamera(model, actual);
    // (1,1,1) maps through diag(ref) to the camera response of D50, and inv(cm) to D50 itself.
    const ref = mulMat3Vec(cm, D50_XYZ);
    wbCameraToXyz = mulMat3(invMat3(cm), diag3(ref));
  }
  const { fromD50 } = outputSpaceMatrices(space);
  return { whiteBalance, matrix: mulMat3(fromD50, wbCameraToXyz) };
}
