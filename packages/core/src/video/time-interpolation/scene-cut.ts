import type { RGBAFrame } from "./frame-blend";
import { computeFlowPair, flowFactor, lumaDownsample } from "./optical-flow-cpu";
import type { FlowParams } from "./types";

/**
 * Scene-cut detection between two consecutive source frames of a retimed clip.
 *
 * Warping or blending across a hard cut makes a ghost (Frame Blending) or a smeared morph (Optical Flow), so when the
 * two frames are a cut the interpolator outputs the nearer source frame instead (see TimeInterpolator.render).
 *
 * The decision is made by ONE function on the two decoded source frames, before any backend runs. The WebGPU path
 * and the CPU path therefore always agree on whether a pair is a cut and on what is shown for it; the GPU only ever
 * sees pairs that were judged not to be cuts.
 *
 * Four measures on a small (<= 128 px) luma image of each frame. Each alone is fooled by something ordinary, so a
 * pair is a cut only when they agree:
 *  - correlation: best zero-mean normalised cross-correlation over translations of up to 37% of the picture. A pan of
 *    any speed, a flash, a fade and an exposure change are all the same picture, so it stays near 1; unrelated
 *    pictures sit well below. This is what keeps a fast pan (where the flow field breaks down) from reading as a cut.
 *  - meanConfidence: mean forward/backward-consistent, contrast-normalised flow match confidence (0..1). Real motion
 *    (rotation, a moving object) is matched; unrelated pictures are not. Guards the cases where part of the picture
 *    is shared (a moving subject over an unchanged background) and the correlation is only moderate.
 *  - warpedError: mean |A - B(x + flow)| of the raw luma. The change must also be large after motion compensation.
 *  - histogramDistance: total-variation distance of the 32-bin luma histograms. A large shift of the tonal
 *    distribution is accepted as evidence in place of warpedError (a cut between two dark pictures has a small
 *    luma error but a different histogram).
 *
 * Thresholds were tuned on the synthetic scenes of synthetic-scenes.ts and on ffmpeg testsrc2 frames (see
 * scene-cut.test.ts for the set and the measured false-positive / false-negative rates).
 */
export const SCENE_CUT_ANALYSIS: FlowParams = { maxDim: 128, levels: 4, iterations: 3, radius: 3 };

export const SCENE_CUT_THRESHOLDS = {
  /** Cut only when the best-translation correlation is at most this ... */
  correlation: 0.6,
  /** ... and the flow is trusted on at most this fraction of the picture ... */
  confidence: 0.45,
  /** ... and the motion-compensated luma still differs by at least this, or ... */
  warpedError: 0.05,
  /** ... the luma histograms differ by at least this. */
  histogram: 0.25,
  /** ... or the pictures are as unrelated as it gets: correlation at most this and the flow trusted on at most the next. */
  strongCorrelation: 0.25,
  strongConfidence: 0.3,
  /**
   * A picture whose luma standard deviation is below this (a white flash, a black frame, a flat card, a fully clipped
   * exposure) has nothing to match; whether it is a flash, a dip or a cut to a card cannot be told, and blending toward
   * it reads as a fade, so such a pair is never treated as a cut (it would otherwise hinge on the flow confidence of a
   * flat target, which varies with the other picture).
   */
  minContrast: 0.008,
} as const;

export interface SceneCutMeasures {
  /** Best zero-mean normalised cross-correlation of the two luma images over translations (-1..1). */
  readonly correlation: number;
  readonly histogramDistance: number;
  readonly meanConfidence: number;
  readonly warpedError: number;
  /** The smaller of the two pictures' luma standard deviations. */
  readonly contrast: number;
}

export interface SceneCutDecision extends SceneCutMeasures {
  readonly isCut: boolean;
}

const BINS = 32;
/** The correlation search works on a luma image no larger than this on its long side. */
const CORR_DIM = 64;
/** Largest translation searched, as a fraction of the picture (leaves >= 1/4 of it overlapping). */
const CORR_SHIFT = 0.375;
/** Overlap with less variance than this (luma^2) carries no structure to correlate. */
const CORR_FLAT = 1e-6;

function shrink(p: { data: Float32Array; width: number; height: number }): { data: Float32Array; width: number; height: number } {
  let cur = p;
  while (Math.max(cur.width, cur.height) > CORR_DIM) {
    const w = Math.ceil(cur.width / 2);
    const h = Math.ceil(cur.height / 2);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x1 = Math.min(cur.width - 1, 2 * x + 1);
        const y1 = Math.min(cur.height - 1, 2 * y + 1);
        out[y * w + x] = (cur.data[2 * y * cur.width + 2 * x] + cur.data[2 * y * cur.width + x1] + cur.data[y1 * cur.width + 2 * x] + cur.data[y1 * cur.width + x1]) / 4;
      }
    }
    cur = { data: out, width: w, height: h };
  }
  return cur;
}

