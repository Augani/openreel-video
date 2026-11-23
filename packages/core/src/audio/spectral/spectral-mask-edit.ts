/**
 * Mask-shaped spectral edits (lasso, brush, and any heal): attenuate, remove and heal over a soft time-frequency mask.
 *
 * Like the rectangle path, only the frames the mask touches are analysed and the result is added back as a frame
 * difference, so audio outside the mask is bit-identical and an edit that changes nothing changes nothing.
 *
 * attenuate  scales the masked cells by the gain.
 * remove     replaces them by the magnitude interpolated from the nearest untouched cells (along the shorter axis)
 *            with a deterministic noise phase (the same fill the rectangle "Remove" uses).
 * heal       fills them from both sides with a model of what was underneath, in three smooth steps (no argmax, no
 *            threshold on noisy values, no iteration whose count depends on the signal):
 *              1. level   the expected POWER of the background is averaged over several untouched cells on every side and
 *                         interpolated across the gap (power, not magnitude, so a noise floor keeps its level and is not
 *                         thinned into holes);
 *              2. phase   each bin's phase is continued from the left of the gap and backwards from the right by phase-vocoder
 *                         propagation, cross-faded by position; where the two sides do not agree (noise) the coherence
 *                         shrinks smoothly and a deterministic noise phase takes over;
 *              3. texture a fixed number of consistency passes (synthesise, re-analyse, rescale each tile to the target
 *                         power by a smooth gain). The gain is a ratio of tile-averaged powers, so unlike Griffin-Lim's
 *                         per-cell phase normalisation it cannot blow up a tiny input change. Every untouched cell stays
 *                         exactly as recorded.
 */
import { MASK_EPS, rasterizeRegionMask, type RegionMask } from "./spectral-mask";
import { hashUnit, analyseFrame, stftFrameRange, type StftPlan } from "./spectral-stft";
import type { SpectralRegion } from "./spectral-regions";

/** Consistency passes of a heal (fixed: the same for every input of a given mask size). */
const HEAL_ITERATIONS = 6;
/** Half-size, in frames and bins, of the tile a heal pass matches to the target power. */
const TILE_FRAMES = 1;
const TILE_BINS = 3;
/** Known cells averaged on each side of a gap to estimate the background power. */
const SIDE_FREQ_CELLS = 4;
const SIDE_TIME_FRAMES = 3;
/** Frames of recorded context analysed on each side of a heal's mask (the phase advance is measured over them). */
const HEAL_CONTEXT_FRAMES = 5;
/** Frame pairs (and, on top, 3 bins) whose cross-spectrum measures a partial's phase advance at the edge of a gap. */
const ADVANCE_PAIRS = 3;
/** Boundary phase-advance coherence (0 noise .. 1 stable partial) that maps to tonality 0 and 1. */
const TONAL_LOW = 0.5;
const TONAL_HIGH = 0.85;
/** Gap length in seconds up to which a partial is carried in full, and from which it is not carried at all. */
export const TONAL_GAP_FULL_S = 0.26;
export const TONAL_GAP_NONE_S = 0.52;
/** Forward / backward prediction agreement that maps to tonality 0 and 1. */
const AGREE_LOW = 0.7;
const AGREE_HIGH = 0.95;

const TWO_PI = 2 * Math.PI;

/** The mask and the spectra around it (one cell of margin on every side, where available). */
interface Cells {
  readonly mask: RegionMask;
  readonly r0: number; // first frame of the grid
  readonly rm: number; // frames of margin above and below the mask
  readonly c0: number; // first bin of the grid
  readonly rows: number;
  readonly cols: number;
  readonly exists: Uint8Array;
  readonly w: Float32Array; // 0 on the margin
  readonly re: Float32Array;
  readonly im: Float32Array;
  readonly mag: Float32Array;
}

