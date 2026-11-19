/**
 * Planar homography estimation: normalised DLT, deterministic RANSAC and quad helpers.
 * Pure maths with no DOM; shared by the tracking worker, the editor and tests.
 * A homography is a row-major 3x3 stored as 9 numbers with h[8] normalised to 1 where possible.
 */

export type Homography = readonly [number, number, number, number, number, number, number, number, number];
export interface Pt { x: number; y: number }
export interface PointPair { from: Pt; to: Pt }
/** Four corners, clockwise from the top left: TL, TR, BR, BL. */
export type Quad = readonly [Pt, Pt, Pt, Pt];

export const IDENTITY_HOMOGRAPHY: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function applyHomography(h: Homography, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  const d = Math.abs(w) < 1e-12 ? 1e-12 : w;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

export function multiplyHomography(a: Homography, b: Homography): Homography {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return normalise(r);
}

function normalise(r: number[]): Homography {
  const s = Math.abs(r[8]) > 1e-12 ? r[8] : 1;
  return r.map(v => v / s) as unknown as Homography;
}

export function invertHomography(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i, B = -(d * j - f * g), C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return normalise([A * inv, (c * i - b * j) * inv, (b * f - c * e) * inv, B * inv, (a * j - c * g) * inv, (c * d - a * f) * inv, C * inv, (b * g - a * i) * inv, (a * e - b * d) * inv]);
}

/** Hartley normalisation: translate to the centroid and scale so the mean distance is sqrt(2). */
function similarity(points: readonly Pt[]): { t: Homography; points: Pt[] } {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length; cy /= points.length;
  let mean = 0;
  for (const p of points) mean += Math.hypot(p.x - cx, p.y - cy);
  mean /= points.length;
  const s = mean > 1e-12 ? Math.SQRT2 / mean : 1;
  return { t: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], points: points.map(p => ({ x: (p.x - cx) * s, y: (p.y - cy) * s })) };
}

/** Solve the n x n system in place by Gaussian elimination with partial pivoting; null when singular. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-12) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    for (let row = col + 1; row < n; row++) {
      const f = matrix[row][col] / matrix[col][col];
      if (f === 0) continue;
      for (let k = col; k < n; k++) matrix[row][k] -= f * matrix[col][k];
      rhs[row] -= f * rhs[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let k = row + 1; k < n; k++) sum -= matrix[row][k] * x[k];
    x[row] = sum / matrix[row][row];
  }
  return x;
}

/**
 * Least-squares homography mapping `from` to `to` (exact for four points). Fixes h22 = 1 in normalised
 * space and solves the 8x8 normal equations. Null when the points are degenerate (collinear, repeated).
 */
export function estimateHomography(pairs: readonly PointPair[]): Homography | null {
  if (pairs.length < 4) return null;
  const src = similarity(pairs.map(p => p.from)), dst = similarity(pairs.map(p => p.to));
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0)), atb = new Array<number>(8).fill(0);
  const accumulate = (row: number[], b: number) => {
    for (let i = 0; i < 8; i++) { atb[i] += row[i] * b; for (let j = 0; j < 8; j++) ata[i][j] += row[i] * row[j]; }
  };
  for (let k = 0; k < pairs.length; k++) {
    const { x, y } = src.points[k], { x: u, y: v } = dst.points[k];
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const sol = solve(ata, atb);
  if (!sol || !sol.every(Number.isFinite)) return null;
  const hn: Homography = [sol[0], sol[1], sol[2], sol[3], sol[4], sol[5], sol[6], sol[7], 1];
  const inverse = invertHomography(dst.t);
  if (!inverse) return null;
  const h = multiplyHomography(multiplyHomography(inverse, hn), src.t);
  return h.every(Number.isFinite) ? h : null;
}

/** Homography taking the unit square (0,0)(1,0)(1,1)(0,1) to `quad`. */
export function squareToQuad(quad: Quad): Homography | null {
  return estimateHomography([
    { from: { x: 0, y: 0 }, to: quad[0] }, { from: { x: 1, y: 0 }, to: quad[1] },
    { from: { x: 1, y: 1 }, to: quad[2] }, { from: { x: 0, y: 1 }, to: quad[3] },
  ]);
}

