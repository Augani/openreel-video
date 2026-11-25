import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import {
  findEditPointNeighbor,
  isEditPointValid,
  planEditPointTrim,
  type EditPointRef,
} from "./edit-point";
import type { TimelineToolPlan } from "./timeline-tool-edit";
import { planToolNudge } from "./timeline-tool-nudge";

/**
 * Trim Monitor planning. The Trim Monitor shows the two sides of an edit point (outgoing | incoming) and
 * trims it in one of five ways. Every mode is planned by the same prepared-edit planners the timeline
 * tools use, so a trim is one atomic `timeline/toolEdit` plan: one undo step, with sync lock, linked A/V
 * and track locks applied exactly as for a drag or a nudge.
 *
 * Frame convention (positive is later in time on the timeline):
 * - roll: the cut moves, both clips change
 * - ripple-out: the outgoing clip's tail moves (later material shifts)
 * - ripple-in: the incoming clip's head moves (later material shifts)
 * - slip / slide: the planners' nudge convention (slip moves the source window, slide moves the clip)
 */
export type TrimMonitorMode = "roll" | "ripple-out" | "ripple-in" | "slip" | "slide";

export const TRIM_MONITOR_MODES: readonly TrimMonitorMode[] = ["roll", "ripple-out", "ripple-in", "slip", "slide"];

export const TRIM_MONITOR_MODE_LABELS: Record<TrimMonitorMode, string> = {
  roll: "Roll",
  "ripple-out": "Ripple Out",
  "ripple-in": "Ripple In",
  slip: "Slip",
  slide: "Slide",
};

/** The two sides of one edit point. Either side is null at a free edge. */
export interface TrimMonitorEdit {
  trackId: string;
  /** Timeline time of the edit point in seconds. */
  time: number;
  outgoing: Clip | null;
  incoming: Clip | null;
}

const ADJACENT = 1e-4;

