import { buildPyramid, estimateFrameMotion, type FrameMotion, type GrayFrame } from "../stabilization/warp/motion-estimate";
import type { RGBAFrame } from "../time-interpolation/frame-blend";

/**
 * Temporal propagation: the background a moving object (or a moving camera) hides in one frame is very often
 * visible in another. Each neighbouring frame is aligned to the target with the global motion estimator the
 * Warp Stabilizer uses (direct, robust to moving subjects), and every hole pixel is taken from the nearest frames
 * that see the same background there outside their own hole.
 */

export interface TemporalFrame {
  readonly frame: RGBAFrame;
  /** 1 = not trustworthy in this frame (the removed object, grown). */
  readonly hole: Uint8Array;
  /** Pyramid of the luma, built once per frame and reused by every pair it is in. */
  pyramid?: GrayFrame[];
}

export function lumaOf(frame: RGBAFrame): GrayFrame {
  const n = frame.width * frame.height;
  const data = new Float32Array(n);
  const px = frame.data;
  for (let i = 0; i < n; i++) data[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  return { width: frame.width, height: frame.height, data };
}

export function pyramidOf(entry: TemporalFrame): GrayFrame[] {
  entry.pyramid ??= buildPyramid(lumaOf(entry.frame));
  return entry.pyramid;
}

export type PointMap = (x: number, y: number, out: { x: number; y: number }) => void;

function mapFromMotion(motion: FrameMotion, width: number, height: number): PointMap {
  const halfW = width / 2;
  const cx = width / 2 - 0.5;
  const cy = height / 2 - 0.5;
  const a = Math.exp(motion.logScale);
  const c = a * Math.cos(motion.rotation);
  const s = a * Math.sin(motion.rotation);
  return (x, y, out) => {
    const xc = x - cx;
    const yc = y - cy;
    const den = 1 + (motion.px * xc + motion.py * yc) / halfW;
    out.x = (c * xc - s * yc + motion.dx) / den + cx;
    out.y = (s * xc + c * yc + motion.dy) / den + cy;
  };
}

/** Where a pixel of `from` is in `to` (adjacent frames: the motion is small, so the estimate is reliable). */
export function alignmentBetween(from: TemporalFrame, to: TemporalFrame): PointMap {
  const motion = estimateFrameMotion(pyramidOf(from), pyramidOf(to), { shear: false });
  return mapFromMotion(motion, from.frame.width, from.frame.height);
}

/** The maps one after the other: the picture of the first frame carried to the last one. */
export function chainMaps(maps: readonly PointMap[]): PointMap {
  return (x, y, out) => {
    out.x = x;
    out.y = y;
    for (const map of maps) map(out.x, out.y, out);
  };
}

export interface TemporalFillOptions {
  /** Frame offsets to look at, nearest first. */
  readonly offsets: readonly number[];
  /** Candidates per pixel (the median of them is used). */
  readonly candidates?: number;
}

export interface TemporalFillResult {
  /** The target frame with every pixel that other frames could supply replaced. */
  readonly data: Uint8ClampedArray;
  /** 1 where a pixel was supplied by other frames. */
  readonly resolved: Uint8Array;
}

export const DEFAULT_OFFSETS: readonly number[] = [1, -1, 2, -2, 4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 24, -24, 32, -32];

function median(values: number[], count: number): number {
  const part = values.slice(0, count).sort((p, q) => p - q);
  return count % 2 ? part[count >> 1] : (part[count / 2 - 1] + part[count / 2]) / 2;
}

/**
 * `fillArea` is the part of the target to supply (usually its hole). `neighbourAt(offset)` returns the neighbour at
 * that offset from the target with the map from target pixels to neighbour pixels, or null when it does not exist.
 */
export function temporalFill(
  target: TemporalFrame,
  fillArea: Uint8Array,
  neighbourAt: (offset: number) => { frame: TemporalFrame; align: PointMap } | null,
  options: TemporalFillOptions,
): TemporalFillResult {
  const { width, height } = target.frame;
  const wanted = options.candidates ?? 5;
  const data = new Uint8ClampedArray(target.frame.data);
  const resolved = new Uint8Array(width * height);
  const pending: number[] = [];
  for (let i = 0; i < fillArea.length; i++) if (fillArea[i]) pending.push(i);
  if (pending.length === 0) return { data, resolved };

  const found = new Uint8Array(width * height);
  const samples = new Float32Array(pending.length * wanted * 3);
  const point = { x: 0, y: 0 };
  let satisfied = 0;

  for (const offset of options.offsets) {
    if (satisfied === pending.length) break;
    const found_ = neighbourAt(offset);
    if (!found_ || found_.frame.frame.width !== width || found_.frame.frame.height !== height) continue;
    const align = found_.align;
    const src = found_.frame.frame.data;
    const hole = found_.frame.hole;
    for (let p = 0; p < pending.length; p++) {
      const i = pending[p];
      if (found[i] >= wanted) continue;
      align(i % width, (i / width) | 0, point);
      const x0 = Math.floor(point.x);
      const y0 = Math.floor(point.y);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) continue;
      const i00 = y0 * width + x0;
      if (hole[i00] || hole[i00 + 1] || hole[i00 + width] || hole[i00 + width + 1]) continue;
      const fx = point.x - x0;
      const fy = point.y - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const slot = (p * wanted + found[i]) * 3;
      for (let c = 0; c < 3; c++) {
        samples[slot + c] = src[i00 * 4 + c] * w00 + src[(i00 + 1) * 4 + c] * w10 + src[(i00 + width) * 4 + c] * w01 + src[(i00 + width + 1) * 4 + c] * w11;
      }
      found[i]++;
      if (found[i] === wanted) satisfied++;
    }
  }

  const column: number[] = new Array(wanted).fill(0);
  for (let p = 0; p < pending.length; p++) {
    const i = pending[p];
    const n = found[i];
    if (n === 0) continue;
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < n; k++) column[k] = samples[(p * wanted + k) * 3 + c];
      data[i * 4 + c] = Math.round(median(column, n));
    }
    data[i * 4 + 3] = 255;
    resolved[i] = 1;
  }
  return { data, resolved };
}

