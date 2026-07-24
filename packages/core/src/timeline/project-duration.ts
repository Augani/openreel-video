import type { Project } from "../types/project";

type TimedItem = { readonly startTime: number; readonly duration: number };

function timedEnd(item: TimedItem): number {
  const startTime = Number.isFinite(item.startTime) ? item.startTime : 0;
  const duration = Number.isFinite(item.duration) ? item.duration : 0;
  return Math.max(0, startTime) + Math.max(0, duration);
}

/** Returns the last authored frame across every editor timeline surface. */
export function calculateProjectDuration(project: Project): number {
  let maxEnd = 0;
  const include = (items: readonly TimedItem[] | undefined): void => {
    for (const item of items ?? []) maxEnd = Math.max(maxEnd, timedEnd(item));
  };

  for (const track of project.timeline.tracks) include(track.clips);
  include(project.textClips);
  include(project.shapeClips);
  include(project.svgClips);
  include(project.stickerClips);
  include(project.adjustmentLayers);
  include(project.nestedInstances);
  include(project.motionInstances);

  for (const subtitle of project.timeline.subtitles ?? []) {
    const endTime = Number.isFinite(subtitle.endTime) ? subtitle.endTime : 0;
    maxEnd = Math.max(maxEnd, Math.max(0, endTime));
  }

  return maxEnd;
}
