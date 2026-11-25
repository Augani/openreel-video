import { FRAME_STRIDE, type RollingShutterMode, type WarpAnalysis, type WarpSettings } from "./types";

/**
 * From the measured camera motion and the settings to what is drawn: the camera path as shot, the path it is
 * moved onto (Smooth Motion or No Motion), the per-row transform that moves one onto the other (rolling shutter
 * ripple is the same operation with the row's own capture time), and the crop framing that hides the borders.
 *
 * Component order everywhere: 0 x, 1 y, 2 rotation, 3 log scale, 4 perspective x, 5 perspective y.
 */
const COMPONENTS = 6;

export interface RowDelta {
  dx: number;
  dy: number;
  rotation: number;
  logScale: number;
  px: number;
  py: number;
}

export interface WarpPlan {
  readonly frameCount: number;
  readonly fps: number;
  readonly startTime: number;
  /** Analysis picture size: the pixel units of the paths. */
  readonly width: number;
  readonly height: number;
  /** The camera path as shot (cumulative), at each frame's centre row. */
  readonly raw: readonly Float64Array[];
  /** The path the picture is moved onto. */
  readonly target: readonly Float64Array[];
  /** Rolling shutter: capture-time spread from the top row to the bottom row, in frames. 0 = none. */
  readonly readout: number;
  readonly rollingShutter: RollingShutterMode;
  /** 0..1: how much of the correction is applied (crop framings give smoothing up to stay inside the crop budget). */
  readonly strength: number;
  /** Auto-scale factor (>= 1). 1 for the other framings. */
  readonly zoom: number;
  /** Stabilize Crop: the visible rectangle as a fraction of the frame, centred. 1 = no crop. */
  readonly cropFraction: number;
  readonly settings: WarpSettings;
  readonly active: readonly boolean[];
}

const activeComponents = (method: WarpSettings["method"]): boolean[] => [
  true,
  true,
  method !== "position",
  method !== "position",
  method === "perspective",
  method === "perspective",
];

export function rawPathOf(analysis: WarpAnalysis): Float64Array[] {
  const n = analysis.frameCount;
  const paths = Array.from({ length: COMPONENTS }, () => new Float64Array(n));
  for (let i = 1; i < n; i++) {
    for (let c = 0; c < COMPONENTS; c++) paths[c][i] = paths[c][i - 1] + analysis.motion[i * FRAME_STRIDE + c];
  }
  return paths;
}

/** Gaussian smoothing with odd reflection about the end points (keeps the slope, so the ends do not pull inward). */
export function smoothPathGaussian(values: Float64Array, sigma: number): Float64Array {
  const n = values.length;
  if (n < 2 || sigma <= 0.05) return Float64Array.from(values);
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = w;
    total += w;
  }
  const at = (index: number): number => {
    if (index < 0) {
      const mirror = Math.min(-index, n - 1);
      return 2 * values[0] - values[mirror];
    }
    if (index > n - 1) {
      const mirror = Math.max(2 * (n - 1) - index, 0);
      return 2 * values[n - 1] - values[mirror];
    }
    return values[index];
  };
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += at(i + k) * kernel[k + radius];
    out[i] = sum / total;
  }
  return out;
}

const interpolate = (path: Float64Array, f: number): number => {
  const n = path.length;
  if (f <= 0) return path[0];
  if (f >= n - 1) return path[n - 1];
  const i = Math.floor(f);
  const t = f - i;
  return path[i] * (1 - t) + path[i + 1] * t;
};

/** Estimated rolling shutter readout (frames from the top to the bottom row) from the in-frame shear of the motion. */
export function estimateReadout(analysis: WarpAnalysis): number {
  const n = analysis.frameCount;
  let numerator = 0;
  let denominator = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = i * FRAME_STRIDE;
    const b = (i + 1) * FRAME_STRIDE;
    const accX = analysis.motion[b] - analysis.motion[a];
    const accY = analysis.motion[b + 1] - analysis.motion[a + 1];
    numerator += analysis.motion[a + 6] * accX + analysis.motion[a + 7] * accY;
    denominator += accX * accX + accY * accY;
  }
  if (denominator < 1e-6) return 0;
  return Math.max(0, Math.min(1.5, numerator / denominator));
}

