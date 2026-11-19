import type { JobKind, JobResult, JobRunner } from "@openreel/agent";
import type {
  VideoExportSettings,
  AudioExportSettings,
  ExportProgress,
  ExportResult,
} from "@openreel/core/export/types";
import type { Project } from "@openreel/core/types/project";
import {
  DEFAULT_VIDEO_SETTINGS,
  getExportEngine,
  isValidLoudnessTarget,
  setEncoderBackendFactory,
  WebCodecsBackend,
  webCodecsEncoderOptions,
  type LoudnessTargetSettings,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { runStillExport, type StillExportRequest } from "../still-export";
import { runExportJob } from "../export-queue/export-queue-runner";
import { buildVideoExportSettings, type VideoExportRequest } from "./export-options";
import { NativeFFmpegBackend } from "../native-ffmpeg-backend";
import { createMemoryWritable } from "../memory-writable";
import { renderMotionCompositionFrameToDataUrl } from "../../motion/export-motion-frame";

const VIDEO_FORMATS = new Set<VideoExportSettings["format"]>(["mp4", "webm", "mov"]);
const AUDIO_FORMATS = new Set<AudioExportSettings["format"]>(["mp3", "wav", "aac", "flac", "ogg"]);

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

function videoSettings(
  format: string,
  project: Project,
): Partial<VideoExportSettings> {
  const fmt = (VIDEO_FORMATS.has(format as VideoExportSettings["format"])
    ? format
    : "mp4") as VideoExportSettings["format"];
  const codec = fmt === "webm" ? "vp9" : fmt === "mov" ? "h265" : "h264";
  return {
    format: fmt,
    codec,
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
    bitrate: 12000,
    bitrateMode: "vbr",
    quality: 85,
    keyframeInterval: 2,
  };
}

/** Optional "Normalize to target loudness" export parameters from an agent job. */
function loudnessFromParams(params: Record<string, unknown>): LoudnessTargetSettings | undefined {
  if (params.targetLufs === undefined) return undefined;
  const target: LoudnessTargetSettings = {
    enabled: true,
    targetLufs: Number(params.targetLufs),
    truePeakCeilingDb:
      params.truePeakCeilingDb === undefined ? -1 : Number(params.truePeakCeilingDb),
  };
  if (!isValidLoudnessTarget(target)) {
    throw new Error(
      "targetLufs must be -40..-5 and truePeakCeilingDb must be -20..0 (default -1).",
    );
  }
  return target;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Image-sequence / GIF job parameters (already validated by the agent tools) as an engine request. */
export function stillRequestFromParams(kind: "exportImageSequence" | "exportGif", params: Record<string, unknown>): StillExportRequest {
  const range = params.range as { startTime?: unknown; endTime?: unknown } | undefined;
  const span =
    range && typeof range.startTime === "number" && typeof range.endTime === "number"
      ? { startTime: range.startTime, endTime: range.endTime }
      : undefined;
  if (kind === "exportGif") {
    return {
      kind: "gif",
      fps: optionalNumber(params.fps),
      width: optionalNumber(params.width),
      height: optionalNumber(params.height),
      maxColors: optionalNumber(params.maxColors),
      loop: params.loop === "none" ? "none" : optionalNumber(params.loop),
      range: span,
    };
  }
  return {
    kind: "sequence",
    format: params.format === "jpg" ? "jpg" : "png",
    quality: optionalNumber(params.quality),
    width: optionalNumber(params.width),
    height: optionalNumber(params.height),
    range: span,
    pattern: typeof params.pattern === "string" ? params.pattern : undefined,
    startNumber: optionalNumber(params.startNumber),
  };
}

function audioSettings(format: string): Partial<AudioExportSettings> {
  const fmt = (AUDIO_FORMATS.has(format as AudioExportSettings["format"])
    ? format
    : "wav") as AudioExportSettings["format"];
  return { format: fmt, sampleRate: 48000, bitDepth: 16, bitrate: 192000, channels: 2 };
}

async function drainExport(
  gen: AsyncGenerator<ExportProgress, ExportResult>,
): Promise<ExportResult> {
  let step = await gen.next();
  while (!step.done) {
    step = await gen.next();
  }
  return step.value;
}

function sanitizeName(name: string | undefined): string {
  const base = (name ?? "export").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
  return base.slice(0, 60) || "export";
}

function nativeBackendFactory() {
  return new NativeFFmpegBackend(
    () => (window as { __openreelExportPath?: string }).__openreelExportPath ?? "",
  );
}

async function saveExportLocally(
  blob: Blob,
  projectName: string | undefined,
  ext: string,
  contentType: string,
): Promise<JobResult> {
  const bridge = window.openreel?.fs;
  if (!bridge) return { ok: false, error: "Local export storage is unavailable" };
  const filename = `${sanitizeName(projectName)}-${Date.now()}.${ext}`;
  const path = await bridge.tempFilePath(ext, true);
  const handleId = await bridge.openWrite(path);
  const reader = blob.stream().getReader();
  let position = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await bridge.writeChunk(handleId, value, position);
      position += value.byteLength;
    }
    await bridge.closeWrite(handleId);
  } catch (error) {
    await bridge.abortWrite(handleId).catch(() => {});
    throw error;
  }
  return {
    ok: true,
    data: {
      path,
      filename,
      bytes: blob.size,
      format: ext,
      contentType,
      storage: "local",
    },
  };
}

