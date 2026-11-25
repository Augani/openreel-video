import { estimateFrameMotion, buildPyramid, type GrayFrame, type FrameMotion } from "./motion-estimate";
import { FRAME_STRIDE, WARP_ANALYSIS_VERSION, type WarpAnalysis } from "./types";

export interface AnalysisMeta {
  readonly fps: number;
  readonly startTime: number;
  readonly width: number;
  readonly height: number;
}

export class WarpAnalysisCancelled extends Error {
  constructor() {
    super("Stabilizer analysis cancelled");
    this.name = "AbortError";
  }
}

const round = (value: number): number => Math.round(value * 1e4) / 1e4;

/**
 * Measure the camera motion across a sequence of analysis frames (in order, at `meta.fps`). Pure: callers feed
 * decoded grey frames (the worker) or synthetic ones (tests). `expectedCount` only scales the progress.
 */
export async function analyzeSequence(
  frames: AsyncIterable<GrayFrame> | Iterable<GrayFrame>,
  meta: AnalysisMeta,
  hooks: { expectedCount?: number; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<WarpAnalysis> {
  const motion: number[] = new Array(FRAME_STRIDE).fill(0);
  let count = 0;
  let confidenceSum = 0;
  let prev: GrayFrame[] | null = null;
  for await (const frame of frames as AsyncIterable<GrayFrame>) {
    if (hooks.signal?.aborted) throw new WarpAnalysisCancelled();
    const pyramid = buildPyramid(frame);
    if (prev) {
      const m: FrameMotion = estimateFrameMotion(prev, pyramid);
      motion.push(round(m.dx), round(m.dy), round(m.rotation), round(m.logScale), round(m.px), round(m.py), round(m.shearX), round(m.shearY));
      confidenceSum += m.confidence;
    }
    prev = pyramid;
    count++;
    if (hooks.expectedCount) hooks.onProgress?.(Math.min(1, count / hooks.expectedCount));
  }
  if (hooks.signal?.aborted) throw new WarpAnalysisCancelled();
  if (count < 2) throw new Error("Stabilizer analysis needs at least two frames");
  return {
    version: WARP_ANALYSIS_VERSION,
    fps: meta.fps,
    startTime: meta.startTime,
    frameCount: count,
    width: meta.width,
    height: meta.height,
    motion,
    confidence: confidenceSum / (count - 1),
  };
}
