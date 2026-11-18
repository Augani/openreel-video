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
  // With several sequences the overlay and nest-instance collections are shared
  // by all of them: only the items that belong to the live timeline count.
  const scoped = (project.sequences?.length ?? 0) > 1;
  const trackIds = new Set(project.timeline.tracks.map((track) => track.id));
  const clipIds = new Set(project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  const include = (items: readonly (TimedItem & { readonly trackId?: string; readonly id?: string })[] | undefined, by: "track" | "clip" = "track"): void => {
    for (const item of items ?? []) {
      if (scoped) {
        if (by === "clip" ? !clipIds.has(item.id ?? "") : item.trackId !== undefined && !trackIds.has(item.trackId)) continue;
      }
      maxEnd = Math.max(maxEnd, timedEnd(item));
    }
  };

  for (const track of project.timeline.tracks) include(track.clips);
  include(project.textClips);
  include(project.shapeClips);
  include(project.svgClips);
  include(project.stickerClips);
  include(project.adjustmentLayers);
  include(project.nestedInstances, "clip");
  include(project.motionInstances);

  for (const subtitle of project.timeline.subtitles ?? []) {
    const endTime = Number.isFinite(subtitle.endTime) ? subtitle.endTime : 0;
    maxEnd = Math.max(maxEnd, Math.max(0, endTime));
  }

  return maxEnd;
}
