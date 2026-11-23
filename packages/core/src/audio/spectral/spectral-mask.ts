/**
 * Rasterises a spectral region onto the STFT grid as a soft mask: one weight in [0, 1] per (frame, bin).
 *
 * Shapes live on the time / log-frequency plane (the plane the editor draws on), so a lasso edge that looks
 * straight on the spectrogram is straight here, and a brush is an ellipse of fixed seconds x octaves. Each cell is
 * sampled 2 x 2 for anti-aliased coverage, then softened by a feather (a triangular blur of `feather` cells in each
 * direction). Pure and deterministic: the preview, the export and the tests rasterise identical masks.
 */
import { MASK_MIN_HZ, harmonicF0At, regionFeather, regionShape, type SpectralPoint, type SpectralRegion, type SpectralWandMask } from "./spectral-regions";

export interface RegionMask {
  /** First / last STFT frame index with a weight above zero (inclusive). */
  readonly mFirst: number;
  readonly mLast: number;
  /** First / last bin with a weight above zero (inclusive). */
  readonly kLo: number;
  readonly kHi: number;
  readonly frames: number;
  readonly bins: number;
  /** frames x bins, row = frame - mFirst, column = bin - kLo. */
  readonly weights: Float32Array;
}

export interface MaskGrid {
  readonly sampleRate: number;
  readonly size: number;
  readonly hop: number;
  /** Frames outside [firstFrame, lastFrame] do not exist (before / after the signal). */
  readonly firstFrame: number;
  readonly lastFrame: number;
}

/** Weights at or below this are "untouched": cells the fill may be interpolated from. */
export const MASK_EPS = 0.02;

const log2hz = (hz: number): number => Math.log2(Math.max(hz, MASK_MIN_HZ));

/** Even-odd point-in-polygon on the (time, log2 Hz) plane. */
export function pointInPolygon(t: number, y: number, xs: Float64Array, ys: Float64Array): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    const crosses = ys[i] > y !== ys[j] > y && t < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i];
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Squared distance in the brush's own units (1 = on the brush edge) from (t, y) to the stroke. */
export function brushDistance2(t: number, y: number, xs: Float64Array, ys: Float64Array, rt: number, ry: number): number {
  let best = Infinity;
  const n = xs.length;
  for (let i = 0; i < n; i += 1) {
    const ax = xs[i] / rt;
    const ay = ys[i] / ry;
    const bx = (i + 1 < n ? xs[i + 1] : xs[i]) / rt;
    const by = (i + 1 < n ? ys[i + 1] : ys[i]) / ry;
    const px = t / rt;
    const py = y / ry;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const ex = px - (ax + u * dx);
    const ey = py - (ay + u * dy);
    best = Math.min(best, ex * ex + ey * ey);
  }
  return best;
}

/** A decoded wand mask: one byte per cell of its bounding box (frame-major), plus the geometry to look cells up. */
export interface WandBits {
  readonly wand: SpectralWandMask;
  readonly bits: Uint8Array;
}

/** Expands the run-length cells of a stored wand mask. */
export function decodeWandBits(wand: SpectralWandMask): WandBits {
  const bits = new Uint8Array(wand.frames * wand.bins);
  let at = 0;
  for (let i = 0; i < wand.runs.length; i += 1) {
    const n = wand.runs[i];
    if (i % 2 === 1) bits.fill(1, at, at + n);
    at += n;
  }
  return { wand, bits };
}

/** Whether the stored wand mask selects the cell nearest to (t, hz). */
function wandCovers(decoded: WandBits, t: number, hz: number): boolean {
  const { wand, bits } = decoded;
  const m = Math.round((t * wand.sampleRate - wand.fftSize / 2) / wand.hop) - wand.m0;
  const k = Math.round((hz * wand.fftSize) / wand.sampleRate) - wand.k0;
  return m >= 0 && m < wand.frames && k >= 0 && k < wand.bins && bits[m * wand.bins + k] === 1;
}

/** Fraction of a harmonic band's half-width, in bins, below which the band is widened (a partial narrower than the STFT resolves would fall between sample points). */
const HARMONIC_MIN_HALF_BINS = 1.5;

function harmonicCovers(region: SpectralRegion, t: number, hz: number, binHz: number): boolean {
  const track = region.points;
  const spec = region.harmonic;
  if (!track || !spec || t < track[0].t || t > track[track.length - 1].t) return false;
  const f0 = harmonicF0At(track, t);
  const h = Math.round(hz / f0);
  if (h < 1 || h > spec.harmonics) return false;
  const centre = h * f0;
  if (centre > spec.maxHz) return false;
  const half = Math.max(centre * (Math.pow(2, spec.bandCents / 1200) - 1), HARMONIC_MIN_HALF_BINS * binHz);
  return Math.abs(hz - centre) <= half;
}

interface CoverageContext {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly binHz: number;
  readonly wand: WandBits | null;
}

function coverage(region: SpectralRegion, ctx: CoverageContext, t: number, hz: number): boolean {
  const { xs, ys } = ctx;
  const shape = regionShape(region);
  if (shape === "wand") return ctx.wand !== null && wandCovers(ctx.wand, t, hz);
  if (shape === "harmonic") return harmonicCovers(region, t, hz, ctx.binHz);
  if (shape === "rect") return t >= region.startTime && t <= region.endTime && hz >= region.lowHz && hz <= region.highHz;
  const y = log2hz(hz);
  if (shape === "lasso") return pointInPolygon(t, y, xs, ys);
  return brushDistance2(t, y, xs, ys, region.brushSeconds ?? 0.04, region.brushOctaves ?? 0.12) <= 1;
}

