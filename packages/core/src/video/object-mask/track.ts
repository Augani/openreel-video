import type { BezierPath, BezierPoint } from "../mask-engine";
import { computeFlowPair } from "../time-interpolation/optical-flow-cpu";
import { flowParamsFor } from "../time-interpolation/types";
import { DEFAULT_PATH_POINTS, maskToPath, rasterizePath } from "./contour";
import { downscaleRgba, growMask, maskArea, maskIoU } from "./raster-ops";
import type { ObjectSegmenter, RGBAFrame } from "./types";

export interface ObjectTrackFrame {
  readonly frame: number;
  /** Outline of the object at this frame, normalised to the frame (0..1). */
  readonly path: BezierPath;
  /** 0..1 agreement between the motion-predicted shape and the re-segmented one. */
  readonly confidence: number;
  /** The tracker could not find the object; the path is the motion-predicted shape. */
  readonly lost: boolean;
}

export interface ObjectTrackOptions {
  readonly segmenter: ObjectSegmenter;
  /** Frame `n` of the footage (any size, the tracker scales it), or null past the end. */
  readFrame(frame: number): Promise<RGBAFrame | null>;
  readonly anchorFrame: number;
  /** The mask at the anchor frame, normalised to the frame: the user's click result, possibly hand edited. */
  readonly anchorPath: BezierPath;
  readonly direction: "forward" | "backward";
  /** Last frame to track (inclusive). */
  readonly endFrame: number;
  /** The tracker works on frames whose long side is at most this. */
  readonly maxDim?: number;
  readonly pathPoints?: number;
  /** Below this agreement the object counts as lost for that frame. */
  readonly lostBelow?: number;
  readonly signal?: AbortSignal;
  onProgress?(percent: number, lostFrames: number): void;
}

const LOST_BELOW = 0.4;

/** The (dx, dy) the object moved between two frames: median flow on the shape's boundary ring, robust to texture-less insides. */
function objectMotion(mask: Uint8Array, flow: { width: number; height: number; ba: Float32Array; confBA: Float32Array }): { x: number; y: number } {
  const { width, height } = flow;
  const outer = growMask(mask, width, height, 3);
  const inner = growMask(mask, width, height, -3);
  const xs: number[] = [];
  const ys: number[] = [];
  const collect = (accept: (i: number) => boolean): void => {
    for (let i = 0; i < width * height; i++) {
      if (accept(i) && flow.confBA[i] >= 0.5) {
        xs.push(-flow.ba[i * 2]);
        ys.push(-flow.ba[i * 2 + 1]);
      }
    }
  };
  collect((i) => outer[i] > 0 && inner[i] === 0);
  if (xs.length < 8) collect((i) => mask[i] > 0);
  if (xs.length < 8) return { x: 0, y: 0 };
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  return { x: xs[xs.length >> 1], y: ys[ys.length >> 1] };
}

/** Where the previous shape should be in the current frame: per-pixel flow where it agrees with the object's motion, the object's motion elsewhere. */
export function predictMask(prevMask: Uint8Array, prev: RGBAFrame, cur: RGBAFrame): { mask: Uint8Array; motion: { x: number; y: number } } {
  const { width, height } = cur;
  const flow = computeFlowPair(prev, cur, flowParamsFor("medium"));
  const factor = flow.factor;
  const motion = objectMotion(prevMask, { width: flow.width, height: flow.height, ba: flow.ba, confBA: flow.confBA });
  const motionPx = { x: motion.x * factor, y: motion.y * factor };
  const tolerance = Math.max(1.5, 0.5 * Math.hypot(motionPx.x, motionPx.y));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = Math.min(flow.width - 1, Math.floor(x / factor));
      const fy = Math.min(flow.height - 1, Math.floor(y / factor));
      const fi = fy * flow.width + fx;
      let bx = flow.ba[fi * 2] * factor;
      let by = flow.ba[fi * 2 + 1] * factor;
      if (flow.confBA[fi] < 0.4 || Math.hypot(bx + motionPx.x, by + motionPx.y) > tolerance) {
        bx = -motionPx.x;
        by = -motionPx.y;
      }
      const sx = Math.min(width - 1, Math.max(0, Math.round(x + bx)));
      const sy = Math.min(height - 1, Math.max(0, Math.round(y + by)));
      out[y * width + x] = prevMask[sy * width + sx];
    }
  }
  return { mask: out, motion: motionPx };
}