function analyseCells(work: Float32Array, mask: RegionMask, plan: StftPlan, rm: number): Cells {
  const half = plan.size / 2;
  const range = stftFrameRange(work.length, plan);
  const r0 = mask.mFirst - rm;
  const c0 = mask.kLo - 1;
  const rows = mask.frames + 2 * rm;
  const cols = mask.bins + 2;
  const exists = new Uint8Array(rows * cols);
  const w = new Float32Array(rows * cols);
  const re = new Float32Array(rows * cols);
  const im = new Float32Array(rows * cols);
  const mag = new Float32Array(rows * cols);
  const scratch = new Float32Array(plan.size);
  for (let r = 0; r < rows; r += 1) {
    const m = r0 + r;
    if (m < range.first || m > range.last) continue;
    const spectrum = analyseFrame(plan, work, m * plan.hop, scratch);
    for (let c = 0; c < cols; c += 1) {
      const k = c0 + c;
      if (k < 0 || k > half) continue;
      const i = r * cols + c;
      exists[i] = 1;
      re[i] = spectrum.real[k];
      im[i] = spectrum.imag[k];
      mag[i] = Math.hypot(re[i], im[i]);
      if (r >= rm && r < rm + mask.frames && c >= 1 && c <= mask.bins) w[i] = mask.weights[(r - rm) * mask.bins + (c - 1)];
    }
  }
  return { mask, r0, rm, c0, rows, cols, exists, w, re, im, mag };
}

const isKnown = (cells: Cells, i: number): boolean => cells.exists[i] === 1 && cells.w[i] <= MASK_EPS;
const isUnknown = (cells: Cells, i: number): boolean => cells.exists[i] === 1 && cells.w[i] > MASK_EPS;

interface Axis {
  /** Index (row or column) of the nearest known cell before / after, or -1. */
  readonly before: Int32Array;
  readonly after: Int32Array;
}

/** For every cell, the nearest known cell on each side along rows (time) or columns (frequency). */
function sweep(cells: Cells, alongTime: boolean): Axis {
  const { rows, cols } = cells;
  const before = new Int32Array(rows * cols).fill(-1);
  const after = new Int32Array(rows * cols).fill(-1);
  const lines = alongTime ? cols : rows;
  const length = alongTime ? rows : cols;
  const at = (line: number, pos: number) => (alongTime ? pos * cols + line : line * cols + pos);
  for (let line = 0; line < lines; line += 1) {
    let last = -1;
    for (let pos = 0; pos < length; pos += 1) {
      const i = at(line, pos);
      if (cells.exists[i] === 0) last = -1;
      else if (isKnown(cells, i)) last = pos;
      before[i] = last;
    }
    last = -1;
    for (let pos = length - 1; pos >= 0; pos -= 1) {
      const i = at(line, pos);
      if (cells.exists[i] === 0) last = -1;
      else if (isKnown(cells, i)) last = pos;
      after[i] = last;
    }
  }
  return { before, after };
}

interface Fill {
  /** Target magnitude for every unknown cell (0 elsewhere). */
  readonly target: Float32Array;
}