/** One pass of a box blur along an axis (radius r cells, zero outside the grid). */
function boxBlur(src: Float32Array, dst: Float32Array, rows: number, cols: number, r: number, alongRows: boolean): void {
  const norm = 1 / (2 * r + 1);
  if (alongRows) {
    for (let y = 0; y < rows; y += 1) {
      let sum = 0;
      for (let x = -r; x <= r; x += 1) if (x >= 0 && x < cols) sum += src[y * cols + x];
      for (let x = 0; x < cols; x += 1) {
        dst[y * cols + x] = sum * norm;
        const add = x + r + 1;
        const drop = x - r;
        if (add < cols) sum += src[y * cols + add];
        if (drop >= 0) sum -= src[y * cols + drop];
      }
    }
  } else {
    for (let x = 0; x < cols; x += 1) {
      let sum = 0;
      for (let y = -r; y <= r; y += 1) if (y >= 0 && y < rows) sum += src[y * cols + x];
      for (let y = 0; y < rows; y += 1) {
        dst[y * cols + x] = sum * norm;
        const add = y + r + 1;
        const drop = y - r;
        if (add < rows) sum += src[add * cols + x];
        if (drop >= 0) sum -= src[drop * cols + x];
      }
    }
  }
}

/**
 * The soft mask of a region on the STFT grid of a signal, or null when it covers no cell. Frame m is centred on
 * (m * hop + size / 2) / sampleRate and bin k on k * sampleRate / size.
 */
export function rasterizeRegionMask(region: SpectralRegion, grid: MaskGrid): RegionMask | null {
  const { sampleRate, size, hop } = grid;
  const half = size / 2;
  const binHz = sampleRate / size;
  const feather = regionFeather(region);
  const pad = feather * 2;
  const pts: readonly SpectralPoint[] = region.points ?? [];
  const xs = Float64Array.from(pts, (p) => p.t);
  const ys = Float64Array.from(pts, (p) => log2hz(p.hz));
  const ctx: CoverageContext = { xs, ys, binHz, wand: regionShape(region) === "wand" && region.wand ? decodeWandBits(region.wand) : null };
  const centre = (m: number) => (m * hop + half) / sampleRate;
  const rawFirst = Math.ceil((region.startTime * sampleRate - half) / hop) - 1;
  const rawLast = Math.floor((region.endTime * sampleRate - half) / hop) + 1;
  const m0 = Math.max(grid.firstFrame, rawFirst - pad);
  const m1 = Math.min(grid.lastFrame, rawLast + pad);
  const k0 = Math.max(0, Math.floor(region.lowHz / binHz) - 1 - pad);
  const k1 = Math.min(half, Math.ceil(region.highHz / binHz) + 1 + pad);
  if (m1 < m0 || k1 < k0) return null;
  const frames = m1 - m0 + 1;
  const bins = k1 - k0 + 1;
  let grid0: Float32Array = new Float32Array(frames * bins);
  const dt = hop / sampleRate / 4;
  const dk = 0.25;
  let any = false;
  for (let f = 0; f < frames; f += 1) {
    const t = centre(m0 + f);
    for (let b = 0; b < bins; b += 1) {
      const hz = (k0 + b) * binHz;
      let hits = 0;
      for (const [ot, ok] of [[-dt, -dk], [dt, -dk], [-dt, dk], [dt, dk]] as const) {
        if (coverage(region, ctx, t + ot, hz + ok * binHz)) hits += 1;
      }
      if (hits) {
        grid0[f * bins + b] = hits / 4;
        any = true;
      }
    }
  }
  if (!any) return null;
  if (feather > 0) {
    const tmp = new Float32Array(grid0.length);
    for (let pass = 0; pass < 2; pass += 1) {
      boxBlur(grid0, tmp, frames, bins, feather, true);
      boxBlur(tmp, grid0, frames, bins, feather, false);
    }
  }
  // Trim to the cells that carry weight.
  let fMin = frames;
  let fMax = -1;
  let bMin = bins;
  let bMax = -1;
  for (let f = 0; f < frames; f += 1) {
    for (let b = 0; b < bins; b += 1) {
      const w = grid0[f * bins + b];
      if (w > 1e-4) {
        if (f < fMin) fMin = f;
        if (f > fMax) fMax = f;
        if (b < bMin) bMin = b;
        if (b > bMax) bMax = b;
      } else grid0[f * bins + b] = 0;
    }
  }
  if (fMax < 0) return null;
  const tf = fMax - fMin + 1;
  const tb = bMax - bMin + 1;
  const weights = new Float32Array(tf * tb);
  for (let f = 0; f < tf; f += 1) for (let b = 0; b < tb; b += 1) weights[f * tb + b] = Math.min(1, grid0[(fMin + f) * bins + bMin + b]);
  grid0 = weights;
  return { mFirst: m0 + fMin, mLast: m0 + fMax, kLo: k0 + bMin, kHi: k0 + bMax, frames: tf, bins: tb, weights };
}

/** Weight of frame m, bin k (0 outside the mask). */
export function maskWeight(mask: RegionMask, m: number, k: number): number {
  if (m < mask.mFirst || m > mask.mLast || k < mask.kLo || k > mask.kHi) return 0;
  return mask.weights[(m - mask.mFirst) * mask.bins + (k - mask.kLo)];
}