export interface ObjectMaskTrackerConfig {
  readonly segmenter: ObjectSegmenter;
  /** The footage at the anchor frame. */
  readonly anchorImage: RGBAFrame;
  /** The mask at the anchor frame, normalised to the frame: the user's click result, possibly hand edited. */
  readonly anchorPath: BezierPath;
  /** The tracker works on frames whose long side is at most this. */
  readonly maxDim?: number;
  readonly pathPoints?: number;
  /** Below this agreement the object counts as lost for that frame. */
  readonly lostBelow?: number;
}

/**
 * Frame by frame object tracking: each `step` takes the next frame in either direction. The previous shape is
 * carried to the new frame with optical flow, then the segmenter re-cuts the object inside a narrow band around
 * that prediction, so the outline follows deformation and does not drift. It is a class so a worker can hold
 * the state while the page decodes the footage.
 */
export class ObjectMaskTracker {
  private prev: RGBAFrame;
  private prevMask: Uint8Array;
  private reference: BezierPoint[] | undefined;
  private lastPath: BezierPath;
  private readonly count: number;
  private readonly maxDim: number;
  private readonly lostBelow: number;
  private readonly segmenter: ObjectSegmenter;

  constructor(config: ObjectMaskTrackerConfig) {
    this.segmenter = config.segmenter;
    this.count = config.pathPoints ?? DEFAULT_PATH_POINTS;
    this.maxDim = config.maxDim ?? 160;
    this.lostBelow = config.lostBelow ?? LOST_BELOW;
    this.prev = downscaleRgba(config.anchorImage, this.maxDim);
    this.prevMask = rasterizePath(config.anchorPath, this.prev.width, this.prev.height);
    if (maskArea(this.prevMask) < 4) throw new Error("The mask at the anchor frame is empty");
    this.lastPath = config.anchorPath;
    this.reference = config.anchorPath.points.length === this.count ? config.anchorPath.points : undefined;
  }

  async step(frame: number, raw: RGBAFrame): Promise<ObjectTrackFrame> {
    const cur = downscaleRgba(raw, this.maxDim);
    if (cur.width !== this.prev.width || cur.height !== this.prev.height) throw new Error("The footage changed size while tracking");
    const predicted = predictMask(this.prevMask, this.prev, cur);
    const segmented = await this.segmenter.segment(cur, { prior: predicted.mask, band: Math.max(3, Math.hypot(predicted.motion.x, predicted.motion.y) * 2.2) });
    const area = maskArea(segmented.mask);
    const predictedArea = maskArea(predicted.mask);
    const ratio = predictedArea > 0 ? area / predictedArea : 0;
    const agreement = area > 0 ? maskIoU(predicted.mask, segmented.mask) : 0;
    const lost = area < 4 || ratio < 0.4 || ratio > 2.5 || agreement < this.lostBelow;
    const mask = lost ? predicted.mask : segmented.mask;
    const path = maskToPath(mask, cur.width, cur.height, { points: this.count, reference: this.reference }) ?? this.lastPath;
    this.prev = cur;
    this.prevMask = mask;
    this.reference = path.points;
    this.lastPath = path;
    return { frame, path, confidence: lost ? 0 : agreement, lost };
  }
}

/** Track an object mask through the footage from the anchor frame to `endFrame`, one editable path per frame. */
export async function trackObjectMask(options: ObjectTrackOptions): Promise<ObjectTrackFrame[]> {
  const step = options.direction === "forward" ? 1 : -1;
  const first = await options.readFrame(options.anchorFrame);
  if (!first) throw new Error("The anchor frame could not be read");
  const tracker = new ObjectMaskTracker({
    segmenter: options.segmenter,
    anchorImage: first,
    anchorPath: options.anchorPath,
    maxDim: options.maxDim,
    pathPoints: options.pathPoints,
    lostBelow: options.lostBelow,
  });
  const out: ObjectTrackFrame[] = [{ frame: options.anchorFrame, path: options.anchorPath, confidence: 1, lost: false }];
  const span = Math.max(1, Math.abs(options.endFrame - options.anchorFrame));
  let lostCount = 0;
  for (let frame = options.anchorFrame + step; step > 0 ? frame <= options.endFrame : frame >= options.endFrame; frame += step) {
    if (options.signal?.aborted) throw new DOMException("Tracking cancelled", "AbortError");
    const raw = await options.readFrame(frame);
    if (!raw) break;
    const result = await tracker.step(frame, raw);
    if (result.lost) lostCount++;
    out.push(result);
    options.onProgress?.((Math.abs(frame - options.anchorFrame) / span) * 100, lostCount);
  }
  return out;
}