/**
 * A chain of frame-to-frame motions drifts a little with every link. Rectifying the neighbour with the chain leaves
 * only a small residual against the target, which the estimator finds reliably; the result is the chain followed by
 * that correction. Pixels the chain sends outside the frame, and pixels in either frame's hole, take the target's
 * own value in the rectified image so they do not vote.
 */
export function refineAlignment(target: TemporalFrame, neighbour: TemporalFrame, chain: PointMap): PointMap {
  const { width, height } = target.frame;
  const targetLuma = pyramidOf(target)[0];
  const neighbourLuma = lumaOf(neighbour.frame);
  const rectified = new Float32Array(width * height);
  const point = { x: 0, y: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      chain(x, y, point);
      const x0 = Math.floor(point.x);
      const y0 = Math.floor(point.y);
      const own = targetLuma.data[i];
      if (target.hole[i] || x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) {
        rectified[i] = own;
        continue;
      }
      const j = y0 * width + x0;
      if (neighbour.hole[j] || neighbour.hole[j + 1] || neighbour.hole[j + width] || neighbour.hole[j + width + 1]) {
        rectified[i] = own;
        continue;
      }
      const fx = point.x - x0;
      const fy = point.y - y0;
      const d = neighbourLuma.data;
      rectified[i] = (d[j] * (1 - fx) + d[j + 1] * fx) * (1 - fy) + (d[j + width] * (1 - fx) + d[j + width + 1] * fx) * fy;
    }
  }
  const motion = estimateFrameMotion(pyramidOf(target), buildPyramid({ width, height, data: rectified }), { shear: false });
  const residual = mapFromMotion(motion, width, height);
  return (x, y, out) => {
    residual(x, y, out);
    chain(out.x, out.y, out);
  };
}