function locate(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Resolves an edit point reference into its outgoing and incoming clips. */
export function resolveTrimMonitorEdit(project: Project, ref: EditPointRef): TrimMonitorEdit | null {
  const found = locate(project, ref.clipId);
  if (!found || !isEditPointValid(project, ref)) return null;
  const { track, clip } = found;
  const neighbor = findEditPointNeighbor(project, ref);
  const time = ref.edge === "left" ? clip.startTime : clip.startTime + clip.duration;
  return ref.edge === "left"
    ? { trackId: track.id, time, outgoing: neighbor, incoming: clip }
    : { trackId: track.id, time, outgoing: clip, incoming: neighbor };
}

/** Modes that make sense for this edit point (roll needs both sides, ripples need their side). */
export function availableTrimMonitorModes(edit: TrimMonitorEdit): TrimMonitorMode[] {
  const modes: TrimMonitorMode[] = [];
  if (edit.outgoing && edit.incoming) modes.push("roll");
  if (edit.outgoing) modes.push("ripple-out");
  if (edit.incoming) modes.push("ripple-in");
  modes.push("slip", "slide");
  return modes;
}

/** The mode a fresh Trim Monitor starts in: Roll at a cut, otherwise Ripple on the clip that exists. */
export function defaultTrimMonitorMode(edit: TrimMonitorEdit, preferred?: "ripple" | "roll"): TrimMonitorMode {
  if (edit.outgoing && edit.incoming && preferred !== "ripple") return "roll";
  if (edit.outgoing && edit.incoming) return "ripple-out";
  return edit.outgoing ? "ripple-out" : "ripple-in";
}

export type TrimMonitorSide = "outgoing" | "incoming";

/**
 * The clip a slip or slide acts on: the chosen side of the edit, else the clip that owns the selected
 * edge. A side that does not exist (a free edge) falls back to the clip that does.
 */
export function slipSlideTarget(edit: TrimMonitorEdit, ref: EditPointRef, side?: TrimMonitorSide): Clip | null {
  const preferred = side ?? (ref.edge === "left" ? "incoming" : "outgoing");
  return edit[preferred] ?? edit[preferred === "incoming" ? "outgoing" : "incoming"];
}

/**
 * The edit point reference that selects a mode's trimming edge: ripple-in moves the incoming clip's left
 * edge, everything else addresses the outgoing clip's right edge (or the incoming left edge at a head).
 */
export function trimMonitorRefFor(edit: TrimMonitorEdit, mode: TrimMonitorMode, current: EditPointRef): EditPointRef {
  if (mode === "ripple-in" && edit.incoming) return { clipId: edit.incoming.id, edge: "left" };
  if ((mode === "ripple-out" || mode === "roll") && edit.outgoing) return { clipId: edit.outgoing.id, edge: "right" };
  return current;
}

export interface TrimMonitorPlanOptions {
  ref: EditPointRef;
  mode: TrimMonitorMode;
  /** Whole frames, negative is earlier. */
  frames: number;
  /** Which clip a slip or slide acts on. Default: the clip that owns the edge of `ref`. */
  side?: TrimMonitorSide;
  /** Linked partners of the clip the plan edits (a clip and its partners must share start and length). */
  linkedIdsOf?: (clipId: string) => readonly string[];
}

/**
 * Plans one Trim Monitor trim. Throws the planners' own errors (locked track, sync lock, missing side);
 * an empty plan means the move was clamped to nothing (source handle, neighbour, one-frame minimum).
 */
export function planTrimMonitor(project: Project, options: TrimMonitorPlanOptions): TimelineToolPlan {
  const { ref, mode, frames } = options;
  if (!Number.isInteger(frames)) throw new Error("The trim must be a whole number of frames.");
  const edit = resolveTrimMonitorEdit(project, ref);
  if (!edit) throw new Error("The selected edit point no longer exists.");
  if (mode === "roll" && !(edit.outgoing && edit.incoming))
    throw new Error("A rolling edit needs a clip on both sides of the edit point.");
  if (mode === "ripple-out" && !edit.outgoing) throw new Error("There is no outgoing clip to ripple.");
  if (mode === "ripple-in" && !edit.incoming) throw new Error("There is no incoming clip to ripple.");

  if (mode === "slip" || mode === "slide") {
    const target = slipSlideTarget(edit, ref, options.side);
    if (!target) throw new Error(`There is no clip to ${mode}.`);
    const planned = planToolNudge(project, { mode, itemId: target.id, linkedIds: options.linkedIdsOf?.(target.id), frames });
    // The slip planner reports its delta as the source-window move, opposite to the requested frames for
    // forward clips; report the requested direction so callers can compare it with what they asked for.
    return mode === "slip" && !target.reversed ? { ...planned, delta: -planned.delta } : planned;
  }
  const edgeRef = trimMonitorRefFor(edit, mode, ref);
  return planEditPointTrim(project, {
    clipId: edgeRef.clipId,
    edge: edgeRef.edge,
    frames,
    kind: mode === "roll" ? "roll" : "ripple",
    linkedIds: options.linkedIdsOf?.(edgeRef.clipId),
  });
}

/** Edit point times on a track (clip boundaries), ascending and de-duplicated. */
function boundaryTimes(track: Track): number[] {
  const times: number[] = [];
  for (const clip of track.clips) times.push(clip.startTime, clip.startTime + clip.duration);
  times.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const t of times) if (unique.length === 0 || t - unique[unique.length - 1] > ADJACENT) unique.push(t);
  return unique;
}

/** The edit point reference for a boundary time on a track, preferring the incoming clip's left edge. */
export function editPointRefAt(track: Track, time: number): EditPointRef | null {
  const starts = track.clips.find((c) => Math.abs(c.startTime - time) < ADJACENT);
  if (starts) return { clipId: starts.id, edge: "left" };
  const ends = track.clips.find((c) => Math.abs(c.startTime + c.duration - time) < ADJACENT);
  return ends ? { clipId: ends.id, edge: "right" } : null;
}

/**
 * The next (1) or previous (-1) edit point on the same track as `ref`, or null at the ends. Interior
 * cuts and free edges both count, like Premiere's Up/Down edit navigation in the Trim Monitor.
 */
export function adjacentEditPoint(project: Project, ref: EditPointRef, direction: 1 | -1): EditPointRef | null {
  const edit = resolveTrimMonitorEdit(project, ref);
  if (!edit) return null;
  const track = project.timeline.tracks.find((t) => t.id === edit.trackId);
  if (!track) return null;
  const times = boundaryTimes(track);
  const next = direction === 1 ? times.find((t) => t > edit.time + ADJACENT) : [...times].reverse().find((t) => t < edit.time - ADJACENT);
  return next === undefined ? null : editPointRefAt(track, next);
}
