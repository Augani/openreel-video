import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import { SPEED_MAX, SPEED_MIN } from "../video/speed-engine";
import {
  allTracksRipple,
  diffPlan,
  openTimelineGaps,
  pruneTransitions,
  removeTimelineSpans,
  shiftAfterBatch,
  splitAt,
  type ShiftStep,
} from "./premiere-edits";
import { assertRangeEmptyOnTracks, syncFollowerTrackIds } from "./sync-lock";
import { resizeKeys, type Item, type TimelineToolPlan, type TimelineToolPreview } from "./timeline-tool-edit";

/**
 * Speed/Duration for several clips at once (Premiere Clip > Speed/Duration).
 *
 * One planner covers the Speed/Duration dialog, the Rate Stretch tool on a
 * multi-selection and "Ripple Edit, Shifting Trailing Clips". With ripple on,
 * every clip that gets longer or shorter moves its trailing material on its
 * own track; unlocked sync-locked tracks open (or close) the same span, and
 * shrinking is blocked when a sync-locked track holds media inside the span it
 * would close, exactly like a ripple delete. Linked audio is expected in
 * `clipIds` (the caller expands link groups). The result is one plan, so one
 * undo step.
 */
const EPS = 1e-6;
const MIN_DURATION = 1e-3;

export interface ClipSpeedEdit {
  /** Absolute playback rate for every clip. */
  speed?: number;
  /** Absolute timeline duration for every clip (seconds). */
  duration?: number;
  /** Multiplies every clip's current duration (rate stretch of a selection). */
  durationScale?: number;
  reversed?: boolean;
  /** Maintain audio pitch while the rate changes. */
  maintainPitch?: boolean;
}
export interface ClipSpeedOptions {
  /** Ripple Edit, Shifting Trailing Clips. */
  ripple: boolean;
}

export const clampSpeed = (value: number): number =>
  Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));

/** The rate a clip would get from `edit`, or null when the edit leaves it alone. */
export function resolveClipRate(clip: Clip, edit: ClipSpeedEdit): number | null {
  const span = clip.outPoint - clip.inPoint;
  if (!(span > EPS)) return null;
  if (edit.speed != null) return clampSpeed(edit.speed);
  if (edit.duration != null) return clampSpeed(span / Math.max(MIN_DURATION, edit.duration));
  if (edit.durationScale != null)
    return clampSpeed(span / Math.max(MIN_DURATION, clip.duration * edit.durationScale));
  return null;
}

interface Change {
  trackId: string;
  before: Clip;
  after: Clip;
  delta: number;
}

