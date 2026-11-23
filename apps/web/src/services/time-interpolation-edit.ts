import { effectiveTimeInterpolation, isTimeInterpolation, type TimeInterpolation } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { EditingSession } from "./agent/editing-session";
import { toast } from "../stores/notification-store";

/** The video clips a Time Interpolation command applies to: the selection when `clipId` is in it, else the clip alone. */
export function timeInterpolationTargets(clipId: string): string[] {
  const state = useProjectStore.getState();
  const selected = useUIStore.getState().getSelectedClipIds();
  const wanted = selected.includes(clipId) ? selected : [clipId];
  const project = state.project;
  const media = new Map(project.mediaLibrary.items.map((item) => [item.id, item] as const));
  return project.timeline.tracks.flatMap((track) =>
    track.locked ? [] : track.clips.filter((clip) => wanted.includes(clip.id) && media.get(clip.mediaId)?.type === "video").map((clip) => clip.id),
  );
}

/** Clip > Time Interpolation for one or several clips: one undo step, nothing changes when it fails. */
export async function setClipsTimeInterpolation(clipIds: readonly string[], mode: TimeInterpolation): Promise<boolean> {
  const state = useProjectStore.getState();
  if (!state.hasOpenProject || !isTimeInterpolation(mode)) return false;
  if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return false;
  const ids = clipIds.filter((id) => {
    const clip = state.getClip(id);
    return clip && effectiveTimeInterpolation(clip) !== mode;
  });
  if (ids.length === 0) return false;
  const session = new EditingSession();
  const transaction = session.beginTransaction();
  try {
    for (const id of ids) {
      const result = await session.applyAction({
        type: "clip/setTimeInterpolation",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId: id, timeInterpolation: mode },
      });
      if (!result.success) throw new Error(result.error?.message ?? "The clip could not be edited.");
    }
    if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return false;
    await session.commitTransaction(transaction, "Set time interpolation");
    return true;
  } catch (error) {
    toast.error("Time interpolation failed", error instanceof Error ? error.message : "Please try again.");
    return false;
  }
}
