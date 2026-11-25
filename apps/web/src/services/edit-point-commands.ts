import { v4 as uuidv4 } from "uuid";
import {
  defaultEditPointKind,
  findEditPointNeighbor,
  findGapAt,
  isEditPointValid,
  isGapValid,
  markClipRange,
  planDeleteGap,
  toggleEditPointKind,
  NUDGE_FRAMES,
  NUDGE_FRAMES_LARGE,
  type EditPointEdge,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { planSelectedEditTrim } from "./trim-monitor-plan";
import { commitNudgePlan } from "./timeline-tool-nudge";
import { commit, getMarkedRange, getTargetedTrackIds, type CommandOutcome } from "./premiere-edit-commands";

const fail = (message: string): CommandOutcome => ({ success: false, message });

/**
 * Select the edit point at one edge of a clip. With `toggleKind` (Cmd/Ctrl
 * click): clicking the point that is already selected flips Ripple/Roll;
 * clicking a different one selects it with the non-default kind.
 */
export function selectEditPoint(
  clipId: string,
  edge: EditPointEdge,
  options: { toggleKind?: boolean } = {},
): void {
  const project = useProjectStore.getState().project;
  const ref = { clipId, edge };
  if (!isEditPointValid(project, ref)) return;
  const current = useEditPointStore.getState().selection;
  const same = current?.type === "edit" && current.clipId === clipId && current.edge === edge;
  const base = same ? current.kind : defaultEditPointKind(project, ref);
  const kind = options.toggleKind ? toggleEditPointKind(project, ref, base) : base;
  // Clear clips first: the selection subscriber only clears on a non-empty selection.
  useUIStore.getState().clearSelection();
  useEditPointStore.getState().set({
    type: "edit",
    clipId,
    edge,
    kind,
    neighborId: findEditPointNeighbor(project, ref)?.id ?? null,
  });
}

/** Flip the selected edit point between Ripple and Roll (Roll needs a neighbour across the cut). */
export function toggleSelectedEditPointKind(): void {
  const selection = useEditPointStore.getState().selection;
  if (selection?.type !== "edit") return;
  const kind = toggleEditPointKind(useProjectStore.getState().project, selection, selection.kind);
  useEditPointStore.getState().set({ ...selection, kind });
}

/** Select the gap at `time` on a track, or clear the edit selection if there is none. */
export function selectGapAt(trackId: string, time: number): boolean {
  const gap = findGapAt(useProjectStore.getState().project, trackId, time);
  if (!gap) {
    useEditPointStore.getState().clear();
    return false;
  }
  useUIStore.getState().clearSelection();
  useEditPointStore.getState().set({ type: "gap", trackId: gap.trackId, start: gap.start, end: gap.end });
  return true;
}

/**
 * Trim the selected edit point by whole frames (negative is earlier). Key
 * nudges join one undo burst like the Alt+Arrow nudges; a typed amount is its
 * own undo step.
 */
export function trimSelectedEditPoint(frames: number, burst = true): CommandOutcome {
  const selection = useEditPointStore.getState().selection;
  if (selection?.type !== "edit") return fail("Select an edit point on the timeline first.");
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project before editing.");
  const project = store.getFullProject();
  if (!isEditPointValid(project, selection)) {
    useEditPointStore.getState().clear();
    return fail("The selected edit point no longer exists.");
  }
  try {
    const plan = planSelectedEditTrim(project, selection, frames);
    if (!plan.edits.length) return fail("The edit point cannot move that way (source handle, neighbour or one-frame minimum).");
    const result = burst ? commitNudgePlan(plan) : store.commitTimelineToolEdit(plan);
    if (!result.success) return fail(result.error?.message ?? "The trim could not be applied.");
    // The edge now sits elsewhere; a roll/ripple keeps the clip ids, so re-resolve the neighbour.
    const after = useProjectStore.getState().getFullProject();
    useEditPointStore.getState().set({
      ...selection,
      neighborId: findEditPointNeighbor(after, selection)?.id ?? null,
    });
    return { success: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The trim failed.");
  }
}

export const trimStepFrames = (direction: -1 | 1, large: boolean) =>
  direction * (large ? NUDGE_FRAMES_LARGE : NUDGE_FRAMES);

/** Parse "+5", "-3", "5" or "−2" typed into the trim entry; null when not a whole number of frames. */
export function parseTrimFrames(text: string): number | null {
  const normalized = text.trim().replace(/−/g, "-");
  if (!/^[+-]?\d{1,6}$/.test(normalized)) return null;
  const value = Number(normalized);
  return value === 0 ? null : value;
}

/** Ripple-delete the selected gap (sync lock aware), then clear the selection. */
export function deleteSelectedGap(): CommandOutcome {
  const selection = useEditPointStore.getState().selection;
  if (selection?.type !== "gap") return fail("Select a gap first.");
  const live = useProjectStore.getState().project;
  if (!isGapValid(live, selection)) {
    useEditPointStore.getState().clear();
    return fail("The selected gap no longer exists.");
  }
  const outcome = commit(
    (project) => planDeleteGap(project, selection, uuidv4()),
    "There is no gap to delete.",
  );
  if (outcome.success) useEditPointStore.getState().clear();
  return { success: outcome.success, message: outcome.message };
}

/** X: set the sequence In/Out to the clip under the playhead on the targeted tracks. */
export function markClip(): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const project = useProjectStore.getState().project;
  const range = markClipRange(project, time, getTargetedTrackIds(project));
  if (!range) return fail("No clip under the playhead on the targeted tracks.");
  useTimelineStore.getState().setLoopRange(range.start, range.end);
  return { success: true };
}

/** Shift+I / Shift+O: move the playhead to the sequence In or Out. */
export function goToMark(which: "in" | "out"): CommandOutcome {
  const range = getMarkedRange();
  if (!range) return fail("Set In and Out marks on the timeline first.");
  const timeline = useTimelineStore.getState();
  timeline.pause();
  timeline.seekTo(which === "in" ? range.start : range.end);
  useTimelineStore.getState().scrollToPlayhead();
  return { success: true };
}

/** Opt/Alt+X: clear the sequence In and Out. */
export function clearInOut(): CommandOutcome {
  useTimelineStore.getState().clearLoopRange();
  return { success: true };
}