function describeFailure(message: string, code?: string, hint?: string): JobResult {
  return { ok: false, error: message, ...(code ? { code } : {}), ...(hint ? { hint } : {}) };
}

/**
 * After an export wrote its temp file: put it at the agent's `outputPath` (checked against the
 * allowed roots in main) or just measure it, and report size and SHA-256 either way.
 */
export async function deliver(result: JobResult, params: Record<string, unknown>): Promise<JobResult> {
  if (!result.ok) return result;
  const data = (result.data ?? {}) as Record<string, unknown>;
  const tempPath = typeof data.path === "string" ? data.path : undefined;
  const place = window.openreel?.mcp?.placeOutput;
  const outputPath = typeof params.outputPath === "string" ? params.outputPath : undefined;
  if (!tempPath || typeof place !== "function") {
    if (outputPath) {
      return describeFailure(
        tempPath
          ? `The export finished but could not be placed at ${outputPath}: file placement is not available.${" "}The rendered file is still at ${tempPath}.`
          : `The export finished but could not be placed at ${outputPath}: no rendered file was reported.`,
        "UNSUPPORTED",
        "outputPath needs the OpenReel desktop app. Omit outputPath to use the returned path.",
      );
    }
    return result;
  }
  let placed: Awaited<ReturnType<typeof place>> | null = null;
  let placeError: string | undefined;
  try {
    placed = await place({
      from: tempPath,
      ...(outputPath ? { to: outputPath, overwrite: params.overwrite === true, move: true } : {}),
    });
  } catch (error) {
    placeError = error instanceof Error ? error.message : "placing the file failed";
  }
  if (!placed) {
    if (outputPath) {
      return describeFailure(
        `The export finished but could not be placed at ${outputPath}: ${placeError ?? "no response"}. The rendered file is still at ${tempPath}.`,
        "UNREADABLE",
        "Fix the destination (allowed folder, writable, overwrite:true to replace) and export again.",
      );
    }
    return result;
  }
  if (!placed.ok) {
    return describeFailure(
      `The export finished but could not be placed at ${outputPath ?? tempPath}: ${placed.message} The rendered file is still at ${tempPath}.`,
      placed.code,
      "Fix the destination (allowed folder, writable, overwrite:true to replace) and export again.",
    );
  }
  return {
    ok: true,
    data: {
      ...data,
      path: placed.path,
      filename: placed.path.replace(/^.*[\\/]/, ""),
      sizeBytes: placed.sizeBytes,
      sha256: placed.sha256,
      bytes: placed.sizeBytes,
      ...(outputPath ? { storage: "outputPath" } : {}),
    },
  };
}

/** export_video with codec / HDR / size / preset options: same encoder path as the Export dialog's queue. */
async function runExtendedVideoExport(params: Record<string, unknown>): Promise<JobResult> {
  if (typeof window === "undefined" || window.openreel?.platform !== "desktop") {
    return describeFailure("Export options beyond format and loudness need the desktop app.", "UNSUPPORTED", "Run OpenReel desktop, or call export_video with only format and targetLufs.");
  }
  const project = useProjectStore.getState().getFullProject();
  let built: ReturnType<typeof buildVideoExportSettings>;
  try {
    built = buildVideoExportSettings(params as VideoExportRequest, project.settings, project.timeline.duration);
  } catch (error) {
    return describeFailure(error instanceof Error ? error.message : "Invalid export options", "UNSUPPORTED", "Call get_export_options for what this machine supports.");
  }
  const outputName = `${sanitizeName(project.name)}-${Date.now()}.${built.ext}`;
  const result = await runExportJob(
    {
      id: `agent-${Date.now()}`,
      sequenceName: project.name,
      presetLabel: built.presetLabel,
      outputName,
      settings: built.settings,
      usePreviews: false,
      status: "running",
      progress: 0,
      phase: "",
      createdAt: Date.now(),
      elapsedMs: 0,
      attempts: 1,
    },
    project,
    { onProgress: () => undefined, isCancelled: () => false },
  );
  const path = result.output.path;
  if (!path) return describeFailure("The export produced no file on disk.", "UNREADABLE");
  return {
    ok: true,
    data: {
      path,
      filename: outputName,
      bytes: result.output.bytes,
      format: built.settings.format,
      codec: built.settings.codec,
      ...(built.settings.hdr ? { hdr: built.settings.hdr } : {}),
      contentType: VIDEO_MIME[built.settings.format] ?? "application/octet-stream",
      storage: "local",
      ...(result.smartRender ? { smartRender: result.smartRender } : {}),
    },
  };
}

