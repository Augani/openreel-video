import {
  adjacentEditPoint,
  availableTrimMonitorModes,
  defaultTrimMonitorMode,
  editPointRefAt,
  resolveTrimMonitorEdit,
  trimMonitorRefFor,
  type EditPointRef,
  type Project,
  type TrimMonitorMode,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { useTrimMonitorStore } from "../stores/trim-monitor-store";
import { cancelDynamicTrim } from "./dynamic-trim";
import { selectEditPoint, trimSelectedEditPoint } from "./edit-point-commands";
import type { CommandOutcome } from "./premiere-edit-commands";

/**
 * The Trim Monitor: a dual-view (outgoing | incoming) Program-monitor mode for one edit point.
 * It owns no edit logic. Trims are planned by `planSelectedEditTrim` (the monitor's mode decides) and
 * committed through the same path as the Trim-mode keys, one undo step each, so sync lock, linked A/V and
 * track locks apply unchanged. Dynamic JKL trimming runs on the same selection (see dynamic-trim.ts).
 */

const fail = (message: string): CommandOutcome => ({ success: false, message });

export const isTrimMonitorOpen = (): boolean => useTrimMonitorStore.getState().open;

function selectedRef(): EditPointRef | null {
  const selection = useEditPointStore.getState().selection;
  return selection?.type === "edit" ? { clipId: selection.clipId, edge: selection.edge } : null;
}

/** The two sides of the monitored edit point in the current (stored) project. */
export function currentTrimEdit(project: Project = useProjectStore.getState().getFullProject()) {
  const ref = selectedRef();
  return ref ? resolveTrimMonitorEdit(project, ref) : null;
}

/** Whether T should open the monitor: an edit point is selected, or the monitor is already open. */
export function trimMonitorKeyApplies(): boolean {
  return isTrimMonitorOpen() || useEditPointStore.getState().selection?.type === "edit";
}

/** Edit point closest to the playhead on the selected clip's track, else the first video track. */
function nearestEditPoint(project: Project, time: number, preferredClipId?: string): EditPointRef | null {
  const tracks = project.timeline.tracks.filter((t) => t.clips.length > 0);
  const owner = preferredClipId ? tracks.find((t) => t.clips.some((c) => c.id === preferredClipId)) : undefined;
  const track = owner ?? tracks.find((t) => t.type === "video") ?? tracks[0];
  if (!track) return null;
  let best: { time: number; distance: number } | null = null;
  for (const clip of track.clips) {
    for (const edge of [clip.startTime, clip.startTime + clip.duration]) {
      const distance = Math.abs(edge - time);
      if (!best || distance < best.distance - 1e-6) best = { time: edge, distance };
    }
  }
  return best ? editPointRefAt(track, best.time) : null;
}

function applyMode(mode: TrimMonitorMode): void {
  const ref = selectedRef();
  if (!ref) return;
  const project = useProjectStore.getState().getFullProject();
  const edit = resolveTrimMonitorEdit(project, ref);
  if (!edit) return;
  // The selection follows the mode: ripple-in addresses the incoming head, roll / ripple-out the outgoing tail.
  const target = trimMonitorRefFor(edit, mode, ref);
  const kind = mode === "roll" ? "roll" : "ripple";
  if (target.clipId !== ref.clipId || target.edge !== ref.edge) selectEditPoint(target.clipId, target.edge);
  const selection = useEditPointStore.getState().selection;
  if (selection?.type === "edit" && selection.kind !== kind && (mode === "roll" || mode.startsWith("ripple")))
    useEditPointStore.getState().set({ ...selection, kind });
  useTrimMonitorStore.getState().setMode(mode);
}

/** Opens the monitor on the selected edit point (or the one nearest the playhead). */
export function openTrimMonitor(): CommandOutcome {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) return fail("Open a project before editing.");
  const project = store.getFullProject();
  const timeline = useTimelineStore.getState();
  let ref = selectedRef();
  if (!ref) {
    ref = nearestEditPoint(project, timeline.playheadPosition, useUIStore.getState().getSelectedClipIds()[0]);
    if (!ref) return fail("There is no edit point to trim.");
    selectEditPoint(ref.clipId, ref.edge);
  }
  const edit = resolveTrimMonitorEdit(project, ref);
  if (!edit) return fail("The selected edit point no longer exists.");
  const selection = useEditPointStore.getState().selection;
  const preferred = selection?.type === "edit" ? selection.kind : undefined;
  useTrimMonitorStore.getState().setOpen(true, timeline.playheadPosition);
  applyMode(defaultTrimMonitorMode(edit, preferred));
  timeline.pause();
  timeline.seekTo(edit.time);
  return { success: true };
}

export function closeTrimMonitor(): boolean {
  if (!isTrimMonitorOpen()) return false;
  stopPlayAround();
  cancelDynamicTrim();
  useTrimMonitorStore.getState().setOpen(false);
  return true;
}

export function toggleTrimMonitor(): CommandOutcome {
  if (isTrimMonitorOpen()) {
    closeTrimMonitor();
    return { success: true };
  }
  return openTrimMonitor();
}

/** Which clip Slip and Slide act on. Cancels a running JKL trim, which was planned against the other clip. */
export function setTrimMonitorSide(side: "outgoing" | "incoming"): CommandOutcome {
  const edit = currentTrimEdit();
  if (!edit) return fail("The selected edit point no longer exists.");
  if (!edit[side]) return fail(`There is no ${side} clip at this edit point.`);
  cancelDynamicTrim();
  useTrimMonitorStore.getState().setSide(side);
  return { success: true };
}

