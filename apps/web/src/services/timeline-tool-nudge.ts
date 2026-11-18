import {
  chooseNudgeEdge,
  planToolNudge,
  NUDGE_FRAMES,
  NUDGE_FRAMES_LARGE,
  type Clip,
  type TimelineToolMode,
  type TimelineToolPlan,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import type { CommandOutcome } from "./premiere-edit-commands";

/** Keystrokes closer together than this are one nudge burst (one undo step). */
export const NUDGE_BURST_MS = 600;

const TOOL_MODES: readonly string[] = ["ripple", "slip", "roll", "slide", "stretch"];
export const isTrimToolMode = (mode: string): mode is TimelineToolMode =>
  TOOL_MODES.includes(mode);

const NUDGE_BURST_KEY = "nudge-edit";
let burst: {
  history: { endBurst(): void; beginBurst(key: string): void };
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/** Close the open nudge burst now; the next nudge starts a new undo step. */
export function endNudgeBurst(): void {
  if (!burst) return;
  clearTimeout(burst.timer);
  const { history } = burst;
  burst = null;
  history.endBurst();
}

/**
 * Commit a nudge plan inside the current burst. Consecutive nudges within
 * NUDGE_BURST_MS join one history group; any other action pushed to history
 * (or an undo/redo) closes the burst, so unrelated edits never merge in.
 */
export function commitNudgePlan(plan: TimelineToolPlan) {
  const store = useProjectStore.getState();
  const history = store.actionExecutor.getHistory();
  if (burst && burst.history !== history) endNudgeBurst();
  if (burst) clearTimeout(burst.timer);
  history.beginBurst(NUDGE_BURST_KEY);
  burst = { history, timer: setTimeout(endNudgeBurst, NUDGE_BURST_MS) };
  return store.commitTimelineToolEdit(plan, { burstKey: NUDGE_BURST_KEY });
}

/**
 * Alt+Left/Right: nudge the active tool's edit on the selected clip by one
 * frame (five with Shift). Edge tools move the edit point nearest the playhead.
 */
export function nudgeSelectedToolEdit(
  direction: 1 | -1,
  large: boolean,
): CommandOutcome {
  const mode = useEditorWorkspaceStore.getState().timelineTool;
  if (!isTrimToolMode(mode))
    return { success: false, message: "Choose the Ripple, Slip, Roll, Slide or Rate Stretch tool to nudge an edit." };
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return { success: false, message: "Open a project before editing." };
  const project = store.getFullProject();
  const ids = useUIStore.getState().getSelectedClipIds();
  const id = [...ids].reverse().find((candidate) =>
    project.timeline.tracks.some((track) => track.clips.some((clip) => clip.id === candidate)),
  );
  if (!id) return { success: false, message: "Select a clip to nudge its edit." };
  const clip = project.timeline.tracks.flatMap((track) => track.clips).find((c: Clip) => c.id === id)!;
  try {
    const plan = planToolNudge(project, {
      mode,
      itemId: id,
      linkedIds: getLinkedTimelineSelection(project, [id], useEditorWorkspaceStore.getState().linkedSelection),
      edge: chooseNudgeEdge(clip, useTimelineStore.getState().playheadPosition),
      frames: direction * (large ? NUDGE_FRAMES_LARGE : NUDGE_FRAMES),
    });
    if (!plan.edits.length) return { success: true };
    const result = commitNudgePlan(plan);
    return result.success
      ? { success: true }
      : { success: false, message: result.error?.message ?? "The edit could not be applied." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "The edit failed." };
  }
}