export function createExportJobRunner(): JobRunner {
  return async (kind: JobKind, params: Record<string, unknown>): Promise<JobResult> => {
    try {
      const project = useProjectStore.getState().project;
      const engine = getExportEngine();

      if (kind === "exportVideo" && params.extended === true) {
        return await deliver(await runExtendedVideoExport(params), params);
      }

      if (kind === "exportVideo") {
        const format = typeof params.format === "string" ? params.format : "mp4";
        const ext = VIDEO_FORMATS.has(format as VideoExportSettings["format"]) ? format : "mp4";
        const loudness = loudnessFromParams(params);
        const settings = {
          ...videoSettings(format, project),
          ...(loudness
            ? { audioSettings: { ...DEFAULT_VIDEO_SETTINGS.audioSettings, loudness } }
            : {}),
        };
        const videoCodec = settings.codec === "h265" ? "hevc" : "avc";
        setEncoderBackendFactory((mediabunny) =>
          mediabunny
            ? new WebCodecsBackend(mediabunny, {
                ...webCodecsEncoderOptions(settings.encoderChoice),
                videoCodecs: [videoCodec],
                clampResolution: false,
              })
            : nativeBackendFactory(),
        );
        const sink = createMemoryWritable();
        let result: ExportResult;
        try {
          result = await drainExport(engine.exportVideo(project, settings, sink.writable));
        } finally {
          setEncoderBackendFactory(() => nativeBackendFactory());
        }
        if (!result.success) {
          return { ok: false, error: result.error?.message ?? "Video export failed" };
        }
        const contentType = VIDEO_MIME[ext];
        const blob = result.blob ?? sink.getBlob(contentType);
        if (blob.size === 0) {
          return { ok: false, error: "Video export produced no data" };
        }
        return await deliver(await saveExportLocally(blob, project.name, ext, blob.type || contentType), params);
      }

      if (kind === "exportImageSequence" || kind === "exportGif") {
        const request = stillRequestFromParams(kind, params);
        const outcome = await runStillExport(project, request);
        if (!outcome.ok) return { ok: false, error: outcome.message };
        const saved = await saveExportLocally(outcome.output.blob, project.name, outcome.output.ext, outcome.output.contentType);
        const delivered = await deliver(saved, params);
        if (!delivered.ok) return delivered;
        return {
          ok: true,
          data: {
            ...((delivered.data ?? {}) as Record<string, unknown>),
            frames: outcome.output.frames,
            format: request.kind === "gif" ? "gif" : request.format ?? "png",
          },
        };
      }

      if (kind === "exportAudio") {
        const format = typeof params.format === "string" ? params.format : "wav";
        const loudness = loudnessFromParams(params);
        const result = await drainExport(
          engine.exportAudio(project, { ...audioSettings(format), ...(loudness ? { loudness } : {}) }),
        );
        if (!result.success || !result.blob) {
          return { ok: false, error: result.error?.message ?? "Audio export failed" };
        }
        const ext = (AUDIO_FORMATS.has(format as AudioExportSettings["format"]) ? format : "wav");
        return await saveExportLocally(result.blob, project.name, ext, result.blob.type || AUDIO_MIME[ext]);
      }

      if (kind === "exportFrame") {
        const compositionId =
          typeof params.compositionId === "string" ? params.compositionId : "";
        if (!compositionId) {
          return { ok: false, error: "exportFrame requires a compositionId" };
        }
        const composition = (project.motionCompositions ?? []).find(
          (candidate) => candidate.id === compositionId,
        );
        if (!composition) {
          return {
            ok: false,
            error: `Motion composition not found: ${compositionId}`,
          };
        }
        const timeSeconds =
          typeof params.timeSeconds === "number" && Number.isFinite(params.timeSeconds)
            ? params.timeSeconds
            : 0;
        const scale =
          typeof params.scale === "number" && Number.isFinite(params.scale)
            ? params.scale
            : undefined;
        const frame = await renderMotionCompositionFrameToDataUrl({
          composition,
          time: timeSeconds,
          compositionLibrary: project.motionCompositions ?? [composition],
          mediaItems: project.mediaLibrary.items,
          creation: project.creation,
          scale,
        });
        return {
          ok: true,
          data: {
            dataUrl: frame.dataUrl,
            width: frame.width,
            height: frame.height,
          },
        };
      }

      return { ok: false, error: `Job '${kind}' is not supported by the export runner` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