export function setTrimMonitorMode(mode: TrimMonitorMode): CommandOutcome {
  const edit = currentTrimEdit();
  if (!edit) return fail("The selected edit point no longer exists.");
  if (!availableTrimMonitorModes(edit).includes(mode)) return fail("That trim is not available at this edit point.");
  cancelDynamicTrim();
  applyMode(mode);
  return { success: true };
}

/**
 * Trim by a number of frames in the monitor's mode (negative is earlier). One undo step per call, so a
 * typed offset or a -5 / -1 / +1 / +5 button is one entry in the history.
 */
export function trimMonitorOffset(frames: number): CommandOutcome {
  if (!Number.isInteger(frames) || frames === 0) return fail("Enter a whole number of frames, such as -3 or +5.");
  cancelDynamicTrim();
  const outcome = trimSelectedEditPoint(frames, false);
  const monitor = useTrimMonitorStore.getState();
  monitor.setLastOffset(outcome.success ? frames : null, outcome.success ? null : (outcome.message ?? "The trim could not be applied."));
  if (outcome.success) {
    const edit = currentTrimEdit();
    if (edit) useTimelineStore.getState().seekTo(edit.time);
  }
  return outcome;
}

/** Parse a typed offset: "+5", "-3", "5", with a unicode minus accepted. Null when not whole frames. */
export function parseTrimOffset(text: string): number | null {
  const normalized = text.trim().replace(/−/g, "-");
  if (!/^[+-]?\d{1,6}$/.test(normalized)) return null;
  const value = Number(normalized);
  return value === 0 ? null : value;
}

/** Up / Down: select the next or previous edit point on the same track and show it. */
export function trimMonitorNavigate(direction: 1 | -1): CommandOutcome {
  const ref = selectedRef();
  if (!ref) return fail("Select an edit point first.");
  cancelDynamicTrim();
  stopPlayAround();
  const project = useProjectStore.getState().getFullProject();
  const next = adjacentEditPoint(project, ref, direction);
  if (!next) return fail(direction === 1 ? "This is the last edit point on the track." : "This is the first edit point on the track.");
  selectEditPoint(next.clipId, next.edge);
  const edit = resolveTrimMonitorEdit(project, next);
  if (!edit) return fail("The edit point no longer exists.");
  useTrimMonitorStore.getState().setLastOffset(null);
  applyMode(defaultTrimMonitorMode(edit));
  useTimelineStore.getState().seekTo(edit.time);
  return { success: true };
}

// ---- Play Around Edit: loop playback from pre-roll to post-roll around the edit ----

let unsubscribe: (() => void) | null = null;
let loopStart = 0;
let loopEnd = 0;

function endLoopSubscription(): void {
  unsubscribe?.();
  unsubscribe = null;
}

/** Stops the loop and leaves the playhead on the edit. */
export function stopPlayAround(): void {
  const wasPlaying = useTrimMonitorStore.getState().playingAround;
  endLoopSubscription();
  if (!wasPlaying) return;
  useTrimMonitorStore.getState().setPlayingAround(false);
  const timeline = useTimelineStore.getState();
  timeline.pause();
  const edit = currentTrimEdit();
  if (edit) timeline.seekTo(edit.time);
}

/** Plays from pre-roll to post-roll around the edit and loops until stopped. */
export function playAroundEdit(): CommandOutcome {
  const edit = currentTrimEdit();
  if (!edit) return fail("Select an edit point first.");
  cancelDynamicTrim();
  const monitor = useTrimMonitorStore.getState();
  const duration = useProjectStore.getState().project.timeline.duration;
  loopStart = Math.max(0, edit.time - monitor.preroll);
  loopEnd = Math.min(duration > 0 ? duration : edit.time + monitor.postroll, edit.time + monitor.postroll);
  if (loopEnd - loopStart < 0.1) return fail("There is nothing to play around this edit.");
  endLoopSubscription();
  const timeline = useTimelineStore.getState();
  timeline.setPlaybackRate(1);
  timeline.seekTo(loopStart);
  monitor.setPlayingAround(true);
  timeline.play();
  unsubscribe = useTimelineStore.subscribe((state, previous) => {
    if (state.playbackState !== "playing" && previous.playbackState === "playing") {
      if (state.playheadPosition >= loopEnd - 1e-3) {
        // The transport stopped at the end of the timeline, which is the end of the loop: go round again.
        state.seekTo(loopStart);
        state.play();
        return;
      }
      // Paused by something else (K, a click, the transport): the loop is over.
      endLoopSubscription();
      useTrimMonitorStore.getState().setPlayingAround(false);
      return;
    }
    if (state.playbackState === "playing" && state.playheadPosition >= loopEnd) state.seekTo(loopStart);
  });
  return { success: true };
}

export function togglePlayAround(): CommandOutcome {
  if (useTrimMonitorStore.getState().playingAround) {
    stopPlayAround();
    return { success: true };
  }
  return playAroundEdit();
}

/** Times of the outgoing and incoming frames the monitor shows (null for a side that is not there). */
export function trimMonitorTimes(
  project: Project,
  ref: EditPointRef,
  frameRate: number,
): { outgoing: number | null; incoming: number | null } | null {
  const edit = resolveTrimMonitorEdit(project, ref);
  if (!edit) return null;
  const frame = 1 / (Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30);
  return {
    outgoing: edit.outgoing ? Math.max(0, edit.outgoing.startTime + edit.outgoing.duration - frame) : null,
    incoming: edit.incoming ? Math.max(0, edit.incoming.startTime) : null,
  };
}
