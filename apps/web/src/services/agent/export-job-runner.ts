import type { JobKind, JobResult, JobRunner } from "@openreel/agent";
import type {
  VideoExportSettings,
  AudioExportSettings,
  ExportProgress,
  ExportResult,
} from "@openreel/core/export/types";
import type { Project } from "@openreel/core/types/project";
import { getExportEngine, setEncoderBackendFactory, WebCodecsBackend } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { NativeFFmpegBackend } from "../native-ffmpeg-backend";
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

function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  throw new Error("Unsupported chunk type written to export stream");
}

interface MemoryWritable {
  readonly writable: FileSystemWritableFileStream;
  getBlob(type: string): Blob;
}

function createMemoryWritable(): MemoryWritable {
  const parts: Array<{ pos: number; data: Uint8Array }> = [];
  let position = 0;
  let size = 0;

  const writeChunk = (u8: Uint8Array): void => {
    parts.push({ pos: position, data: u8 });
    position += u8.byteLength;
    if (position > size) size = position;
  };

  const sink = {
    async seek(pos: number): Promise<void> {
      position = pos;
    },
    async truncate(next: number): Promise<void> {
      size = next;
    },
    async close(): Promise<void> {},
    async abort(): Promise<void> {},
    async write(chunk: unknown): Promise<void> {
      if (chunk && typeof chunk === "object" && "type" in chunk) {
        const cmd = chunk as { type: string; data?: unknown; position?: number; size?: number };
        if (cmd.type === "seek") {
          if (typeof cmd.position === "number") position = cmd.position;
          return;
        }
        if (cmd.type === "truncate") {
          if (typeof cmd.size === "number") size = cmd.size;
          return;
        }
        if (cmd.type === "write") {
          if (typeof cmd.position === "number") position = cmd.position;
          writeChunk(toUint8(cmd.data));
          return;
        }
      }
      writeChunk(toUint8(chunk));
    },
  };

  return {
    writable: sink as unknown as FileSystemWritableFileStream,
    getBlob(type: string): Blob {
      const buffer = new Uint8Array(size);
      for (const part of parts) buffer.set(part.data, part.pos);
      return new Blob([buffer], { type });
    },
  };
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

async function uploadExport(
  blob: Blob,
  projectName: string | undefined,
  ext: string,
  contentType: string,
): Promise<JobResult> {
  const bridge = window.openreel?.gpu?.uploadExport;
  if (typeof bridge !== "function") {
    return { ok: false, error: "Export upload is only available in the desktop app" };
  }
  const filename = `${sanitizeName(projectName)}-${Date.now()}.${ext}`;
  const bytes = await blob.arrayBuffer();
  const { mediaKey, downloadUrl } = await bridge({ bytes, filename, contentType });
  if (!downloadUrl) {
    return {
      ok: false,
      error: `Export uploaded (key ${mediaKey}) but the broker returned no download URL`,
    };
  }
  return {
    ok: true,
    data: {
      url: downloadUrl,
      mediaKey,
      filename,
      bytes: blob.size,
      format: ext,
      contentType,
      expiresInSec: 900,
    },
  };
}

export function createExportJobRunner(): JobRunner {
  return async (kind: JobKind, params: Record<string, unknown>): Promise<JobResult> => {
    try {
      const project = useProjectStore.getState().project;
      const engine = getExportEngine();

      if (kind === "exportVideo") {
        const format = typeof params.format === "string" ? params.format : "mp4";
        const ext = VIDEO_FORMATS.has(format as VideoExportSettings["format"]) ? format : "mp4";
        const settings = videoSettings(format, project);
        const videoCodec = settings.codec === "h265" ? "hevc" : "avc";
        setEncoderBackendFactory((mediabunny) =>
          mediabunny
            ? new WebCodecsBackend(mediabunny, {
                hardwareAcceleration: "prefer-hardware",
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
        return await uploadExport(blob, project.name, ext, blob.type || contentType);
      }

      if (kind === "exportAudio") {
        const format = typeof params.format === "string" ? params.format : "wav";
        const result = await drainExport(engine.exportAudio(project, audioSettings(format)));
        if (!result.success || !result.blob) {
          return { ok: false, error: result.error?.message ?? "Audio export failed" };
        }
        const ext = (AUDIO_FORMATS.has(format as AudioExportSettings["format"]) ? format : "wav");
        return await uploadExport(result.blob, project.name, ext, result.blob.type || AUDIO_MIME[ext]);
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