export function planClipSpeedEdit(
  project: Project,
  clipIds: readonly string[],
  edit: ClipSpeedEdit,
  options: ClipSpeedOptions,
  operationId: string,
): TimelineToolPlan {
  const label = options.ripple ? "Speed/duration (ripple)" : "Speed/duration";
  for (const value of [edit.speed, edit.duration, edit.durationScale])
    if (value != null && (!Number.isFinite(value) || value <= 0))
      throw new Error("Speed and duration must be positive numbers.");
  const wanted = new Set(clipIds);
  const changes: Change[] = [];
  let found = 0;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (!wanted.has(clip.id)) continue;
      found++;
      if (track.locked) throw new Error("Unlock the target track before editing.");
      const rate = resolveClipRate(clip, edit);
      const retimes = rate != null;
      if (retimes && (clip.speedKeyframes?.length || clip.freezeFrames?.length))
        throw new Error("Remove speed ramps and freeze frames before changing speed or duration.");
      const duration = retimes ? (clip.outPoint - clip.inPoint) / rate : clip.duration;
      const next: Clip = {
        ...(resizeKeys(clip as Item, duration) as Clip),
        ...(retimes ? { speed: rate } : {}),
        ...(edit.reversed != null ? { reversed: edit.reversed } : {}),
        ...(edit.maintainPitch != null ? { pitchCorrection: edit.maintainPitch } : {}),
      };
      const same =
        Math.abs(next.duration - clip.duration) < EPS &&
        (next.speed ?? 1) === (clip.speed ?? 1) &&
        (next.reversed ?? false) === (clip.reversed ?? false) &&
        (next.pitchCorrection ?? true) === (clip.pitchCorrection ?? true);
      if (!same) changes.push({ trackId: track.id, before: clip, after: next, delta: next.duration - clip.duration });
    }
  }
  if (!found) throw new Error("Select at least one clip.");
  if (!changes.length) return { label, delta: 0, edits: [] };

  // Process right to left so shifting trailing clips never moves an earlier edit.
  changes.sort((a, b) => b.before.startTime - a.before.startTime);
  const retimed = changes.filter((c) => Math.abs(c.delta) > EPS);

  if (!options.ripple) {
    for (const c of retimed) {
      if (c.delta <= 0) continue;
      const track = project.timeline.tracks.find((t) => t.id === c.trackId)!;
      const end = c.before.startTime + c.before.duration;
      const newEnd = c.after.startTime + c.after.duration;
      const wall = track.clips.find(
        (o) => o.id !== c.before.id && o.startTime >= end - EPS && o.startTime < newEnd - EPS,
      );
      if (wall)
        throw new Error("The slower clip would overlap the next clip. Turn on ripple to shift trailing clips.");
    }
  }

  const editTracks = [...new Set(changes.map((c) => c.trackId))];
  const followers = options.ripple ? syncFollowerTrackIds(project, editTracks) : [];
  // Per group of overlapping (linked) clips, shared ripple data shifts once by
  // the amount every edit track really changed.
  const groups: { start: number; end: number; delta: number }[] = [];
  if (options.ripple) {
    for (const c of [...retimed].sort((a, b) => a.before.startTime - b.before.startTime)) {
      const start = c.before.startTime;
      const end = start + c.before.duration;
      const last = groups[groups.length - 1];
      if (last && start < last.end - EPS) {
        last.end = Math.max(last.end, end);
        last.delta = Math.sign(last.delta) === Math.sign(c.delta)
          ? Math.sign(c.delta) * Math.min(Math.abs(last.delta), Math.abs(c.delta))
          : 0;
      } else groups.push({ start, end, delta: c.delta });
    }
    for (const g of groups)
      if (g.delta < -EPS && followers.length)
        assertRangeEmptyOnTracks(project, followers, g.end + g.delta, g.end);
  }

  // One pass per concern, not one per clip: swapping in the new clips, then
  // shifting each edit track's trailing clips by every change in one sweep
  // (O(n log n) for n clips, the per-clip version was O(n^2)).
  const replacements = new Map<string, Clip>(changes.map((c) => [c.before.id, c.after]));
  let work: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t) =>
        editTracks.includes(t.id)
          ? { ...t, clips: t.clips.map((clip) => replacements.get(clip.id) ?? clip) }
          : t,
      ),
    },
  };
  if (options.ripple) {
    const stepsByTrack = new Map<string, ShiftStep[]>();
    for (const c of retimed) {
      const steps = stepsByTrack.get(c.trackId) ?? [];
      steps.push({ from: c.before.startTime + c.before.duration, delta: c.delta });
      stepsByTrack.set(c.trackId, steps);
    }
    for (const [trackId, steps] of stepsByTrack) work = shiftAfterBatch(work, [trackId], steps);
    const counter = { n: 0 };
    const moveCaptions = allTracksRipple(project, [...editTracks, ...followers]);
    const live = [...groups].reverse().filter((g) => Math.abs(g.delta) > EPS);
    // Follower splits happen in the original timeline (a clip straddling a
    // group's end is not moved by the groups to its right), then every
    // follower shifts in one sweep.
    if (followers.length) {
      for (const g of live) if (g.delta > 0) work = splitAt(work, followers, g.end, operationId, counter);
      work = shiftAfterBatch(work, followers, live.map((g) => ({ from: g.end, delta: g.delta })));
    }
    // Markers and captions: all gaps in one sweep, then all closed spans.
    work = openTimelineGaps(
      work,
      live.filter((g) => g.delta > 0).map((g) => ({ at: g.end, length: g.delta })),
      operationId,
      moveCaptions,
    );
    work = removeTimelineSpans(
      work,
      live.filter((g) => g.delta < 0).map((g) => ({ start: g.end + g.delta, stop: g.end })),
      moveCaptions,
    );
  }
  return diffPlan(project, pruneTransitions(work, project), label);
}

