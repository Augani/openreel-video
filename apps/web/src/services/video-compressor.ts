import {
  getMediaEngine,
  type CompressionPlan,
  type CompressionSource,
} from "@openreel/core";

export async function probeCompressionSource(
  file: File | Blob,
  signal?: AbortSignal,
): Promise<CompressionSource | null> {
  signal?.throwIfAborted();
  const engine = getMediaEngine();
  await engine.initialize();
  signal?.throwIfAborted();
  const meta = await engine.extractMetadata(file);
  signal?.throwIfAborted();
  if (
    !meta ||
    !meta.hasVideo ||
    ![meta.width, meta.height, meta.duration].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return null;
  }
  return {
    durationSec: meta.duration,
    width: meta.width,
    height: meta.height,
    frameRate:
      Number.isFinite(meta.frameRate) && meta.frameRate > 0
        ? meta.frameRate
        : undefined,
    hasAudio: meta.hasAudio,
  };
}

export async function runCompression(
  file: File | Blob,
  plan: CompressionPlan,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  const engine = getMediaEngine();
  await engine.initialize();
  signal?.throwIfAborted();
  const result = await engine.convertMedia(
    file,
    {
      format: "mp4",
      videoCodec: "avc",
      audioCodec: "aac",
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
      videoBitrate: plan.videoBitrateKbps * 1000,
      audioBitrate:
        plan.audioBitrateKbps > 0 ? plan.audioBitrateKbps * 1000 : undefined,
    },
    onProgress
      ? (p) => {
          if (!signal?.aborted) onProgress(p.progress);
        }
      : undefined,
    signal,
  );
  signal?.throwIfAborted();
  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 100) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}
