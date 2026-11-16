import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import type { TimelineToolPlan } from "./timeline-tool-edit";
import { planToolNudge } from "./timeline-tool-nudge";
import { planCloseGap } from "./ripple-delete";

/**
 * The Trim-mode edit-point model. An edit point is one edge of one clip. Where
 * another clip butts against that edge it is a cut (Roll by default); at the
 * edge of a gap, or the start/end of the track content, it is a free edge
 * (Ripple by default). Trims are planned by the same prepared-edit planners the
 * Ripple and Roll tools use, so sync lock, linked A/V and track locks apply
 * unchanged and each trim is one atomic `timeline/toolEdit` plan.
 */

export type EditPointKind = "ripple" | "roll";
export type EditPointEdge = "left" | "right";

export interface EditPointRef {
  clipId: string;
  edge: EditPointEdge;
}

/** Edges this close are one cut (matches the trim planners' adjacency). */
const ADJACENT = 1e-4;
const EPS = 1e-6;

function locate(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** The clip on the far side of the selected edge when it touches this one. */
export function findEditPointNeighbor(project: Project, ref: EditPointRef): Clip | null {
  const found = locate(project, ref.clipId);
  if (!found) return null;
  const { track, clip } = found;
  const edgeTime = ref.edge === "left" ? clip.startTime : clip.startTime + clip.duration;
  return (
    track.clips.find(
      (other) =>
        other.id !== clip.id &&
        Math.abs(
          (ref.edge === "left" ? other.startTime + other.duration : other.startTime) - edgeTime,
        ) < ADJACENT,
    ) ?? null
  );
}

/** Whether the point still refers to a clip that exists. */
export function isEditPointValid(project: Project, ref: EditPointRef): boolean {
  return locate(project, ref.clipId) !== null;
}

/** Roll at a cut between two clips, Ripple at a free edge. */
export function defaultEditPointKind(project: Project, ref: EditPointRef): EditPointKind {
  return findEditPointNeighbor(project, ref) ? "roll" : "ripple";
}

/** The other kind, or ripple when the edge has no neighbour to roll against. */
export function toggleEditPointKind(
  project: Project,
  ref: EditPointRef,
  current: EditPointKind,
): EditPointKind {
  if (current === "roll") return "ripple";
  return findEditPointNeighbor(project, ref) ? "roll" : "ripple";
}

/**
 * Trim a selected edit point by whole frames (positive moves the edge later in
 * time, negative earlier). A roll request on an edge with no neighbour falls
 * back to ripple. Throws the planners' own errors (locked track, handles, sync
 * lock) so callers can surface them; an empty plan means the move was clamped
 * to nothing.
 */
export function planEditPointTrim(
  project: Project,
  options: {
    clipId: string;
    edge: EditPointEdge;
    frames: number;
    kind?: EditPointKind;
    linkedIds?: readonly string[];
  },
): TimelineToolPlan & { kind: EditPointKind } {
  const ref = { clipId: options.clipId, edge: options.edge };
  if (!isEditPointValid(project, ref)) throw new Error("The selected edit point no longer exists.");
  if (!Number.isInteger(options.frames))
    throw new Error("The trim must be a whole number of frames.");
  const requested = options.kind ?? defaultEditPointKind(project, ref);
  const kind: EditPointKind =
    requested === "roll" && !findEditPointNeighbor(project, ref) ? "ripple" : requested;
  const plan = planToolNudge(project, {
    mode: kind,
    itemId: options.clipId,
    linkedIds: options.linkedIds,
    edge: options.edge,
    frames: options.frames,
  });
  return { ...plan, kind };
}

export interface TimelineGap {
  trackId: string;
  start: number;
  end: number;
}

/**
 * The empty stretch on a track containing `time`: between the previous clip's
 * end (or 0) and the next clip's start. Empty space after the last clip is not
 * a gap.
 */
export function findGapAt(project: Project, trackId: string, time: number): TimelineGap | null {
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track || !Number.isFinite(time)) return null;
  const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
  let cursor = 0;
  for (const clip of sorted) {
    if (clip.startTime - cursor > EPS && time >= cursor && time < clip.startTime)
      return { trackId, start: cursor, end: clip.startTime };
    cursor = Math.max(cursor, clip.startTime + clip.duration);
  }
  return null;
}

/** Whether the gap still exists unchanged (same bounds on the same track). */
export function isGapValid(project: Project, gap: TimelineGap): boolean {
  const live = findGapAt(project, gap.trackId, (gap.start + gap.end) / 2);
  return Boolean(live && Math.abs(live.start - gap.start) < EPS && Math.abs(live.end - gap.end) < EPS);
}

/** Ripple-delete a gap; every unlocked sync-locked track must be empty over it and shifts too. */
export function planDeleteGap(
  project: Project,
  gap: TimelineGap,
  operationId: string,
): TimelineToolPlan {
  if (!isGapValid(project, gap)) throw new Error("The selected gap no longer exists.");
  const plan = planCloseGap(project, gap.trackId, { start: gap.start, end: gap.end }, operationId);
  return { ...plan, label: "Delete gap" };
}

/**
 * Mark Clip: the sequence In/Out range of the clip under `time`. With
 * `trackIds` (the targeted tracks) only those are searched, topmost first;
 * otherwise every visible track is.
 */
export function markClipRange(
  project: Project,
  time: number,
  trackIds?: readonly string[],
): { start: number; end: number; clipId: string; trackId: string } | null {
  const wanted = trackIds?.length ? new Set(trackIds) : null;
  for (const track of project.timeline.tracks) {
    if (track.hidden || (wanted && !wanted.has(track.id))) continue;
    const clip = track.clips.find(
      (c) => time >= c.startTime - EPS && time < c.startTime + c.duration - EPS,
    );
    if (clip)
      return { start: clip.startTime, end: clip.startTime + clip.duration, clipId: clip.id, trackId: track.id };
  }
  return null;
}