export interface MultiRateStretch {
  primaryId: string;
  /** Clips that stretch together (the selection plus linked partners). */
  clipIds: readonly string[];
  preview(delta: number): TimelineToolPreview;
  plan(delta: number, operationId: string): TimelineToolPlan;
}

/**
 * Rate Stretch on a multi-selection: dragging the primary clip's edge by
 * `delta` scales every selected clip's duration by the same factor and
 * ripples the trailing clips (sync lock and linked audio honoured). The scale
 * is bounded so no clip leaves the 0.1x to 20x range or drops under a frame.
 */
export function prepareMultiRateStretch(
  project: Project,
  options: {
    itemId: string;
    clipIds: readonly string[];
    edge: "left" | "right";
    /** Ripple trailing clips (default). Off, a clip may not grow into its neighbour. */
    ripple?: boolean;
  },
): MultiRateStretch {
  const ripple = options.ripple ?? true;
  const wanted = new Set([options.itemId, ...options.clipIds]);
  const clips: Clip[] = [];
  for (const track of project.timeline.tracks)
    for (const clip of track.clips) {
      if (!wanted.has(clip.id)) continue;
      if (track.locked) throw new Error("Unlock the affected tracks before editing.");
      if (clip.speedKeyframes?.length || clip.freezeFrames?.length)
        throw new Error("Remove speed ramps and freeze frames before rate stretching.");
      if (!(clip.outPoint - clip.inPoint > EPS))
        throw new Error("Rate stretch requires a video or audio source.");
      clips.push(clip);
    }
  const primary = clips.find((c) => c.id === options.itemId);
  if (!primary) throw new Error("This timeline item is no longer available.");
  const frame = 1 / Math.max(1, project.settings.frameRate || 30);
  let low = frame / primary.duration;
  let high = Infinity;
  for (const clip of clips) {
    const span = clip.outPoint - clip.inPoint;
    low = Math.max(low, span / SPEED_MAX / clip.duration);
    high = Math.min(high, span / SPEED_MIN / clip.duration);
  }
  if (!ripple) {
    // Without ripple nothing moves out of the way: a clip may grow only up to
    // the next clip on its track, selected or not.
    for (const track of project.timeline.tracks)
      for (const clip of clips) {
        if (clip.trackId !== track.id) continue;
        const wall = track.clips
          .filter((o) => o.id !== clip.id && o.startTime >= clip.startTime + clip.duration - EPS)
          .reduce<number>((min, o) => Math.min(min, o.startTime), Infinity);
        if (Number.isFinite(wall)) high = Math.min(high, (wall - clip.startTime) / clip.duration);
      }
  }
  const scaleFor = (delta: number) => {
    const raw = (primary.duration + (options.edge === "right" ? delta : -delta)) / primary.duration;
    const snapped = Math.round((raw * primary.duration) / frame) * frame / primary.duration;
    return Math.min(high, Math.max(low, snapped));
  };
  return {
    primaryId: primary.id,
    clipIds: clips.map((c) => c.id),
    preview(delta) {
      const scale = scaleFor(delta);
      const duration = primary.duration * scale;
      return {
        startTime: primary.startTime,
        duration,
        inPoint: primary.inPoint,
        outPoint: primary.outPoint,
        delta: options.edge === "right" ? duration - primary.duration : primary.duration - duration,
        speed: clampSpeed((primary.outPoint - primary.inPoint) / duration),
        // Every other clip stretching with the primary gets its own ghost.
        neighbors: clips
          .filter((c) => c.id !== primary.id)
          .map((c) => ({ trackId: c.trackId, startTime: c.startTime, duration: c.duration * scale })),
      };
    },
    plan(delta, operationId) {
      return planClipSpeedEdit(
        project,
        clips.map((c) => c.id),
        { durationScale: scaleFor(delta) },
        { ripple },
        operationId,
      );
    },
  };
}