function interpolateTargets(cells: Cells): Fill {
  const { rows, cols } = cells;
  const freq = sweep(cells, false);
  const time = sweep(cells, true);
  const target = new Float32Array(rows * cols);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!isUnknown(cells, i)) continue;
      let wf = 0;
      let tf = 0;
      const cl = freq.before[i];
      const cr = freq.after[i];
      if (cl >= 0 && cr >= 0) {
        const a = cells.mag[r * cols + cl];
        const b = cells.mag[r * cols + cr];
        tf = a + ((b - a) * (c - cl)) / (cr - cl);
        wf = 1 / ((cr - cl) * (cr - cl));
      } else if (cl >= 0 || cr >= 0) {
        const at = cl >= 0 ? cl : cr;
        tf = cells.mag[r * cols + at];
        wf = 1 / (9 * (c - at) * (c - at));
      }
      let wt = 0;
      let tt = 0;
      const ru = time.before[i];
      const rd = time.after[i];
      if (ru >= 0 && rd >= 0) {
        const along = (r - ru) / (rd - ru);
        const a = cells.mag[ru * cols + c];
        const b = cells.mag[rd * cols + c];
        tt = a + (b - a) * along;
        wt = 1 / ((rd - ru) * (rd - ru));
      } else if (ru >= 0 || rd >= 0) {
        const at = ru >= 0 ? ru : rd;
        tt = cells.mag[at * cols + c];
        wt = 1 / (9 * (r - at) * (r - at));
      }
      // Weighted harmonic mean: when the two axes disagree the fill leans to the quieter one. The mask marks what is unwanted,
      // and filling it with more of it (a tone that continues past the selection, a loud neighbour) is the worse mistake.
      target[i] = wf + wt > 0 ? (wf + wt) / (wf / (tf + 1e-9) + wt / (tt + 1e-9)) : 0;
    }
  }
  return { target };
}

/** Writes a half-spectrum cell into a full-size spectrum (conjugate-symmetric). */
function putBin(dr: Float32Array, di: Float32Array, size: number, k: number, re: number, im: number): void {
  const half = size / 2;
  const edge = k === 0 || k === half;
  dr[k] = re;
  di[k] = edge ? 0 : im;
  if (!edge) {
    dr[size - k] = re;
    di[size - k] = -im;
  }
}

/**
 * Expected background POWER of every unknown cell: the average power of a few untouched cells on each side along frequency and
 * along time (not a single cell, whose Rayleigh fluctuation would bias the estimate), interpolated in power and combined as
 * a weighted harmonic mean (the mask marks what is unwanted, so where the axes disagree the fill leans to the quieter one).
 */
function healPowerTargets(cells: Cells, tonal: Float32Array): Float32Array {
  const { rows, cols } = cells;
  const freq = sweep(cells, false);
  const time = sweep(cells, true);
  const target = new Float32Array(rows * cols);
  const power = (i: number): number => cells.mag[i] * cells.mag[i];
  const freqSide = (r: number, from: number, step: number): number => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < SIDE_FREQ_CELLS; k += 1) {
      const cc = from + step * k;
      if (cc < 0 || cc >= cols || !isKnown(cells, r * cols + cc)) break;
      sum += power(r * cols + cc);
      n += 1;
    }
    return n > 0 ? sum / n : 0;
  };
  const timeSide = (c: number, from: number, step: number): number => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < SIDE_TIME_FRAMES; k += 1) {
      const rr = from + step * k;
      if (rr < 0 || rr >= rows) break;
      let any = false;
      for (let dc = -1; dc <= 1; dc += 1) {
        const cc = c + dc;
        if (cc < 0 || cc >= cols || !isKnown(cells, rr * cols + cc)) continue;
        sum += power(rr * cols + cc);
        n += 1;
        any = true;
      }
      if (!any) break;
    }
    return n > 0 ? sum / n : 0;
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!isUnknown(cells, i)) continue;
      let wf = 0;
      let pf = 0;
      const cl = freq.before[i];
      const cr = freq.after[i];
      if (cl >= 0 && cr >= 0) {
        const a = freqSide(r, cl, -1);
        const b = freqSide(r, cr, 1);
        pf = a + ((b - a) * (c - cl)) / (cr - cl);
        wf = 1 / ((cr - cl) * (cr - cl));
      } else if (cl >= 0 || cr >= 0) {
        const at = cl >= 0 ? cl : cr;
        pf = freqSide(r, at, cl >= 0 ? -1 : 1);
        wf = 1 / (9 * (c - at) * (c - at));
      }
      let wt = 0;
      let pt = 0;
      const ru = time.before[i];
      const rd = time.after[i];
      if (ru >= 0 && rd >= 0) {
        const a = timeSide(c, ru, -1);
        const b = timeSide(c, rd, 1);
        pt = a + ((b - a) * (r - ru)) / (rd - ru);
        wt = 1 / ((rd - ru) * (rd - ru));
      } else if (ru >= 0 || rd >= 0) {
        const at = ru >= 0 ? ru : rd;
        pt = timeSide(c, at, ru >= 0 ? -1 : 1);
        wt = 1 / (9 * (r - at) * (r - at));
      }
      const mixed = wf + wt > 0 ? (wf + wt) / (wf / (pf + 1e-18) + wt / (pt + 1e-18)) : 0;
      // A bin that behaves like a stable partial at both ends of its gap continues at the level the gap's two ends give it.
      target[i] = wt > 0 ? tonal[i] * pt + (1 - tonal[i]) * mixed : mixed;
    }
  }
  return target;
}

