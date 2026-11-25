import {
  applyTimelineToolEdits,
  isEditPointValid,
  reconcileMulticamAudio,
  type Project,
  type TimelineToolPlan,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditPointStore, type DynamicTrimSession } from "../stores/edit-point-store";
import { planSelectedEditTrim } from "./trim-monitor-plan";
import { trimSelectedEditPoint } from "./edit-point-commands";
import type { CommandOutcome } from "./premiere-edit-commands";

/**
 * Dynamic (JKL) trimming. With an edit point selected, J / L run the playhead
 * backward / forward from the edge, repeated presses shuttle faster, and the
 * edge follows the playhead. Nothing is written to the project while it runs:
 * the Program monitor shows the trimmed result live: the session carries a
 * preview project (the planner's edits applied to a copy) that only the monitor
 * reads, and the playhead sits on the trimmed clip's frame at the moving edge
 * (a right edge shows the clip's last frame). K or Space commits the trim
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

/** The planner's plan for a request; throws the planner's own error (locked track, sync lock). */
function planFor(requested: number): { plan: TimelineToolPlan; project: Project } | null {
  const selection = selectedEdit();
  if (!selection || requested === 0) return null;
  const project = useProjectStore.getState().getFullProject();
  const plan = planSelectedEditTrim(project, selection, requested);
  return { plan, project };
}

const framesOf = (plan: TimelineToolPlan | undefined): number =>
  plan && plan.edits.length ? Math.round(plan.delta * frameRate()) : 0;

/** Frames the planner would apply for a request. */
function appliedFramesFor(requested: number): number {
  return framesOf(planFor(requested)?.plan);
}

/**
 * The project with the planned trim applied, for the Program monitor only. Edits go onto the
 * stored project (what the monitor normally renders) from a clone, so nothing shared is mutated.
 */
function buildPreviewProject(plan: TimelineToolPlan | undefined, full: Project | undefined): Project | null {
  if (!plan || !plan.edits.length) return null;
  try {
    const stored = useProjectStore.getState().project;
    // The plan is made on the full project (overlay collections owned by the title / graphics engines),
    // but the monitor renders the stored one and falls back to the engines only for a collection the
    // stored project lacks. Fill exactly those, so the edits land on the collection the monitor reads
    // instead of replacing an engine-owned one with an empty list.
    const base: Project = {
      ...stored,
      textClips: stored.textClips ?? full?.textClips,
      shapeClips: stored.shapeClips ?? full?.shapeClips,
      svgClips: stored.svgClips ?? full?.svgClips,
      stickerClips: stored.stickerClips ?? full?.stickerClips,
    };
    // applyTimelineToolEdits is copy-on-write (only touched tracks / collections are rebuilt) and the
    // edits are never mutated afterwards, so no deep clone: the cost is O(touched tracks), not O(project).
    return reconcileMulticamAudio(applyTimelineToolEdits(base, plan.edits));
  } catch {
    return null;
  }
}

/**
 * The frame the monitor shows for a trim: the trimmed clip's first frame for a left edge and
 * its last frame for a right edge, read from the preview project so a ripple that keeps the
 * clip's start in place still lands on the clip's real first frame. Without a preview it falls
 * back to the edge time.
 */
export function dynamicTrimMonitorTime(
  edge: "left" | "right",
  clipId: string,
  preview: Project | null,
  fallbackEdge: number,
): number {
  let edgeTimeSeconds = fallbackEdge;
  for (const track of preview?.timeline.tracks ?? []) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) edgeTimeSeconds = edge === "left" ? clip.startTime : clip.startTime + clip.duration;
  }
  return Math.max(0, edge === "right" ? edgeTimeSeconds - 1 / frameRate() : edgeTimeSeconds);
}

/**
 * The two frames of a two-up at a cut: the outgoing clip's last frame and the incoming clip's first
 * frame, read from `project` (the live trimmed preview during a trim). Null when either clip is gone.
 */
