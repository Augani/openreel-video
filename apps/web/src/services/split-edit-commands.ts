import {
  chooseNudgeEdge,
  DEFAULT_SPLIT_EDIT_FRAMES,
  NUDGE_FRAMES,
  NUDGE_FRAMES_LARGE,
  planEdgeMoves,
  planExtendEdit,
  planSplitEdit,
  type Clip,
  type EdgeName,
  type Project,
  type SplitEditKind,
  type TimelineSide,
  type Track,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import { commit, type CommandOutcome } from "./premiere-edit-commands";
import { commitNudgePlan } from "./timeline-tool-nudge";

/**
 * Split-edit commands (Extend Edit, J/L cuts, side-only nudges). Each plans
 * with the pure functions in @openreel/core and commits one
 * `timeline/toolEdit`, so every command is exactly one undo step. The playhead
 * and selection are read synchronously at the start of a command.
 */

const ADJACENT = 1e-4;
const fail = (message: string): CommandOutcome => ({ success: false, message });

function findClip(project: Project, id: string): { clip: Clip; track: Track } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

/** The selected media clips, primary (most recently selected) last. */
function selectedMediaClips(project: Project): Clip[] {
  const ids = useUIStore.getState().getSelectedClipIds();
  return ids
    .map((id) => findClip(project, id)?.clip)
    .filter((clip): clip is Clip => !!clip);
}

/**
 * The cut a clip's context menu / selection refers to: the edge that has a
 * neighbour touching it, else the edge nearest the playhead.
 */
export function pickCutEdge(project: Project, clipId: string, playhead: number): EdgeName {
  const found = findClip(project, clipId);
  if (!found) return "right";
  const { clip, track } = found;
  const touches = (edge: EdgeName) =>
    track.clips.some((o) =>
      edge === "right"
        ? Math.abs(o.startTime - (clip.startTime + clip.duration)) < ADJACENT
        : Math.abs(o.startTime + o.duration - clip.startTime) < ADJACENT,
    );
  const right = touches("right");
  const left = touches("left");
  if (right && !left) return "right";
  if (left && !right) return "left";
  return chooseNudgeEdge(clip, playhead);
}

/** Extend Edit: move the selected edit point to the playhead. */
export function extendSelectedEdit(side: TimelineSide | "both" = "both"): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project before editing.");
  const project = store.getFullProject();
  const selected = selectedMediaClips(project);
  const primary = selected[selected.length - 1];
  if (!primary) return fail("Select a clip to extend its edit.");
  const edge = chooseNudgeEdge(primary, time);
  const ids = getLinkedTimelineSelection(
    project,
    selected.map((c) => c.id),
    useEditorWorkspaceStore.getState().linkedSelection,
  );
  const outcome = commit(
    (current) => planExtendEdit(current, { clipIds: ids, edge, time, side }),
    "The edit is already at the playhead, or can't extend any further.",
  );
  return { success: outcome.success, message: outcome.message };
}

/**
 * Nudge the selected edit point by whole frames on the selected clips' own
 * tracks only, ignoring links (a split-edit nudge). A cut between two clips
 * rolls just that track. Consecutive nudges join one undo step.
 */
export function nudgeSelectedEditSide(direction: 1 | -1, large: boolean): CommandOutcome {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project before editing.");
  const project = store.getFullProject();
  const selected = selectedMediaClips(project);
  const primary = selected[selected.length - 1];
  if (!primary) return fail("Select a clip to nudge its edit.");
  const edge = chooseNudgeEdge(primary, useTimelineStore.getState().playheadPosition);
  const frames = direction * (large ? NUDGE_FRAMES_LARGE : NUDGE_FRAMES);
  const delta = frames / project.settings.frameRate;
  try {
    const plan = planEdgeMoves(
      project,
      selected.map((clip) => ({ clipId: clip.id, edge, delta })),
      { label: "Nudge edit (this side)" },
    );
    if (!plan.edits.length) return { success: true };
    const result = commitNudgePlan(plan);
    return result.success
      ? { success: true }
      : fail(result.error?.message ?? "The edit could not be applied.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The edit failed.");
  }
}

/** J-cut (audio leads) or L-cut (audio trails) at a clip's cut. */
export function makeSplitEdit(
  kind: SplitEditKind,
  options: { clipId?: string; edge?: EdgeName; frames?: number } = {},
): CommandOutcome {
  const time = useTimelineStore.getState().playheadPosition;
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project before editing.");
  const project = store.getFullProject();
  const clipId =
    options.clipId ??
    selectedMediaClips(project).slice(-1)[0]?.id;
  if (!clipId) return fail("Select a clip at the cut first.");
  const edge = options.edge ?? pickCutEdge(project, clipId, time);
  const frames = options.frames ?? useEditorWorkspaceStore.getState().splitEditFrames ?? DEFAULT_SPLIT_EDIT_FRAMES;
  const outcome = commit(
    (current) => planSplitEdit(current, { clipId, edge, kind, frames }),
    kind === "j"
      ? "The audio cut is already that far ahead, or can't move any further."
      : "The audio cut is already that far behind, or can't move any further.",
  );
  return { success: outcome.success, message: outcome.message };
}
