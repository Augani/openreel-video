import { isEditPointValid, planEditPointTrim } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useEditPointStore, type DynamicTrimSession } from "../stores/edit-point-store";
import { getLinkedTimelineSelection } from "../utils/linked-timeline-selection";
import { trimSelectedEditPoint } from "./edit-point-commands";
import type { CommandOutcome } from "./premiere-edit-commands";

/**
 * Dynamic (JKL) trimming. With an edit point selected, J / L run the playhead
 * backward / forward from the edge, repeated presses shuttle faster, and the
 * edge follows the playhead. Nothing is written to the project while it runs:
 * the Program monitor shows the playhead frame of the timeline as it is now
 * (not the trimmed result; the Trim indicator says so). K or Space commits the trim
 * through the same planner as `,` `.` and the agent's trim_edit_point, as one
 * undo step; Esc cancels and puts the playhead back. Source handles clamp the
 * move (the session reports `limited`), and snapping is off meanwhile.
 */

const MAX_SPEED = 8;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;

const fail = (message: string): CommandOutcome => ({ success: false, message });
const frameRate = (): number => {
  const rate = useProjectStore.getState().project.settings.frameRate;
  return Number.isFinite(rate) && rate > 0 ? rate : 30;
};

export const isDynamicTrimActive = (): boolean => useEditPointStore.getState().dynamicTrim !== null;

function selectedEdit() {
  const selection = useEditPointStore.getState().selection;
  return selection?.type === "edit" ? selection : null;
}

function edgeTime(): number | null {
  const selection = selectedEdit();
  if (!selection) return null;
  const project = useProjectStore.getState().project;
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === selection.clipId);
    if (clip) return selection.edge === "left" ? clip.startTime : clip.startTime + clip.duration;
  }
  return null;
}

/** Frames the planner would apply for a request; throws the planner's own error (locked track, sync lock). */
function appliedFramesFor(requested: number): number {
  const selection = selectedEdit();
  if (!selection || requested === 0) return 0;
  const project = useProjectStore.getState().getFullProject();
  const plan = planEditPointTrim(project, {
    clipId: selection.clipId,
    edge: selection.edge,
    frames: requested,
    kind: selection.kind,
    linkedIds: getLinkedTimelineSelection(project, [selection.clipId], useEditorWorkspaceStore.getState().linkedSelection)
      .filter((id) => id !== selection.clipId),
  });
  return plan.edits.length ? Math.round(plan.delta * frameRate()) : 0;
}

/**
 * True while the selection and the project are the ones the session started
 * with. A different edit point, a Ripple/Roll toggle, an undo or any other
 * edit ends it, so the commit can never land on something else.
 */
function sessionIsCurrent(session: DynamicTrimSession): boolean {
  const selection = selectedEdit();
  return (
    !!selection &&
    selection.clipId === session.clipId &&
    selection.edge === session.edge &&
    selection.kind === session.kind &&
    useProjectStore.getState().project.timeline === session.timelineRef
  );
}

/** Cancel the session when it no longer matches the selection or project. Returns true when it did. */
function cancelIfStale(): boolean {
  const session = useEditPointStore.getState().dynamicTrim;
  if (!session || sessionIsCurrent(session)) return false;
  const ended = endSession();
  if (ended) useTimelineStore.getState().seekTo(ended.savedPlayhead);
  return true;
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function update(patch: Partial<DynamicTrimSession>): void {
  const session = useEditPointStore.getState().dynamicTrim;
  if (session) useEditPointStore.getState().setDynamicTrim({ ...session, ...patch });
}

function endSession(): DynamicTrimSession | null {
  stopTimer();
  const session = useEditPointStore.getState().dynamicTrim;
  if (!session) return null;
  useEditPointStore.getState().setDynamicTrim(null);
  const ui = useUIStore.getState();
  if (session.savedSnap && !ui.snapSettings.enabled) ui.setSnapEnabled(true);
  return session;
}

/** Move the playhead to `requested` frames from the anchor, clamped to what the planner allows. */
function moveTo(requested: number, direction: -1 | 0 | 1): void {
  if (cancelIfStale()) return;
  const session = useEditPointStore.getState().dynamicTrim;
  if (!session) return;
  let applied: number;
  try {
    applied = appliedFramesFor(requested);
  } catch {
    applied = 0;
  }
  const limited = applied !== requested;
  useTimelineStore.getState().seekTo(Math.max(0, session.anchorTime + applied / frameRate()));
  update({
    requestedFrames: limited ? applied : requested,
    appliedFrames: applied,
    limited,
    direction: limited ? 0 : direction,
  });
  if (limited) stopTimer();
}

/** Advance the running shuttle by `seconds` of wall time. Exposed so tests can drive it. */
export function advanceDynamicTrim(seconds: number): void {
  const session = useEditPointStore.getState().dynamicTrim;
  if (!session || session.direction === 0) return;
  const steps = Math.max(1, Math.round(session.speed * seconds * frameRate()));
  moveTo(session.requestedFrames + session.direction * steps, session.direction);
}

function startTimer(): void {
  stopTimer();
  lastTick = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    advanceDynamicTrim((now - lastTick) / 1000);
    lastTick = now;
  }, Math.round(1000 / frameRate()));
}

