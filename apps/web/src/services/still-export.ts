import { getExportEngine, type ExportProgress, type ExportResult, type SequenceImageFormat } from "@openreel/core";
import type { Project } from "@openreel/core/types/project";

/**
 * Image-sequence (PNG / JPEG zip) and animated-GIF delivery. One entry point shared by the Export dialog
 * and the agent export jobs, so both reach the same engine paths with the same options.
 */

export interface ImageSequenceRequest {
  kind: "sequence";
  format?: SequenceImageFormat;
  /** JPEG quality 1..100 (ignored for PNG). */
  quality?: number;
  width?: number;
  height?: number;
  /** Timeline seconds, Out exclusive. Omit for the whole timeline. */
  range?: { startTime: number; endTime: number };
  /** `frame_{0000}`: the braces' zero count sets the padding. */
  pattern?: string;
  startNumber?: number;
}

export interface GifRequest {
  kind: "gif";
  fps?: number;
  width?: number;
  height?: number;
  /** Palette size 2..256. */
  maxColors?: number;
  /** 0 = forever, n = n times, "none" = play once. */
  loop?: number | "none";
  range?: { startTime: number; endTime: number };
}

export type StillExportRequest = ImageSequenceRequest | GifRequest;

export interface StillExportOutput {
  readonly blob: Blob;
  readonly ext: "zip" | "gif";
  readonly contentType: string;
  readonly frames: number;
}

export type StillExportOutcome =
  | { readonly ok: true; readonly output: StillExportOutput }
  | { readonly ok: false; readonly message: string; readonly cancelled?: boolean };

/** Run the export to completion. `cancel()` on the shared engine (see {@link cancelStillExport}) stops it at the next frame. */
export async function runStillExport(
  project: Project,
  request: StillExportRequest,
  onProgress?: (progress: ExportProgress) => void,
): Promise<StillExportOutcome> {
  const engine = getExportEngine();
  try {
    await engine.initialize();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The export engine could not start." };
  }
  const generator: AsyncGenerator<ExportProgress, ExportResult> =
    request.kind === "gif"
      ? engine.exportGif(project, {
          fps: request.fps,
          width: request.width,
          height: request.height,
          maxColors: request.maxColors,
          loop: request.loop,
          range: request.range,
        })
      : engine.exportImageSequenceZip(project, {
          format: request.format,
          quality: request.quality,
          width: request.width,
          height: request.height,
          range: request.range,
          pattern: request.pattern,
          startNumber: request.startNumber,
        });
  let step = await generator.next();
  let frames = 0;
  while (!step.done) {
    frames = step.value.totalFrames ?? frames;
    onProgress?.(step.value);
    step = await generator.next();
  }
  const result = step.value;
  if (!result.success || !result.blob) {
    return {
      ok: false,
      message: result.error?.message ?? "The export failed.",
      ...(result.error?.code === "CANCELLED" ? { cancelled: true } : {}),
    };
  }
  return {
    ok: true,
    output: {
      blob: result.blob,
      ext: request.kind === "gif" ? "gif" : "zip",
      contentType: request.kind === "gif" ? "image/gif" : "application/zip",
      frames: result.stats?.framesRendered ?? frames,
    },
  };
}

export function cancelStillExport(): void {
  getExportEngine().cancel();
}

export function stillExportFilename(projectName: string, request: StillExportRequest): string {
  const base = (projectName || "export").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "export";
  return request.kind === "gif" ? `${base}.gif` : `${base}-${request.format === "jpg" ? "jpg" : "png"}-sequence.zip`;
}