export function dynamicTrimTwoUpTimes(
  project: Project,
  clipId: string,
  neighborId: string,
  edge: "left" | "right",
): { outgoing: number; incoming: number } | null {
  let trimmed: { startTime: number; duration: number } | null = null;
  let neighbor: { startTime: number; duration: number } | null = null;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === clipId) trimmed = clip;
      else if (clip.id === neighborId) neighbor = clip;
    }
  }
  if (!trimmed || !neighbor) return null;
  const outgoing = edge === "right" ? trimmed : neighbor;
  const incoming = edge === "right" ? neighbor : trimmed;
  return {
    outgoing: Math.max(0, outgoing.startTime + outgoing.duration - 1 / frameRate()),
    incoming: Math.max(0, incoming.startTime),
  };
}

/**
 * The project the Program monitor should render: the live trimmed preview while a dynamic
 * trim runs, otherwise the stored project.
 */
export function getMonitorProject(): Project {
  return useEditPointStore.getState().dynamicTrim?.previewProject ?? useProjectStore.getState().project;
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

/**
 * The monitor (preview project + the playhead frame it shows) is published at most once per
 * MONITOR_INTERVAL_MS. A paused-frame render that every newer request aborts never presents, and a
 * seek into a long-GOP clip outlasts one shuttle tick, so publishing every tick would starve the
 * monitor until the trim stopped. The session's numbers (frames, limit) still update every tick; the
 * first move, a limit and the end of the trim publish immediately.
 */
export const MONITOR_INTERVAL_MS = 100;
let monitorTimer: ReturnType<typeof setTimeout> | null = null;
let queuedMonitor: (() => void) | null = null;
let lastMonitorAt = Number.NEGATIVE_INFINITY;

function clearMonitorQueue(): void {
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = null;
  queuedMonitor = null;
  lastMonitorAt = Number.NEGATIVE_INFINITY;
}

/** Publish any queued monitor update now (tests, and the limit / stop paths). */
export function flushDynamicTrimMonitor(): void {
  const run = queuedMonitor;
  if (monitorTimer) clearTimeout(monitorTimer);
  monitorTimer = null;
  queuedMonitor = null;
  if (run) {
    lastMonitorAt = Date.now();
    run();
  }
}

function publishMonitor(run: () => void, immediate: boolean): void {
  const now = Date.now();
  if (immediate || now - lastMonitorAt >= MONITOR_INTERVAL_MS) {
    if (monitorTimer) clearTimeout(monitorTimer);
    monitorTimer = null;
    queuedMonitor = null;
    lastMonitorAt = now;
    run();
    return;
  }
  queuedMonitor = run;
  if (!monitorTimer) monitorTimer = setTimeout(flushDynamicTrimMonitor, MONITOR_INTERVAL_MS - (now - lastMonitorAt));
}

function update(patch: Partial<DynamicTrimSession>): void {
  const session = useEditPointStore.getState().dynamicTrim;
  if (session) useEditPointStore.getState().setDynamicTrim({ ...session, ...patch });
}

function endSession(): DynamicTrimSession | null {
  stopTimer();
  clearMonitorQueue();
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
  let planned: ReturnType<typeof planFor> = null;
  try {
    planned = planFor(requested);
  } catch {
    planned = null;
  }
  const plan = planned?.plan;
  const applied = framesOf(plan);
  const limited = applied !== requested;
  update({
    requestedFrames: limited ? applied : requested,
    appliedFrames: applied,
    limited,
    direction: limited ? 0 : direction,
  });
  publishMonitor(() => {
    const live = useEditPointStore.getState().dynamicTrim;
    if (!live) return;
    const previewProject = buildPreviewProject(plan, planned?.project);
    useTimelineStore.getState().seekTo(
      dynamicTrimMonitorTime(live.edge, live.clipId, previewProject, live.anchorTime + applied / frameRate()),
    );
    useEditPointStore.getState().setDynamicTrim({ ...live, previewProject });
  }, limited || session.previewProject === null);
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
    previewProject: null,
  });
  timeline.seekTo(dynamicTrimMonitorTime(selection.edge, selection.clipId, null, anchor));
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
