import type { MediaItem, Project } from "@openreel/core";

export interface SourceExportMatch {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  sourceName: string;
}

const STANDARD_FRAME_RATES = [24, 25, 30, 50, 60];

function snapFrameRate(frameRate: number): number {
  if (!(frameRate > 0)) return 30;
  let closest = STANDARD_FRAME_RATES[0];
  for (const candidate of STANDARD_FRAME_RATES) {
    if (Math.abs(candidate - frameRate) < Math.abs(closest - frameRate)) {
      closest = candidate;
    }
  }
  return closest;
}

function recommendedBitrateKbps(width: number, height: number, frameRate: number): number {
  const bitsPerPixel = 0.12;
  const fps = frameRate > 0 ? frameRate : 30;
  const kbps = Math.round((width * height * fps * bitsPerPixel) / 1000);
  return Math.min(60000, Math.max(2500, kbps));
}

function pickSourceVideo(project: Project): MediaItem | null {
  const items = project.mediaLibrary?.items ?? [];
  const videos = items.filter(
    (item) =>
      item.type === "video" &&
      !item.isPlaceholder &&
      (item.metadata?.width ?? 0) > 0 &&
      (item.metadata?.height ?? 0) > 0,
  );
  if (videos.length === 0) return null;

  // Prefer the video whose pixel dimensions already match the project canvas
  // (usually the primary clip the project was sized to); otherwise fall back to
  // the first imported video.
  const matchingCanvas = videos.find(
    (video) =>
      video.metadata.width === project.settings.width &&
      video.metadata.height === project.settings.height,
  );
  return matchingCanvas ?? videos[0];
}

export function deriveSourceExportMatch(
  project: Project | null | undefined,
): SourceExportMatch | null {
  if (!project) return null;

  const source = pickSourceVideo(project);
  if (!source) return null;

  const width = source.metadata.width;
  const height = source.metadata.height;
  const frameRate = snapFrameRate(source.metadata.frameRate ?? 0);

  return {
    width,
    height,
    frameRate,
    bitrate: recommendedBitrateKbps(width, height, frameRate),
    sourceName: source.name,
  };
}