/**
 * Initial value of every unknown cell: the phase of each bin continued from the left of its gap and backwards from the right by
 * phase-vocoder propagation (the per-frame advance is the cross-spectrum of the last two known frames), cross-faded by position.
 * Everything is a smooth function of the recorded cells: the unit phasors are softly normalised (a near-zero cell yields a short
 * vector, not a wild phase), the coherence is the length of the blend, and the missing length is filled with a deterministic
 * noise phase, so incoherent (noise) bins get noise and coherent partials continue.
 */
function initialPhasors(cells: Cells, channel: number, frameSeconds: number): { re: Float32Array; im: Float32Array; tonal: Float32Array } {
  const { rows, cols } = cells;
  const time = sweep(cells, true);
  const outRe = new Float32Array(rows * cols);
  const outIm = new Float32Array(rows * cols);
  const outTonal = new Float32Array(rows * cols);
  // Scale of the recorded cells: softens the normalisations below.
  let scaleSum = 0;
  let scaleN = 0;
  for (let i = 0; i < cells.mag.length; i += 1) {
    if (!isKnown(cells, i)) continue;
    scaleSum += cells.mag[i] * cells.mag[i];
    scaleN += 1;
  }
  const kappa2 = Math.max(1e-24, 0.04 * (scaleSum / Math.max(1, scaleN)));
  const soft = (re: number, im: number, floor: number): [number, number] => {
    const d = Math.hypot(re, im) + floor;
    return [re / d, im / d];
  };
  const kappa = Math.sqrt(kappa2);
  const cpow = (re: number, im: number, n: number): [number, number] => {
    let pr = 1;
    let pi = 0;
    // n is an integer count of frames; repeated squaring keeps long gaps cheap and exact in the same way every time.
    let br = re;
    let bi = im;
    let e = n;
    while (e > 0) {
      if (e & 1) [pr, pi] = [pr * br - pi * bi, pr * bi + pi * br];
      [br, bi] = [br * br - bi * bi, 2 * br * bi];
      e >>= 1;
    }
    return [pr, pi];
  };
  /**
   * Per-frame phase advance of the partial at (row, bin c), measured as the cross-spectrum summed over a few frame pairs
   * and the neighbouring bins on the near side of the gap (`dir` -1: frames before `row`, +1: after) and softly normalised.
   * Averaging over frames and bins is what makes the estimated frequency good enough to carry a partial across a gap.
   */
  const advance = (row: number, c: number, dir: -1 | 1): [number, number, number] => {
    let vr = 0;
    let vi = 0;
    let vabs = 0;
    let n = 0;
    for (let j = 0; j < ADVANCE_PAIRS; j += 1) {
      const a = row + dir * j;
      const b = a + dir;
      if (a < 0 || a >= rows || b < 0 || b >= rows) break;
      for (let dc = -1; dc <= 1; dc += 1) {
        const cc = c + dc;
        if (cc < 0 || cc >= cols) continue;
        const ia = a * cols + cc;
        const ib = b * cols + cc;
        if (!isKnown(cells, ia) || !isKnown(cells, ib)) continue;
        // later frame times the conjugate of the earlier one: dir -1 -> (a later), dir +1 -> (b later).
        const [lat, ear] = dir < 0 ? [ia, ib] : [ib, ia];
        const wr = cells.re[lat] * cells.re[ear] + cells.im[lat] * cells.im[ear];
        const wi = cells.im[lat] * cells.re[ear] - cells.re[lat] * cells.im[ear];
        vr += wr;
        vi += wi;
        vabs += Math.hypot(wr, wi);
        n += 1;
      }
    }
    if (n === 0) return [0, 0, 0];
    const d = Math.hypot(vr, vi) + kappa2 * n;
    const coherence = Math.hypot(vr, vi) / (vabs + kappa2 * n);
    // Forward the advance rotates the last frame ahead; backward we rotate the first frame back.
    return dir < 0 ? [vr / d, vi / d, coherence] : [vr / d, -vi / d, coherence];
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!isUnknown(cells, i)) continue;
      const k = cells.c0 + c;
      const ru = time.before[i];
      const rd = time.after[i];
      let zr = 0;
      let zi = 0;
      let weightSum = 0;
      let cohBefore = -1;
      let cohAfter = -1;
      let fwdR = 0;
      let fwdI = 0;
      let bwdR = 0;
      let bwdI = 0;
      if (ru >= 0) {
        const j = ru * cols + c;
        const [ur, ui] = soft(cells.re[j], cells.im[j], kappa);
        const [sr, si, coh] = advance(ru, c, -1);
        cohBefore = coh;
        const [pr, pi] = cpow(sr, si, r - ru);
        const weight = rd >= 0 ? 1 - (r - ru) / (rd - ru) : 1;
        fwdR = ur * pr - ui * pi;
        fwdI = ur * pi + ui * pr;
        zr += weight * fwdR;
        zi += weight * fwdI;
        weightSum += weight;
      }
      if (rd >= 0) {
        const j = rd * cols + c;
        const [ur, ui] = soft(cells.re[j], cells.im[j], kappa);
        const [sr, si, coh] = advance(rd, c, 1);
        cohAfter = coh;
        const [pr, pi] = cpow(sr, si, rd - r);
        const weight = ru >= 0 ? (r - ru) / (rd - ru) : 1;
        bwdR = ur * pr - ui * pi;
        bwdI = ur * pi + ui * pr;
        zr += weight * bwdR;
        zi += weight * bwdI;
        weightSum += weight;
      }
      // Coherent part (as long as it is) plus the deterministic noise phasor for the rest.
      const coherence = weightSum > 0 ? Math.min(1, Math.hypot(zr, zi) / weightSum) : 0;
      const phase = TWO_PI * hashUnit(k, cells.r0 + r, channel);
      const rest = 1 - coherence;
      const norm = weightSum > 0 ? 1 / weightSum : 0;
      outRe[i] = zr * norm + rest * Math.cos(phase);
      outIm[i] = zi * norm + rest * Math.sin(phase);
      // Tonality: both ends of the gap must show a stable partial (one end alone counts for less). The two predictions must also
      // agree with each other: the one from the far end is a long extrapolation, so their agreement is the cross-check that the
      // partial really continues.
      const ramp = (x: number, lo: number, hi: number): number => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
      const both = cohBefore >= 0 && cohAfter >= 0;
      const agree = both ? Math.hypot(fwdR + bwdR, fwdI + bwdI) / 2 : 1;
      const stable = both ? Math.sqrt(cohBefore * cohAfter) : 0.7 * Math.max(cohBefore, cohAfter, 0);
      // A partial is only carried across a gap short enough to be a repair (a cough, a click): over a long selection the user is
      // removing the sound itself (a tone, a hum), and continuing it would put it back.
      const gap = both ? rd - ru : cells.mask.frames;
      const shortGap = 1 - ramp(gap * frameSeconds, TONAL_GAP_FULL_S, TONAL_GAP_NONE_S);
      outTonal[i] = ramp(stable, TONAL_LOW, TONAL_HIGH) * ramp(agree, AGREE_LOW, AGREE_HIGH) * shortGap;
    }
  }
  return { re: outRe, im: outIm, tonal: outTonal };
}

