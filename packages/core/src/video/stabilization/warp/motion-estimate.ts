/**
 * Camera motion between two grey frames by direct, robust, coarse-to-fine alignment: one parametric warp
 * (translation, rotation, scale, a small perspective term and a row-wise shear for rolling shutter) is fitted to
 * every pixel at once with Gauss-Newton and Cauchy weights, so moving subjects and flat areas do not vote. Pure
 * and DOM free: it runs in the analysis worker, in node tests and inline alike.
 */
export interface GrayFrame {
  readonly width: number;
  readonly height: number;
  /** 0..1 luma, row major. */
  readonly data: Float32Array;
}

export interface FrameMotion {
  readonly dx: number;
  readonly dy: number;
  readonly rotation: number;
  readonly logScale: number;
  readonly px: number;
  readonly py: number;
  readonly shearX: number;
  readonly shearY: number;
  /** Mean robust weight of the pixels used: 1 = every pixel agreed with the fit. */
  readonly confidence: number;
}

export const ZERO_MOTION: FrameMotion = { dx: 0, dy: 0, rotation: 0, logScale: 0, px: 0, py: 0, shearX: 0, shearY: 0, confidence: 0 };

const PARAMS = 8;
const MIN_LEVEL_WIDTH = 40;

function downsample(frame: GrayFrame): GrayFrame {
  const w = frame.width >> 1;
  const h = frame.height >> 1;
  const out = new Float32Array(w * h);
  const src = frame.data;
  const sw = frame.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * sw + 2 * x;
      out[y * w + x] = (src[i] + src[i + 1] + src[i + sw] + src[i + sw + 1]) * 0.25;
    }
  }
  return { width: w, height: h, data: out };
}

export function buildPyramid(frame: GrayFrame): GrayFrame[] {
  const levels = [frame];
  while (levels[levels.length - 1].width >= MIN_LEVEL_WIDTH * 2) levels.push(downsample(levels[levels.length - 1]));
  return levels;
}

function solveSymmetric(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const m = new Float64Array(a);
  const x = new Float64Array(b);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r * n + col]) > Math.abs(m[pivot * n + col])) pivot = r;
    if (Math.abs(m[pivot * n + col]) < 1e-12) return null;
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const t = m[col * n + c];
        m[col * n + c] = m[pivot * n + c];
        m[pivot * n + c] = t;
      }
      const t = x[col];
      x[col] = x[pivot];
      x[pivot] = t;
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col] / m[col * n + col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) m[r * n + c] -= f * m[col * n + c];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= m[r * n + c] * x[c];
    x[r] = s / m[r * n + r];
  }
  return x;
}

