import type { VideoExportSettings } from "@openreel/core";

/** Estimated output bytes for a video preset (video + audio bitrate over the duration). */
export function estimatePresetBytes(
  settings: Pick<VideoExportSettings, "bitrate"> & { audioSettings?: { bitrate?: number } },
  durationSeconds: number,
): number {
  if (!(durationSeconds > 0) || !(settings.bitrate > 0)) return 0;
  const audioKbps = settings.audioSettings?.bitrate ?? 0;
  return Math.ceil(((settings.bitrate + audioKbps) * 1000 * durationSeconds) / 8);
}

/** "~28 MB", "~640 KB", "~1.20 GB"; empty when unknown. */
export function formatEstimatedSize(bytes: number): string {
  if (!(bytes > 0)) return "";
  if (bytes < 1024 * 1024) return `~${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `~${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `~${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
