import { analyzeSequence, WarpAnalysisCancelled } from "./analysis";
import type { GrayFrame } from "./motion-estimate";
import type { WarpAnalysis } from "./types";

export interface AnalysisRequest {
  readonly blob: Blob;
  /** Source time range to analyse (the clip's in and out points). */
  readonly startTime: number;
  readonly endTime: number;
}

/** Picture width the motion is measured at: enough texture for sub-pixel motion, small enough to be quick. */
export const ANALYSIS_WIDTH = 384;
const TARGET_FPS = 30;
const MAX_FRAMES = 9000;

export function analysisFrameRate(duration: number): number {
  return Math.max(1, Math.min(TARGET_FPS, MAX_FRAMES / Math.max(duration, 1 / TARGET_FPS)));
}

function toGray(data: Uint8ClampedArray, width: number, height: number): GrayFrame {
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) / 255;
  return { width, height, data: out };
}

/**
 * Decode `request`'s range with MediaBunny and measure it. Runs in the analysis worker (and inline where there is
 * no Worker), so nothing here touches the DOM.
 */
export async function runAnalysisJob(
  request: AnalysisRequest,
  hooks: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<WarpAnalysis> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(request.blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This file has no video to stabilize");
  const duration = Math.max(0, request.endTime - request.startTime);
  if (duration <= 0) throw new Error("Stabilizer analysis needs a clip with a duration");
  const fps = analysisFrameRate(duration);
  const count = Math.max(2, Math.floor(duration * fps) + 1);
  const sink = new CanvasSink(track, { width: ANALYSIS_WIDTH, fit: "fill" });
  const timestamps = (function* () {
    for (let i = 0; i < count; i++) yield Math.min(request.startTime + i / fps, request.endTime - 1e-3);
  })();
  let width = 0;
  let height = 0;
  const grays = (async function* (): AsyncGenerator<GrayFrame> {
    let canvas2d: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
    let scratch: OffscreenCanvas | null = null;
    let last: GrayFrame | null = null;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (hooks.signal?.aborted) throw new WarpAnalysisCancelled();
      if (!wrapped) {
        // no frame at that time (past the end): keep the sequence going with the last one
        if (last) yield last;
        continue;
      }
      const source = wrapped.canvas;
      if (!scratch || scratch.width !== source.width || scratch.height !== source.height) {
        scratch = new OffscreenCanvas(source.width, source.height);
        canvas2d = scratch.getContext("2d", { willReadFrequently: true });
      }
      if (!canvas2d) throw new Error("Canvas is not available for stabilizer analysis");
      canvas2d.drawImage(source as CanvasImageSource, 0, 0);
      const pixels = canvas2d.getImageData(0, 0, source.width, source.height);
      width = source.width;
      height = source.height;
      last = toGray(pixels.data, source.width, source.height);
      yield last;
    }
  })();
  try {
    const analysis = await analyzeSequence(grays, { fps, startTime: request.startTime, width: ANALYSIS_WIDTH, height: 0 }, {
      expectedCount: count,
      onProgress: hooks.onProgress,
      signal: hooks.signal,
    });
    return { ...analysis, width, height };
  } finally {
    (input as unknown as { dispose?: () => void }).dispose?.();
  }
}