export function homographyBetweenQuads(from: Quad, to: Quad): Homography | null {
  return estimateHomography(from.map((p, i) => ({ from: p, to: to[i] })));
}

export function transformQuad(h: Homography, quad: Quad): Quad {
  return quad.map(p => applyHomography(h, p)) as unknown as Quad;
}

/** Signed area (shoelace); positive for the clockwise-on-screen order used here. */
export function quadArea(quad: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = quad[i], q = quad[(i + 1) % 4]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

/** True for a non-degenerate, convex quad with consistent winding. */
export function isConvexQuad(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!Number.isFinite(cross) || Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

export function pointInQuad(quad: Quad, p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const s = Math.sign(cross);
    if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) return false; }
  }
  return true;
}

/** Deterministic PRNG (mulberry32) so a track is identical on every run and machine. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RansacOptions {
  /** Reprojection error (in the `to` space) under which a pair is an inlier. */
  threshold?: number;
  iterations?: number;
  seed?: number;
  minInliers?: number;
}
export interface RansacResult { homography: Homography; inliers: boolean[]; inlierCount: number; rmsError: number }

/** Maps used to reject minimal samples that would give a near-degenerate model. */
function spread(sample: readonly Pt[]): boolean {
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (Math.hypot(sample[i].x - sample[j].x, sample[i].y - sample[j].y) < 1e-3) return false;
  for (let i = 0; i < 4; i++) {
    const a = sample[i], b = sample[(i + 1) % 4], c = sample[(i + 2) % 4];
    if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-3) return false;
  }
  return true;
}

/** RANSAC over point pairs with a final least-squares refit on the inliers. Deterministic for a given seed. */
export function ransacHomography(pairs: readonly PointPair[], options: RansacOptions = {}): RansacResult | null {
  const { threshold = 2, iterations = 200, seed = 1, minInliers = 6 } = options;
  const n = pairs.length;
  if (n < 4) return null;
  const rand = seededRandom(seed);
  const t2 = threshold * threshold;
  const errors = (h: Homography): { count: number; flags: boolean[] } => {
    const flags = new Array<boolean>(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      const q = applyHomography(h, pairs[i].from);
      const ok = (q.x - pairs[i].to.x) ** 2 + (q.y - pairs[i].to.y) ** 2 <= t2;
      flags[i] = ok; if (ok) count++;
    }
    return { count, flags };
  };
  let best: { h: Homography; count: number; flags: boolean[] } | null = null;
  if (n === 4) {
    const h = estimateHomography(pairs);
    if (!h) return null;
    const e = errors(h);
    best = { h, ...e };
  } else {
    for (let it = 0; it < iterations; it++) {
      const picks = new Set<number>();
      while (picks.size < 4) picks.add(Math.min(n - 1, Math.floor(rand() * n)));
      const sample = [...picks].map(i => pairs[i]);
      if (!spread(sample.map(p => p.from)) || !spread(sample.map(p => p.to))) continue;
      const h = estimateHomography(sample);
      if (!h) continue;
      const e = errors(h);
      if (!best || e.count > best.count) best = { h, ...e };
      if (best.count === n) break;
    }
  }
  if (!best || best.count < Math.min(minInliers, n)) return null;
  // Refit on the consensus set, re-evaluate, and keep the refit only if it does not lose inliers.
  const inlierPairs = pairs.filter((_, i) => best!.flags[i]);
  const refit = estimateHomography(inlierPairs);
  let { h, count, flags } = best;
  if (refit) { const e = errors(refit); if (e.count >= count) { h = refit; count = e.count; flags = e.flags; } }
  let sum = 0;
  for (let i = 0; i < n; i++) if (flags[i]) { const q = applyHomography(h, pairs[i].from); sum += (q.x - pairs[i].to.x) ** 2 + (q.y - pairs[i].to.y) ** 2; }
  return { homography: h, inliers: flags, inlierCount: count, rmsError: Math.sqrt(sum / Math.max(1, count)) };
}
