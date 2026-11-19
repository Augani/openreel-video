import { planClipSpeedEdit, type Clip, type ClipSpeedEdit } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import { commit, type CommandOutcome } from "./premiere-edit-commands";
import { useClipSpeedDialogStore } from "../stores/clip-speed-dialog-store";

/**
 * Selected media clips plus their linked partners. Linked audio always follows
 * a speed change, whatever the Linked Selection toggle says: retiming only the
 * picture would silently put the sound out of sync.
 */
export function selectedSpeedClips(): Clip[] {
  const state = useProjectStore.getState();
  if (!state.hasOpenProject) return [];
  const project = state.getFullProject();
  const ids = getLinkedTimelineSelection(
    project,
    useUIStore.getState().getSelectedClipIds(),
    true,
  );
  const wanted = new Set(ids);
  return project.timeline.tracks.flatMap((track) => track.clips.filter((clip) => wanted.has(clip.id)));
}

/**
 * Apply Speed/Duration to every selected clip as one undo step.
 * `ripple` is "Ripple Edit, Shifting Trailing Clips".
 */
export function applyClipSpeedEdit(edit: ClipSpeedEdit, ripple: boolean): CommandOutcome {
  if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason)
    return { success: false, message: "Wait for the export or playback lock to finish." };
  const clips = selectedSpeedClips();
  if (!clips.length) return { success: false, message: "Select one or more clips first." };
  const outcome = commit(
    (project) => planClipSpeedEdit(project, clips.map((clip) => clip.id), edit, { ripple }, uuidv4()),
    "Nothing changed.",
  );
  return { success: outcome.success, message: outcome.message };
}

export function openClipSpeedDialog(): CommandOutcome {
  if (!selectedSpeedClips().length) return { success: false, message: "Select one or more clips first." };
  useClipSpeedDialogStore.getState().setOpen(true);
  return { success: true };
}
