import type { RGBAFrame } from "../time-interpolation/frame-blend";
import { MORPH_CUT_CONSTANTS as K } from "./types";

/**
 * Global alignment of two frames by robust feature matching: corners (Shi-Tomasi), normalised cross-correlation
 * patch matching with a mutual-best and ratio test, then a RANSAC fit of a similarity transform (scale, rotation,
 * translation). The similarity maps A coordinates to B coordinates; pixel centres are at integer coordinates, the
 * same convention as the optical-flow code. A jump cut with a re-framed shot (a punch-in, a small camera nudge) is
 * mostly this transform; whatever it does not explain (the head moving over a static background) is left to the
 * dense flow that runs on the aligned pair.
 */
export interface Similarity {
  /** z' = m z + c over complex numbers: m = a + ib = s (cos t + i sin t). */
  readonly a: number;
  readonly b: number;
  readonly tx: number;
  readonly ty: number;
}

export const IDENTITY_SIMILARITY: Similarity = { a: 1, b: 0, tx: 0, ty: 0 };

export function applySimilarity(s: Similarity, x: number, y: number): [number, number] {
  return [s.a * x - s.b * y + s.tx, s.b * x + s.a * y + s.ty];
}

export function invertSimilarity(s: Similarity): Similarity {
  const d = s.a * s.a + s.b * s.b;
  const a = s.a / d;
  const b = -s.b / d;
  return { a, b, tx: -(a * s.tx - b * s.ty), ty: -(b * s.tx + a * s.ty) };
}

export function similarityScale(s: Similarity): number {
  return Math.hypot(s.a, s.b);
}

export function similarityRotationDeg(s: Similarity): number {
  return (Math.atan2(s.b, s.a) * 180) / Math.PI;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface AlignmentResult {
  readonly similarity: Similarity;
  /** The fit was accepted (enough inliers, plausible scale and rotation); false means the identity was used. */
  readonly accepted: boolean;
  readonly matches: number;
  readonly inliers: number;
}

/** Box downsample of an RGBA frame by an integer factor (edges clamp). */
export function downsampleRGBA(frame: RGBAFrame, factor: number): RGBAFrame {
  if (factor <= 1) return frame;
  const w = Math.ceil(frame.width / factor);
  const h = Math.ceil(frame.height / factor);
  const out = new Uint8ClampedArray(w * h * 4);
  const d = frame.data;
  for (let y = 0; y < h; y++) {
    const y1 = Math.min(frame.height, (y + 1) * factor);
    for (let x = 0; x < w; x++) {
      const x1 = Math.min(frame.width, (x + 1) * factor);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y * factor; yy < y1; yy++) {
        for (let xx = x * factor; xx < x1; xx++) {
          const i = (yy * frame.width + xx) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          a += d[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data: out };
}

export function lumaOf(frame: RGBAFrame): Float32Array {
  const n = frame.width * frame.height;
  const out = new Float32Array(n);
  const d = frame.data;
  for (let i = 0; i < n; i++) out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return out;
}

/** Shi-Tomasi corners: the smaller eigenvalue of the windowed structure tensor, non-maximum suppressed by spacing. */
export function detectCorners(luma: Float32Array, w: number, h: number, maxFeatures = K.maxFeatures): Point[] {
  const n = w * h;
  const ixx = new Float32Array(n);
  const ixy = new Float32Array(n);
  const iyy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (luma[i + 1] - luma[i - 1]) * 0.5;
      const gy = (luma[i + w] - luma[i - w]) * 0.5;
      ixx[i] = gx * gx;
      ixy[i] = gx * gy;
      iyy[i] = gy * gy;
    }
  }
  const r = 2;
  const score = new Float32Array(n);
  const m = Math.max(K.featureMargin, K.patchRadius + 2);
  for (let y = m; y < h - m; y++) {
    for (let x = m; x < w - m; x++) {
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (let dy = -r; dy <= r; dy++) {
        const row = (y + dy) * w + x;
        for (let dx = -r; dx <= r; dx++) {
          sxx += ixx[row + dx];
          sxy += ixy[row + dx];
          syy += iyy[row + dx];
        }
      }
      const tr = sxx + syy;
      const det = sxx * syy - sxy * sxy;
      score[y * w + x] = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    }
  }
  let max = 0;
  for (let i = 0; i < n; i++) if (score[i] > max) max = score[i];
  if (max <= 0) return [];
  const threshold = max * 0.02;
  const candidates: Array<{ x: number; y: number; s: number }> = [];
  for (let y = m; y < h - m; y++) {
    for (let x = m; x < w - m; x++) {
      const s = score[y * w + x];
      if (s < threshold) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && score[(y + dy) * w + x + dx] > s) {
            peak = false;
            break;
          }
        }
      }
      if (peak) candidates.push({ x, y, s });
    }
  }
  candidates.sort((p, q) => q.s - p.s || p.y - q.y || p.x - q.x);
  const picked: Point[] = [];
  const spacing2 = K.featureSpacing * K.featureSpacing;
  for (const c of candidates) {
    let ok = true;
    for (const p of picked) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (dx * dx + dy * dy < spacing2) {
        ok = false;
        break;
      }
    }
    if (ok) {
      picked.push({ x: c.x, y: c.y });
      if (picked.length >= maxFeatures) break;
    }
  }
  return picked;
}

