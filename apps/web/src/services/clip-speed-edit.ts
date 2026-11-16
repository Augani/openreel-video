import { SPEED_MIN, SPEED_MAX, type Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import { EditingSession } from "./agent/editing-session";
import { toast } from "../stores/notification-store";

export type ClipSpeedChange =
  | { speed: number }
  | { reversed: boolean }
  | { smoothSlowMo: boolean }
  | { interpolationQuality: NonNullable<Clip["interpolationQuality"]> };

export function linkedSpeedClipIds(clipId: string): string[] {
  return getLinkedTimelineSelection(useProjectStore.getState().project, [clipId], true);
}

/** Publish one complete speed edit, including every separated stream, or nothing. */
export async function editClipSpeed(projectId: string, clipId: string, changes: ClipSpeedChange, affectAudio: boolean): Promise<boolean> {
  const state = useProjectStore.getState();
  if (!state.hasOpenProject || state.project.id !== projectId || !state.getClip(clipId)
    || useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return false;
  if ("speed" in changes && (!Number.isFinite(changes.speed) || changes.speed < SPEED_MIN || changes.speed > SPEED_MAX)) return false;
  if ("interpolationQuality" in changes && !["low", "medium", "high"].includes(changes.interpolationQuality)) return false;
  const streamEdit = "speed" in changes || "reversed" in changes;
  const ids = affectAudio && streamEdit ? linkedSpeedClipIds(clipId) : [clipId];
  if (ids.some(id => !state.project.timeline.tracks.some(track => !track.locked && track.clips.some(clip => clip.id === id)))) return false;
  const changed = ids.some(id => {
    const clip = state.getClip(id)!;
    return Object.entries(changes).some(([field, value]) => (field === "speed" ? clip.speed ?? 1 : field === "reversed" ? clip.reversed ?? false : clip[field as keyof Clip]) !== value);
  });
  if (!changed) return false;
  const session = new EditingSession();
  const transaction = session.beginTransaction();
  try {
    if ("speed" in changes || "reversed" in changes) {
      for (const id of ids) {
        const result = await session.applyAction({
          type: "speed" in changes ? "clip/setSpeed" : "clip/setReverse",
          id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id, ...changes },
        });
        if (!result.success) throw new Error(result.error?.message ?? "The clip could not be edited.");
      }
    } else {
      const draft = session.getProject();
      session.replaceDraft({ ...draft, timeline: { ...draft.timeline, tracks: draft.timeline.tracks.map(track => ({
        ...track, clips: track.clips.map(clip => clip.id === clipId ? { ...clip, ...changes } : clip),
      })) } });
    }
    // A lock/export can start while the draft is preparing without changing
    // project data. Revalidate the editing session before publishing it.
    if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return false;
    await session.commitTransaction(transaction, "Edit speed and direction");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Please try again.";
    toast.error("Speed edit failed", message.includes("project changed while") ? "The project changed before the speed edit finished. Please try again." : message);
    return false;
  }
}
