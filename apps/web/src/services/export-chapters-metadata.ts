import type { Project, VideoExportSettings } from "@openreel/core";

/**
 * The ffmpeg `;FFMETADATA1` chapter text of an MP4 / MOV delivery (chapter markers within the export range), or
 * undefined when chapters are off, the container cannot hold them, or the project has no chapter markers.
 * Shared by the serial, smart-render and parallel-segment exports so all three write the same chapters.
 */
export async function chaptersMetadataFor(
  project: Pick<Project, "timeline">,
  settings: Pick<VideoExportSettings, "embedChapters" | "format" | "range">,
  timelineDurationSec: number,
): Promise<string | undefined> {
  if (!settings.embedChapters || (settings.format !== "mp4" && settings.format !== "mov")) return undefined;
  const { deliveryChapters, chaptersToFfMetadata } = await import("@openreel/core/export/chapters");
  const list = deliveryChapters(project.timeline.markers, timelineDurationSec, settings.range);
  return list.length > 0 ? chaptersToFfMetadata(list) : undefined;
}