function sample(data: Float32Array, w: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  const top = data[i] * (1 - fx) + data[i + 1] * fx;
  const bottom = data[i + w] * (1 - fx) + data[i + w + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Warp parameters: dx, dy (px), rotation (rad), logScale, h1, h2 (per half width), shearX, shearY (px over the full height). */
type Params = Float64Array;

function warpPoint(p: Params, xc: number, yc: number, halfW: number, height: number, out: { x: number; y: number }): void {
  const a = Math.exp(p[3]);
  const c = a * Math.cos(p[2]);
  const s = a * Math.sin(p[2]);
  const den = 1 + (p[4] * xc + p[5] * yc) / halfW;
  const rowShift = yc / height;
  out.x = (c * xc - s * yc + p[0] + p[6] * rowShift) / den;
  out.y = (s * xc + c * yc + p[1] + p[7] * rowShift) / den;
}

interface LevelOptions {
  iterations: number;
  /** Which of the 8 parameters this level may move. */
  active: readonly number[];
}

function alignLevel(prev: GrayFrame, cur: GrayFrame, p: Params, options: LevelOptions): number {
  const { width: w, height: h } = prev;
  const halfW = w / 2;
  const cx = w / 2 - 0.5;
  const cy = h / 2 - 0.5;
  const margin = 2;
  const stride = Math.max(1, Math.floor(Math.sqrt((w * h) / 36000)));
  const colScale = [1, 1, halfW, halfW, halfW, halfW, 1, 1];
  const maxCount = (Math.ceil((h - 2 * margin) / stride) + 1) * (Math.ceil((w - 2 * margin) / stride) + 1);
  const rows = new Float64Array(maxCount * PARAMS);
  const residuals = new Float64Array(maxCount);
  const point = { x: 0, y: 0 };
  let confidence = 0;
  const n = PARAMS;
  const active = options.active;
  for (let iteration = 0; iteration < options.iterations; iteration++) {
    const hess = new Float64Array(n * n);
    const grad = new Float64Array(n);
    // scale of the residuals for the Cauchy weight: refreshed from the previous pass
    let absSum = 0;
    let count = 0;
    const jr = new Float64Array(n);
    for (let y = margin; y < h - margin; y += stride) {
      for (let x = margin; x < w - margin; x += stride) {
        const xc = x - cx;
        const yc = y - cy;
        warpPoint(p, xc, yc, halfW, h, point);
        const sx = point.x + cx;
        const sy = point.y + cy;
        if (sx < 1 || sy < 1 || sx >= w - 2 || sy >= h - 2) continue;
        const e = sample(cur.data, w, sx, sy) - prev.data[y * w + x];
        const i = y * w + x;
        const gx = (prev.data[i + 1] - prev.data[i - 1]) * 0.5;
        const gy = (prev.data[i + w] - prev.data[i - w]) * 0.5;
        const radial = gx * xc + gy * yc;
        jr[0] = gx;
        jr[1] = gy;
        jr[2] = -gx * yc + gy * xc;
        jr[3] = radial;
        jr[4] = (-radial * xc) / halfW;
        jr[5] = (-radial * yc) / halfW;
        jr[6] = (gx * yc) / h;
        jr[7] = (gy * yc) / h;
        const base = count * n;
        for (let k = 0; k < n; k++) rows[base + k] = jr[k] / colScale[k];
        residuals[count] = e;
        absSum += Math.abs(e);
        count++;
      }
    }
    if (count < 200) return 0;
    const scale = Math.max(1.5 * (absSum / count), 1e-3);
    let weightSum = 0;
    for (let r = 0; r < count; r++) {
      const e = residuals[r];
      const wgt = 1 / (1 + (e * e) / (scale * scale));
      weightSum += wgt;
      const base = r * n;
      for (let a = 0; a < n; a++) {
        const ja = rows[base + a];
        if (ja === 0) continue;
        grad[a] += wgt * ja * e;
        for (let b = a; b < n; b++) hess[a * n + b] += wgt * ja * rows[base + b];
      }
    }
    confidence = weightSum / count;
    // symmetric fill, only the active parameters, plus a ridge (stronger on the weakly observable ones)
    const reduced = active.length;
    const hr = new Float64Array(reduced * reduced);
    const gr = new Float64Array(reduced);
    let trace = 0;
    for (let a = 0; a < n; a++) trace += hess[a * n + a];
    const ridge = (1e-5 * trace) / n;
    for (let i = 0; i < reduced; i++) {
      const ai = active[i];
      gr[i] = -grad[ai];
      for (let j = 0; j < reduced; j++) {
        const aj = active[j];
        hr[i * reduced + j] = ai <= aj ? hess[ai * n + aj] : hess[aj * n + ai];
      }
      const weak = ai === 4 || ai === 5 ? 200 : ai === 6 || ai === 7 ? 20 : 1;
      hr[i * reduced + i] += ridge * weak;
    }
    const delta = solveSymmetric(hr, gr, reduced);
    if (!delta) return confidence;
    let step = 0;
    for (let i = 0; i < reduced; i++) {
      const ai = active[i];
      const d = delta[i] / colScale[ai];
      p[ai] += d;
      step = Math.max(step, Math.abs(ai < 2 || ai > 5 ? d / halfW : d));
    }
    if (step < 2e-4) break;
  }
  return confidence;
}

const LEVEL_ITERATIONS = [4, 6, 8, 10];

function scaleParamsUp(p: Params): void {
  p[0] *= 2;
  p[1] *= 2;
  p[6] *= 2;
  p[7] *= 2;
}

/**
 * Motion of the picture from `prev` to `cur`. `pyramids` are the two frames' pyramids when the caller keeps
 * them (the previous pyramid is the next pair's first, so a sequence builds each one once).
 */
export function estimateFrameMotion(
  prevPyramid: readonly GrayFrame[],
  curPyramid: readonly GrayFrame[],
  options: { shear?: boolean } = {},
): FrameMotion {
  const levels = Math.min(prevPyramid.length, curPyramid.length);
  const p = new Float64Array(PARAMS);
  let confidence = 0;
  const coarseToFine = levels - 1;
  for (let level = coarseToFine; level >= 0; level--) {
    const finest = level === 0;
    const rich = level <= coarseToFine - 1;
    const active = rich ? (options.shear === false ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7]) : [0, 1, 2, 3];
    confidence = alignLevel(prevPyramid[level], curPyramid[level], p, {
      iterations: LEVEL_ITERATIONS[Math.min(level, LEVEL_ITERATIONS.length - 1)] ?? 6,
      active,
    });
    if (!finest) scaleParamsUp(p);
  }
  const width = prevPyramid[0].width;
  const limit = width * 0.3;
  if (
    !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
    Math.abs(p[0]) > limit || Math.abs(p[1]) > limit ||
    Math.abs(p[2]) > 0.4 || Math.abs(p[3]) > 0.3
  ) {
    return ZERO_MOTION;
  }
  const bounded = (value: number, max: number): number => (Number.isFinite(value) ? Math.max(-max, Math.min(max, value)) : 0);
  return {
    dx: p[0],
    dy: p[1],
    rotation: p[2],
    logScale: p[3],
    px: bounded(p[4], 0.3),
    py: bounded(p[5], 0.3),
    shearX: bounded(p[6], width * 0.1),
    shearY: bounded(p[7], width * 0.1),
    confidence,
  };
}

/** Convenience for tests and one-off pairs. */
export function estimateMotionBetween(prev: GrayFrame, cur: GrayFrame, options: { shear?: boolean } = {}): FrameMotion {
  return estimateFrameMotion(buildPyramid(prev), buildPyramid(cur), options);
}
