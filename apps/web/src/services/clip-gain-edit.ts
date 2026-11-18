import {
  getVolumeAutomationPointsForRange,
  insertAutomationPoint,
  deleteAutomationPoint,
  type AutomationPoint,
  type Clip,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { toast } from "../stores/notification-store";

/** The clip's volume lane exactly as stored (empty when it has none). */
export const clipGainPoints = (clip: Clip): AutomationPoint[] =>
  clip.automation?.volume ?? [];

/** Linear gain the clip plays at, `localTime` seconds into it. */
export function gainAtLocalTime(clip: Clip, localTime: number): number {
  const points = clipGainPoints(clip);
  return (
    getVolumeAutomationPointsForRange(points, localTime, 0.001, clip.volume)[0]
      ?.value ?? clip.volume
  );
}

/**
 * Replace a clip's volume lane as ONE undoable action. `null` or an empty list
 * removes the lane (the clip plays flat at its own volume). A refusal, such as
 * a locked track, is surfaced as a toast with the engine's own message and the
 * lane is left untouched.
 */
export async function commitClipGainPoints(
  clipId: string,
  points: readonly AutomationPoint[] | null,
): Promise<boolean> {
  const result = await useProjectStore.getState().executeAction({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: "audio/addAutomation",
    params: {
      clipId,
      points: points && points.length ? points.map((p) => ({ ...p })) : null,
    },
  });
  if (!result.success) {
    toast.warning("Gain edit blocked", result.error?.message ?? "The clip gain could not be changed.");
  }
  return result.success;
}

/** Add (or, when one is already there, remove) a gain keyframe at the playhead on the selected clip. */
export async function toggleGainKeyframeAtPlayhead(): Promise<boolean> {
  const store = useProjectStore.getState();
  const selected = useUIStore.getState().getSelectedClipIds();
  const playhead = useTimelineStore.getState().playheadPosition;
  const target = selected
    .map((id) => store.getClip(id))
    .find(
      (clip): clip is Clip =>
        !!clip &&
        store.project.timeline.tracks.find((t) => t.id === clip.trackId)?.type === "audio" &&
        playhead >= clip.startTime &&
        playhead <= clip.startTime + clip.duration,
    );
  if (!target) {
    toast.warning("No gain keyframe added", "Select an audio clip under the playhead.");
    return false;
  }
  const localTime = playhead - target.startTime;
  const points = clipGainPoints(target);
  const existing = points.findIndex((p) => Math.abs(p.time - localTime) < 0.01);
  if (existing >= 0) return commitClipGainPoints(target.id, deleteAutomationPoint(points, existing));
  return commitClipGainPoints(
    target.id,
    insertAutomationPoint(points, localTime, gainAtLocalTime(target, localTime)),
  );
}