export function applyMaskRegion(work: Float32Array, sampleRate: number, region: SpectralRegion, plan: StftPlan, channel: number): void {
  if (work.length === 0) return;
  const range = stftFrameRange(work.length, plan);
  const mask = rasterizeRegionMask(region, { sampleRate, size: plan.size, hop: plan.hop, firstFrame: range.first, lastFrame: range.last });
  if (!mask) return;
  const { size, hop, window, norm } = plan;
  const half = size / 2;
  const cells = analyseCells(work, mask, plan, region.mode === "heal" ? HEAL_CONTEXT_FRAMES : 1);
  const { rows, cols } = cells;
  const sampleStart = mask.mFirst * hop;
  const segLength = (mask.mLast - mask.mFirst) * hop + size;
  const dr = new Float32Array(size);
  const di = new Float32Array(size);

  /** Overlap-adds (cell value - original) * scale(cell) for every unknown cell into a segment-length buffer. */
  const synthesise = (valueRe: Float32Array, valueIm: Float32Array, weighted: boolean, out: Float32Array): void => {
    out.fill(0);
    for (let f = 0; f < mask.frames; f += 1) {
      dr.fill(0);
      di.fill(0);
      let touched = false;
      for (let b = 0; b < mask.bins; b += 1) {
        const i = (f + cells.rm) * cols + (b + 1);
        const weight = weighted ? cells.w[i] : 1;
        if (weight <= 0 || !isUnknown(cells, i)) continue;
        touched = true;
        putBin(dr, di, size, mask.kLo + b, (valueRe[i] - cells.re[i]) * weight, (valueIm[i] - cells.im[i]) * weight);
      }
      if (!touched) continue;
      const time = plan.fft.inverse(dr, di);
      const base = f * hop;
      for (let n = 0; n < size; n += 1) out[base + n] += time[n] * window[n];
    }
    for (let n = 0; n < segLength; n += 1) out[n] /= norm;
  };
  const commit = (delta: Float32Array): void => {
    for (let n = 0; n < segLength; n += 1) {
      const at = sampleStart + n;
      if (at >= 0 && at < work.length) work[at] += delta[n];
    }
  };

  if (region.mode === "attenuate") {
    const gain = Math.pow(10, region.gainDb / 20);
    const vr = new Float32Array(rows * cols);
    const vi = new Float32Array(rows * cols);
    for (let i = 0; i < vr.length; i += 1) {
      vr[i] = cells.re[i] * gain;
      vi[i] = cells.im[i] * gain;
    }
    const delta = new Float32Array(segLength);
    synthesise(vr, vi, true, delta);
    commit(delta);
    return;
  }

  if (region.mode === "heal") {
    healCells(cells, mask, plan, channel, sampleRate, work, sampleStart, segLength, synthesise, commit);
    return;
  }

  const { target } = interpolateTargets(cells);
  const fillRe = new Float32Array(rows * cols);
  const fillIm = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!isUnknown(cells, i)) continue;
      const k = cells.c0 + c;
      const phase = TWO_PI * hashUnit(k, cells.r0 + r, channel);
      const edge = k === 0 || k === half;
      fillRe[i] = edge ? target[i] * (Math.cos(phase) >= 0 ? 1 : -1) : target[i] * Math.cos(phase);
      fillIm[i] = edge ? 0 : target[i] * Math.sin(phase);
    }
  }
  const delta = new Float32Array(segLength);
  synthesise(fillRe, fillIm, true, delta);
  commit(delta);
}