/** Zero-mean, unit-norm patch around each corner (null where the patch is flat). */
function patches(luma: Float32Array, w: number, points: Point[]): Array<Float32Array | null> {
  const r = K.patchRadius;
  const size = (2 * r + 1) * (2 * r + 1);
  return points.map((p) => {
    const out = new Float32Array(size);
    let mean = 0;
    let k = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const v = luma[(p.y + dy) * w + p.x + dx];
        out[k++] = v;
        mean += v;
      }
    }
    mean /= size;
    let norm = 0;
    for (let i = 0; i < size; i++) {
      out[i] -= mean;
      norm += out[i] * out[i];
    }
    if (norm < 1e-6) return null;
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < size; i++) out[i] *= inv;
    return out;
  });
}

export interface FeatureMatch {
  readonly a: Point;
  readonly b: Point;
  readonly ncc: number;
}

/** Mutual-best NCC matches that also pass the ratio test. */
export function matchFeatures(la: Float32Array, lb: Float32Array, w: number, h: number): FeatureMatch[] {
  const pa = detectCorners(la, w, h);
  const pb = detectCorners(lb, w, h);
  if (pa.length === 0 || pb.length === 0) return [];
  const da = patches(la, w, pa);
  const db = patches(lb, w, pb);
  const size = (2 * K.patchRadius + 1) ** 2;
  const best = (from: Array<Float32Array | null>, to: Array<Float32Array | null>): Array<{ j: number; ncc: number; second: number }> =>
    from.map((p) => {
      let bj = -1;
      let b1 = -2;
      let b2 = -2;
      if (p) {
        for (let j = 0; j < to.length; j++) {
          const q = to[j];
          if (!q) continue;
          let s = 0;
          for (let i = 0; i < size; i++) s += p[i] * q[i];
          if (s > b1) {
            b2 = b1;
            b1 = s;
            bj = j;
          } else if (s > b2) b2 = s;
        }
      }
      return { j: bj, ncc: b1, second: b2 };
    });
  const ab = best(da, db);
  const ba = best(db, da);
  const out: FeatureMatch[] = [];
  for (let i = 0; i < pa.length; i++) {
    const m = ab[i];
    if (m.j < 0 || m.ncc < K.minNcc) continue;
    if (ba[m.j].j !== i) continue;
    if (1 - m.ncc > K.ratio * (1 - m.second) && m.second > 0) continue;
    out.push({ a: pa[i], b: pb[m.j], ncc: m.ncc });
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Closed-form least-squares similarity over (a, b) pairs. */
export function fitSimilarity(pairs: ReadonlyArray<{ a: Point; b: Point }>): Similarity | null {
  const n = pairs.length;
  if (n < 2) return null;
  let cax = 0;
  let cay = 0;
  let cbx = 0;
  let cby = 0;
  for (const p of pairs) {
    cax += p.a.x;
    cay += p.a.y;
    cbx += p.b.x;
    cby += p.b.y;
  }
  cax /= n;
  cay /= n;
  cbx /= n;
  cby /= n;
  let num = 0;
  let numI = 0;
  let den = 0;
  for (const p of pairs) {
    const zx = p.a.x - cax;
    const zy = p.a.y - cay;
    const wx = p.b.x - cbx;
    const wy = p.b.y - cby;
    num += zx * wx + zy * wy;
    numI += zx * wy - zy * wx;
    den += zx * zx + zy * zy;
  }
  if (den < 1e-9) return null;
  const a = num / den;
  const b = numI / den;
  return { a, b, tx: cbx - (a * cax - b * cay), ty: cby - (b * cax + a * cay) };
}

/** RANSAC over matches: the similarity that the most matches agree on, refit on its inliers. */
export function estimateSimilarity(matches: readonly FeatureMatch[]): AlignmentResult {
  const none: AlignmentResult = { similarity: IDENTITY_SIMILARITY, accepted: false, matches: matches.length, inliers: 0 };
  if (matches.length < 2) return none;
  const rand = mulberry32(K.seed);
  const thr2 = K.inlierDistance * K.inlierDistance;
  const count = (s: Similarity): number => {
    let c = 0;
    for (const m of matches) {
      const [x, y] = applySimilarity(s, m.a.x, m.a.y);
      const dx = x - m.b.x;
      const dy = y - m.b.y;
      if (dx * dx + dy * dy <= thr2) c++;
    }
    return c;
  };
  let bestScore = -1;
  let best: Similarity | null = null;
  for (let it = 0; it < K.ransacIterations; it++) {
    const i = Math.floor(rand() * matches.length);
    let j = Math.floor(rand() * matches.length);
    if (j === i) j = (j + 1) % matches.length;
    const s = fitSimilarity([matches[i], matches[j]]);
    if (!s) continue;
    const scale = similarityScale(s);
    if (scale < K.minScale || scale > K.maxScale) continue;
    const c = count(s);
    if (c > bestScore) {
      bestScore = c;
      best = s;
    }
  }
  if (!best) return none;
  // refit on the inliers a few times
  let refined = best;
  for (let pass = 0; pass < 3; pass++) {
    const inl = matches.filter((m) => {
      const [x, y] = applySimilarity(refined, m.a.x, m.a.y);
      return (x - m.b.x) ** 2 + (y - m.b.y) ** 2 <= thr2;
    });
    const fit = fitSimilarity(inl);
    if (!fit) break;
    refined = fit;
  }
  const inliers = count(refined);
  const scale = similarityScale(refined);
  const rot = Math.abs(similarityRotationDeg(refined));
  const accepted = inliers >= K.minInliers && scale >= K.minScale && scale <= K.maxScale && rot <= K.maxRotationDeg;
  return accepted ? { similarity: refined, accepted, matches: matches.length, inliers } : { ...none, inliers };
}

/** Align two frames: feature matches then RANSAC similarity (A coordinates to B coordinates). */
export function alignFrames(a: RGBAFrame, b: RGBAFrame): AlignmentResult {
  return estimateSimilarity(matchFeatures(lumaOf(a), lumaOf(b), a.width, a.height));
}

/**
 * B sampled at S(x) for every pixel x of A's grid: B expressed in A's frame. `valid` marks the pixels whose source
 * lies inside B (the rest is clamped edge colour and carries no information).
 */
export function warpByInverseSimilarity(b: RGBAFrame, s: Similarity): { frame: RGBAFrame; valid: Uint8Array } {
  const { width: w, height: h } = b;
  const out = new Uint8ClampedArray(w * h * 4);
  const valid = new Uint8Array(w * h);
  const d = b.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = applySimilarity(s, x, y);
      const inside = sx >= 0 && sx <= w - 1 && sy >= 0 && sy <= h - 1;
      const xc = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
      const yc = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy;
      const x0 = Math.floor(xc);
      const y0 = Math.floor(yc);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(h - 1, y0 + 1);
      const fx = xc - x0;
      const fy = yc - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = d[i00 + c] * (1 - fx) + d[i10 + c] * fx;
        const bot = d[i01 + c] * (1 - fx) + d[i11 + c] * fx;
        out[o + c] = Math.round(top * (1 - fy) + bot * fy);
      }
      valid[y * w + x] = inside ? 1 : 0;
    }
  }
  return { frame: { width: w, height: h, data: out }, valid };
}