export interface PlanOptions {
  /** Test hook: use this readout instead of the estimate. */
  readonly readoutOverride?: number;
}

export function buildPlan(analysis: WarpAnalysis, settings: WarpSettings, options: PlanOptions = {}): WarpPlan {
  const n = analysis.frameCount;
  const raw = rawPathOf(analysis);
  const active = activeComponents(settings.method);
  const fpsScale = analysis.fps / 30;
  const target = raw.map((path, c) => {
    if (!active[c]) return Float64Array.from(path);
    if (settings.result === "noMotion") {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of path) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return new Float64Array(n).fill((lo + hi) / 2);
    }
    const sigma = Math.max(0.5, (settings.smoothness / 100) * 30 * fpsScale);
    return smoothPathGaussian(path, sigma);
  });
  const readout =
    settings.rollingShutter === "off"
      ? 0
      : options.readoutOverride ?? estimateReadout(analysis);
  const base: WarpPlan = {
    frameCount: n,
    fps: analysis.fps,
    startTime: analysis.startTime,
    width: analysis.width,
    height: analysis.height,
    raw,
    target,
    readout,
    rollingShutter: settings.rollingShutter,
    strength: 1,
    zoom: 1,
    cropFraction: 1,
    settings,
    active,
  };
  const cropping = settings.framing === "stabilizeCrop" || settings.framing === "stabilizeCropAutoScale";
  if (!cropping) return base;

  const budget = 1.05 + 0.45 * (settings.cropLessSmoothMore / 100);
  const full = requiredZoom(base);
  if (full <= budget) return withCrop(base, 1, full);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (requiredZoom({ ...base, strength: mid }) <= budget) lo = mid;
    else hi = mid;
  }
  return withCrop(base, lo, Math.min(budget, requiredZoom({ ...base, strength: lo })));
}

function withCrop(plan: WarpPlan, strength: number, zoom: number): WarpPlan {
  const z = Math.max(1, zoom);
  if (plan.settings.framing === "stabilizeCropAutoScale") return { ...plan, strength, zoom: z };
  return { ...plan, strength, cropFraction: 1 / z };
}

/** Frame index (fractional) of a source time, or null when the time is well outside what was analysed. */
export function frameAt(plan: WarpPlan, sourceTime: number): number | null {
  const f = (sourceTime - plan.startTime) * plan.fps;
  if (!Number.isFinite(f) || f < -1.5 || f > plan.frameCount - 1 + 1.5) return null;
  return Math.max(0, Math.min(plan.frameCount - 1, f));
}

/**
 * Correction for the row at height fraction `v` (0 top, 1 bottom) of a frame shown at stabilized frame `shown`
 * and captured as frame `captured` (the same, except when a neighbour fills another frame's edges). The row was
 * captured `readout * (v - 0.5)` frames after its frame's centre row, so its camera position is read there.
 */
export function rowDelta(plan: WarpPlan, shown: number, captured: number, v: number, out: RowDelta): RowDelta {
  const spread = plan.readout * (v - 0.5);
  const enhanced = plan.rollingShutter === "enhanced";
  const values = [0, 0, 0, 0, 0, 0];
  for (let c = 0; c < COMPONENTS; c++) {
    if (!plan.active[c]) continue;
    const timeShift = c < 2 || enhanced ? spread : 0;
    values[c] = (interpolate(plan.target[c], shown) - interpolate(plan.raw[c], captured + timeShift)) * plan.strength;
  }
  out.dx = values[0];
  out.dy = values[1];
  out.rotation = values[2];
  out.logScale = values[3];
  out.px = values[4];
  out.py = values[5];
  return out;
}