type Synthesise = (valueRe: Float32Array, valueIm: Float32Array, weighted: boolean, out: Float32Array) => void;

/** Box-average of `values` over the unknown cells of a (2 * TILE_FRAMES + 1) x (2 * TILE_BINS + 1) window. */
function tileMean(cells: Cells, values: Float32Array): Float32Array {
  const { rows, cols } = cells;
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (!isUnknown(cells, i)) continue;
      let sum = 0;
      let n = 0;
      for (let rr = Math.max(0, r - TILE_FRAMES); rr <= Math.min(rows - 1, r + TILE_FRAMES); rr += 1) {
        for (let cc = Math.max(0, c - TILE_BINS); cc <= Math.min(cols - 1, c + TILE_BINS); cc += 1) {
          const j = rr * cols + cc;
          if (!isUnknown(cells, j)) continue;
          sum += values[j];
          n += 1;
        }
      }
      out[i] = sum / n;
    }
  }
  return out;
}

function healCells(cells: Cells, mask: RegionMask, plan: StftPlan, channel: number, sampleRate: number, work: Float32Array, sampleStart: number, segLength: number, synthesise: Synthesise, commit: (delta: Float32Array) => void): void {
  const { rows, cols } = cells;
  const { size, window } = plan;
  const half = size / 2;
  const phasors = initialPhasors(cells, channel, plan.hop / sampleRate);
  const power = healPowerTargets(cells, phasors.tonal);
  const tilePower = tileMean(cells, power);
  let curRe = new Float32Array(rows * cols);
  let curIm = new Float32Array(rows * cols);
  for (let i = 0; i < curRe.length; i += 1) {
    const amp = Math.sqrt(power[i]);
    curRe[i] = amp * phasors.re[i];
    curIm[i] = amp * phasors.im[i];
  }
  const seg = new Float32Array(segLength);
  for (let n = 0; n < segLength; n += 1) {
    const at = sampleStart + n;
    seg[n] = at >= 0 && at < work.length ? work[at] : 0;
  }
  const delta = new Float32Array(segLength);
  const frameIn = new Float32Array(size);
  const yRe = new Float32Array(rows * cols);
  const yIm = new Float32Array(rows * cols);
  const yPower = new Float32Array(rows * cols);
  for (let it = 0; it < HEAL_ITERATIONS; it += 1) {
    // Consistent signal: recorded cells untouched, unknown cells as currently filled.
    synthesise(curRe, curIm, false, delta);
    for (let n = 0; n < segLength; n += 1) delta[n] += seg[n];
    for (let f = 0; f < mask.frames; f += 1) {
      const base = f * plan.hop;
      for (let n = 0; n < size; n += 1) {
        const at = sampleStart + base + n;
        frameIn[n] = at >= 0 && at < work.length ? delta[base + n] * window[n] : 0;
      }
      const spectrum = plan.fft.forward(frameIn);
      for (let b = 0; b < mask.bins; b += 1) {
        const i = (f + cells.rm) * cols + (b + 1);
        if (!isUnknown(cells, i)) continue;
        const k = mask.kLo + b;
        yRe[i] = spectrum.real[k];
        yIm[i] = k === 0 || k === half ? 0 : spectrum.imag[k];
        yPower[i] = yRe[i] * yRe[i] + yIm[i] * yIm[i];
      }
    }
    // Smooth tile gain: bring the consistent spectrum to the target power, keeping its own fine structure.
    const tileY = tileMean(cells, yPower);
    for (let i = 0; i < curRe.length; i += 1) {
      if (!isUnknown(cells, i)) continue;
      const gain = Math.sqrt((tilePower[i] + 1e-24) / (tileY[i] + 1e-3 * tilePower[i] + 1e-24));
      curRe[i] = yRe[i] * gain;
      curIm[i] = yIm[i] * gain;
    }
  }
  synthesise(curRe, curIm, true, delta);
  commit(delta);
}
