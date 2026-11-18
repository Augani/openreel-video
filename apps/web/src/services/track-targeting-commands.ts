import { isSyncLocked } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { getPrimarySelectedTrackId } from "../components/editor/timeline/primary-track";
import type { CommandOutcome } from "./premiere-edit-commands";

/**
 * Keyboard-driven track targeting and Sync Lock. Both act on the track of the
 * current selection (a clip, a track header or any timeline item on it).
 */
const fail = (message: string): CommandOutcome => ({ success: false, message });

function selectedTrack() {
  const { project } = useProjectStore.getState();
  const id = getPrimarySelectedTrackId(project, useUIStore.getState().selectedItems);
  return project.timeline.tracks.find((track) => track.id === id) ?? null;
}

/** Toggle the target (V1/A1 style) of the selected track. */
export function toggleTargetOnSelectedTrack(): CommandOutcome {
  const track = selectedTrack();
  if (!track) return fail("Select a track or a clip first.");
  const workspace = useEditorWorkspaceStore.getState();
  const next = !workspace.targetedTrackIds.includes(track.id);
  workspace.setTrackTargeted(track.id, next);
  return { success: true, message: `${track.name} ${next ? "targeted" : "untargeted"}` };
}

/** Toggle Sync Lock of the selected track (one undo step). */
export async function toggleSyncLockOnSelectedTrack(): Promise<CommandOutcome> {
  const track = selectedTrack();
  if (!track) return fail("Select a track or a clip first.");
  const next = !isSyncLocked(track);
  const result = await useProjectStore.getState().setTrackSyncLock(track.id, next);
  if (!result.success) return fail(result.error?.message ?? "Could not change Sync Lock.");
  return { success: true, message: `Sync Lock ${next ? "on" : "off"} for ${track.name}` };
}