/**
 * Best normalised correlation of A with B shifted by (dx, dy) over the overlapping region. Insensitive to a pan
 * (any size the search covers) and to a global gain/offset (flash, fade, exposure change), so it is high for
 * everything that is the same picture changed and low only for unrelated pictures.
 */
function bestCorrelation(pa: { data: Float32Array; width: number; height: number }, pb: { data: Float32Array; width: number; height: number }): number {
  const a = shrink(pa);
  const b = shrink(pb);
  const w = a.width;
  const h = a.height;
  const mx = Math.max(1, Math.floor(w * CORR_SHIFT));
  const my = Math.max(1, Math.floor(h * CORR_SHIFT));
  let best = -1;
  let anyStructure = false;
  for (let dy = -my; dy <= my; dy++) {
    for (let dx = -mx; dx <= mx; dx++) {
      const x0 = Math.max(0, -dx);
      const x1 = Math.min(w, w - dx);
      const y0 = Math.max(0, -dy);
      const y1 = Math.min(h, h - dy);
      const n = (x1 - x0) * (y1 - y0);
      if (n <= 0) continue;
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const va = a.data[y * w + x];
          const vb = b.data[(y + dy) * w + x + dx];
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      }
      const varA = saa / n - (sa / n) * (sa / n);
      const varB = sbb / n - (sb / n) * (sb / n);
      if (varA > CORR_FLAT || varB > CORR_FLAT) anyStructure = true;
      const r = varA > CORR_FLAT && varB > CORR_FLAT ? (sab / n - (sa / n) * (sb / n)) / Math.sqrt(varA * varB) : 0;
      if (r > best) best = r;
    }
  }
  // two pictures without any structure (flat colours) cannot be told apart from a flash or fade
  return anyStructure ? best : 1;
}

function lumaStd(luma: Float32Array): number {
  let s = 0;
  let ss = 0;
  for (let i = 0; i < luma.length; i++) {
    s += luma[i];
    ss += luma[i] * luma[i];
  }
  const n = luma.length || 1;
  return Math.sqrt(Math.max(0, ss / n - (s / n) * (s / n)));
}

function histogram(luma: Float32Array): Float64Array {
  const h = new Float64Array(BINS);
  for (let i = 0; i < luma.length; i++) h[Math.min(BINS - 1, Math.max(0, Math.floor(luma[i] * BINS)))]++;
  const n = luma.length || 1;
  for (let i = 0; i < BINS; i++) h[i] /= n;
  return h;
}

function sampleLuma(p: { data: Float32Array; width: number; height: number }, x: number, y: number): number {
  const xc = Math.min(p.width - 1, Math.max(0, x));
  const yc = Math.min(p.height - 1, Math.max(0, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(p.width - 1, x0 + 1);
  const y1 = Math.min(p.height - 1, y0 + 1);
  const fx = xc - x0;
  const fy = yc - y0;
  const d = p.data;
  const w = p.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bot = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

export function measureSceneCut(a: RGBAFrame, b: RGBAFrame): SceneCutMeasures {
  const factor = flowFactor(a.width, a.height, SCENE_CUT_ANALYSIS);
  const la = lumaDownsample(a, factor);
  const lb = lumaDownsample(b, factor);
  const ha = histogram(la.data);
  const hb = histogram(lb.data);
  let tv = 0;
  for (let i = 0; i < BINS; i++) tv += Math.abs(ha[i] - hb[i]);

  const pair = computeFlowPair(a, b, SCENE_CUT_ANALYSIS);
  const n = pair.width * pair.height;
  let conf = 0;
  let err = 0;
  for (let i = 0; i < n; i++) {
    conf += pair.confAB[i] + pair.confBA[i];
    const x = i % pair.width;
    const y = (i - x) / pair.width;
    err += Math.abs(la.data[i] - sampleLuma(lb, x + pair.ab[i * 2], y + pair.ab[i * 2 + 1]));
  }
  return { correlation: bestCorrelation(la, lb), histogramDistance: tv / 2, meanConfidence: conf / (2 * n), warpedError: err / n, contrast: Math.min(lumaStd(la.data), lumaStd(lb.data)) };
}

export function classifySceneCut(m: SceneCutMeasures): boolean {
  const t = SCENE_CUT_THRESHOLDS;
  if (m.contrast < t.minContrast) return false;
  const unrelated = m.correlation <= t.strongCorrelation && m.meanConfidence <= t.strongConfidence;
  return m.correlation <= t.correlation && m.meanConfidence <= t.confidence && (m.warpedError >= t.warpedError || m.histogramDistance >= t.histogram || unrelated);
}

export function detectSceneCut(a: RGBAFrame, b: RGBAFrame): SceneCutDecision {
  if (a.width !== b.width || a.height !== b.height) return { isCut: true, correlation: 0, histogramDistance: 1, meanConfidence: 0, warpedError: 1, contrast: 1 };
  const m = measureSceneCut(a, b);
  return { ...m, isCut: classifySceneCut(m) };
}