/** Whether J/K/L should act on the selected edit point. */
export function dynamicTrimAvailable(): boolean {
  const state = useEditPointStore.getState();
  return state.dynamicTrimEnabled && state.selection?.type === "edit";
}

/**
 * J (-1) or L (1). The first press starts the trim at the edit point; the
 * same key again doubles the speed (1, 2, 4, 8); the opposite key reverses at
 * normal speed.
 */
export function dynamicTrimShuttle(direction: -1 | 1): CommandOutcome {
  const selection = selectedEdit();
  if (!selection) return fail("Select an edit point first.");
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project before editing.");
  if (!isEditPointValid(store.project, selection)) {
    useEditPointStore.getState().clear();
    return fail("The selected edit point no longer exists.");
  }
  if (cancelIfStale()) return fail("The trim was cancelled because the edit point changed.");
  const existing = useEditPointStore.getState().dynamicTrim;
  if (existing) {
    const speed = existing.direction === direction ? Math.min(MAX_SPEED, existing.speed * 2) : 1;
    update({ speed });
    // Pressing away from a limit frees the trim again.
    moveTo(existing.requestedFrames + direction, direction);
    if (useEditPointStore.getState().dynamicTrim?.direction !== 0) startTimer();
    return { success: true };
  }
  const anchor = edgeTime();
  if (anchor === null) return fail("The selected edit point no longer exists.");
  // A locked track or sync lock blocks the trim up front, before any playback.
  try {
    appliedFramesFor(direction);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The edit point cannot be trimmed.");
  }
  const timeline = useTimelineStore.getState();
  timeline.pause();
  timeline.setPlaybackRate(1);
  const ui = useUIStore.getState();
  const snapWasOn = ui.snapSettings.enabled;
  if (snapWasOn) ui.setSnapEnabled(false);
  useEditPointStore.getState().setDynamicTrim({
    clipId: selection.clipId,
    edge: selection.edge,
    kind: selection.kind,
    timelineRef: store.project.timeline,
    anchorTime: anchor,
    savedPlayhead: timeline.playheadPosition,
    savedSnap: snapWasOn,
    direction,
    speed: 1,
    requestedFrames: 0,
    appliedFrames: 0,
    limited: false,
  });
  timeline.seekTo(anchor);
  moveTo(direction, direction);
  if (useEditPointStore.getState().dynamicTrim?.direction !== 0) startTimer();
  return { success: true };
}

/** K / Space: stop and commit the trim as one undo step. Returns null when no trim is running. */
export function commitDynamicTrim(): CommandOutcome | null {
  const running = useEditPointStore.getState().dynamicTrim;
  if (running && cancelIfStale()) return fail("Trim cancelled: the edit point or project changed during the trim.");
  const session = endSession();
  if (!session) return null;
  if (session.appliedFrames === 0) {
    useTimelineStore.getState().seekTo(session.savedPlayhead);
    return { success: true };
  }
  const outcome = trimSelectedEditPoint(session.appliedFrames, false);
  if (!outcome.success) {
    useTimelineStore.getState().seekTo(session.savedPlayhead);
    return outcome;
  }
  // The edge moved with the playhead; leave the playhead on the new edge.
  const edge = edgeTime();
  if (edge !== null) useTimelineStore.getState().seekTo(edge);
  return outcome;
}

/** Esc: drop the trim, leaving the project untouched and the playhead where it was. */
export function cancelDynamicTrim(): boolean {
  const session = endSession();
  if (!session) return false;
  useTimelineStore.getState().seekTo(session.savedPlayhead);
  return true;
}

/** K+J / K+L: trim one frame with no shuttle running (its own undo step). */
export function dynamicTrimFrameStep(direction: -1 | 1): CommandOutcome {
  if (!dynamicTrimAvailable()) return fail("Select an edit point first.");
  const outcome = trimSelectedEditPoint(direction, false);
  const edge = edgeTime();
  if (outcome.success && edge !== null) useTimelineStore.getState().seekTo(edge);
  return outcome;
}