/** Row-major 3x3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

/** Forward matrix (source pixel to shown pixel) of a row, in the pixels of a `width` x `height` picture. */
export function rowMatrix(plan: WarpPlan, delta: RowDelta, width: number, height: number, zoom: number): Mat3 {
  const sx = width / plan.width;
  const sy = height / plan.height;
  const cx = width / 2;
  const cy = height / 2;
  const a = Math.exp(delta.logScale);
  const cos = a * Math.cos(delta.rotation);
  const sin = a * Math.sin(delta.rotation);
  // source -> centred, rotate/scale, perspective, zoom, back to the frame plus the translation
  const toCentre: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const rs: Mat3 = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
  const half = width / 2;
  const persp: Mat3 = [1, 0, 0, 0, 1, 0, delta.px / half, delta.py / half, 1];
  const z: Mat3 = [zoom, 0, 0, 0, zoom, 0, 0, 0, 1];
  // the correction is a move of the picture, so the auto-scale magnifies it with the picture
  const back: Mat3 = [1, 0, cx + zoom * delta.dx * sx, 0, 1, cy + zoom * delta.dy * sy, 0, 0, 1];
  return mul3(back, mul3(z, mul3(persp, mul3(rs, toCentre))));
}

export function applyMat3(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

const SCRATCH: RowDelta = { dx: 0, dy: 0, rotation: 0, logScale: 0, px: 0, py: 0 };

/**
 * The source position that lands on shown position (x, y). Rows move independently, so the row the position
 * comes from is found by a short fixed point iteration (the row shift is a fraction of a pixel per row).
 */
export function sourceOf(
  plan: WarpPlan,
  shown: number,
  captured: number,
  x: number,
  y: number,
  width: number,
  height: number,
  zoom: number,
): [number, number] | null {
  let v = Math.min(1, Math.max(0, y / height));
  let result: [number, number] | null = null;
  const iterations = plan.readout > 0 ? 4 : 1;
  for (let i = 0; i < iterations; i++) {
    const inverse = invert3(rowMatrix(plan, rowDelta(plan, shown, captured, v, SCRATCH), width, height, zoom));
    if (!inverse) return null;
    result = applyMat3(inverse, x, y);
    v = Math.min(1, Math.max(0, result[1] / height));
  }
  return result;
}

const PROBES: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5],
];

/** The smallest zoom about the centre for which frame `f` still covers the whole shown frame. */
export function frameZoom(plan: WarpPlan, f: number): number {
  const w = plan.width;
  const h = plan.height;
  const lo0 = 1;
  const covers = (zoom: number): boolean => {
    for (const [px, py] of PROBES) {
      const src = sourceOf(plan, f, f, px * w, py * h, w, h, zoom);
      if (!src) return false;
      if (src[0] < -0.01 || src[0] > w + 0.01 || src[1] < -0.01 || src[1] > h + 0.01) return false;
    }
    return true;
  };
  if (covers(lo0)) return 1;
  let lo = lo0;
  let hi = 4;
  if (!covers(hi)) return hi;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (covers(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The auto-scale that covers every frame (a constant zoom, so the picture never pulses). */
export function requiredZoom(plan: WarpPlan): number {
  const stride = plan.frameCount > 3000 ? Math.ceil(plan.frameCount / 3000) : 1;
  let zoom = 1;
  for (let f = 0; f < plan.frameCount; f += stride) zoom = Math.max(zoom, frameZoom(plan, f));
  return zoom;
}

/**
 * Whether frame `f`, drawn at the plan's zoom, leaves any of the shown frame's border uncovered (what Synthesize
 * Edges has to fill). The warped picture is a convex quad, so its border is the first place a gap shows.
 */
export function hasUncoveredEdge(plan: WarpPlan, f: number, perEdge = 12): boolean {
  const w = plan.width;
  const h = plan.height;
  for (let i = 0; i <= perEdge; i++) {
    const t = i / perEdge;
    for (const [px, py] of [[t, 0], [t, 1], [0, t], [1, t]] as const) {
      const src = sourceOf(plan, f, f, px * w, py * h, w, h, plan.zoom);
      if (!src || src[0] < -0.01 || src[0] > w + 0.01 || src[1] < -0.01 || src[1] > h + 0.01) return true;
    }
  }
  return false;
}

/** Fraction of the shown frame frame `f` does not cover when drawn at the plan's zoom (a grid estimate). */
export function uncoveredFraction(plan: WarpPlan, f: number, samples = 24): number {
  const w = plan.width;
  const h = plan.height;
  let missing = 0;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const src = sourceOf(plan, f, f, ((i + 0.5) / samples) * w, ((j + 0.5) / samples) * h, w, h, plan.zoom);
      if (!src || src[0] < 0 || src[0] > w || src[1] < 0 || src[1] > h) missing++;
    }
  }
  return missing / (samples * samples);
}
