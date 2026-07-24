import {
  getMediaEngine,
  type CompressionPlan,
  type CompressionSource,
} from "@openreel/core";

export async function probeCompressionSource(
  file: File | Blob,
): Promise<CompressionSource | null> {
  const engine = getMediaEngine();
  await engine.initialize();
  const meta = await engine.extractMetadata(file);
  if (!meta || !meta.hasVideo || meta.width <= 0 || meta.height <= 0) {
    return null;
  }
  return {
    durationSec: meta.duration,
    width: meta.width,
    height: meta.height,
    frameRate: meta.frameRate > 0 ? meta.frameRate : undefined,
    hasAudio: meta.hasAudio,
  };
}

export async function runCompression(
  file: File | Blob,
  plan: CompressionPlan,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const engine = getMediaEngine();
  await engine.initialize();
  return engine.convertMedia(
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
    onProgress ? (p) => onProgress(p.progress) : undefined,
    signal,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 100) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}
