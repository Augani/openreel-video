import { frameAt, sourceOf, type WarpPlan } from "./plan";

/**
 * Reference implementation of the stabilizing warp on raw pixels. The canvas renderer (`render-canvas.ts`) draws
 * the same per-row matrices; this one is what the unit tests measure and what defines the framing semantics:
 * Stabilize Only leaves the borders empty, Stabilize Crop empties everything outside the crop rectangle,
 * Auto-scale zooms (already in the matrices) and Synthesize Edges fills the empty borders from neighbouring frames.
 */
export interface RasterFrame {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Float32Array | Uint8ClampedArray | Uint8Array;
}

export interface WarpedRaster {
  readonly frame: RasterFrame;
  /** 1 where the picture has content, 0 where it is empty (outside the source, or cropped away). */
  readonly coverage: Uint8Array;
}

export interface NeighbourFrame {
  /** The neighbour's frame index in the plan's analysed frames. */
  readonly index: number;
  readonly frame: RasterFrame;
}

function bilinear(frame: RasterFrame, x: number, y: number, out: Float32Array): void {
  const { width: w, height: h, channels: c, data } = frame;
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let k = 0; k < c; k++) {
    const a = data[(y0 * w + x0) * c + k] * (1 - tx) + data[(y0 * w + x1) * c + k] * tx;
    const b = data[(y1 * w + x0) * c + k] * (1 - tx) + data[(y1 * w + x1) * c + k] * tx;
    out[k] = a * (1 - ty) + b * ty;
  }
}

export function warpFrameCpu(
  src: RasterFrame,
  plan: WarpPlan,
  frame: number,
  neighbours: readonly NeighbourFrame[] = [],
): WarpedRaster {
  const { width: w, height: h, channels } = src;
  const out = new Float32Array(w * h * channels);
  const coverage = new Uint8Array(w * h);
  const pixel = new Float32Array(channels);
  const synthesize = plan.settings.framing === "synthesizeEdges";
  // nearest neighbours last, so they win over farther ones
  const ordered = synthesize ? [...neighbours].sort((a, b) => Math.abs(b.index - frame) - Math.abs(a.index - frame)) : [];
  const half = plan.cropFraction < 1 ? plan.cropFraction : 1;
  const x0 = (w * (1 - half)) / 2;
  const x1 = w - x0;
  const y0 = (h * (1 - half)) / 2;
  const y1 = h - y0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (half < 1 && (px < x0 || px > x1 || py < y0 || py > y1)) continue;
      let from: [number, number] | null = sourceOf(plan, frame, frame, px, py, w, h, plan.zoom);
      let fromFrame: RasterFrame = src;
      if (!from || from[0] < 0 || from[0] > w || from[1] < 0 || from[1] > h) {
        from = null;
        for (let n = ordered.length - 1; n >= 0; n--) {
          const candidate = sourceOf(plan, frame, ordered[n].index, px, py, w, h, plan.zoom);
          if (candidate && candidate[0] >= 0 && candidate[0] <= w && candidate[1] >= 0 && candidate[1] <= h) {
            from = candidate;
            fromFrame = ordered[n].frame;
            break;
          }
        }
        if (!from) continue;
      }
      bilinear(fromFrame, from[0], from[1], pixel);
      const o = (y * w + x) * channels;
      for (let k = 0; k < channels; k++) out[o + k] = pixel[k];
      coverage[y * w + x] = 1;
    }
  }
  return { frame: { width: w, height: h, channels, data: out }, coverage };
}

/** Spacing, in analysed frames, of the anchor frames Synthesize Edges borrows from (adjacent frames share them). */
export const SYNTHESIS_GRID = 8;
export const SYNTHESIS_REACH = 3;

/**
 * The frames Synthesize Edges borrows from for `frame`: anchors on a fixed grid around it, so consecutive frames
 * reuse the same decoded neighbours. Never the frame itself.
 */
export function neighbourIndices(plan: WarpPlan, frame: number): number[] {
  const grid = Math.max(2, Math.round(SYNTHESIS_GRID * (plan.fps / 30)));
  const centre = Math.round(frame);
  const anchor = Math.round(centre / grid) * grid;
  const out: number[] = [];
  for (let k = -SYNTHESIS_REACH; k <= SYNTHESIS_REACH; k++) {
    const index = anchor + k * grid;
    if (index < 0 || index > plan.frameCount - 1 || index === centre) continue;
    out.push(index);
  }
  return out;
}

export { frameAt };
