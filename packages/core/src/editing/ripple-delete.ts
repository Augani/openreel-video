import type { Clip, Project } from "../types";
import {
  diffPlan,
  pruneTransitions,
  removeTimelineSpan,
  shiftAfter,
  splitAt,
} from "./premiere-edits";
import {
  assertRangeEmptyOnTracks,
  syncFollowerTrackIds,
  trackSpans,
} from "./sync-lock";
import {
  applyTimelineToolEdits,
  type PreparedTimelineToolEdit,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

/**
 * Sync-lock aware ripple planners. Each result is one TimelineToolPlan, so
 * committing it is exactly one undo step. The rule for which tracks follow an
 * edit is documented in sync-lock.ts.
 */
const EPS = 1e-6;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function removeClipsById(work: Project, ids: ReadonlySet<string>): Project {
  const next: Mutable<Project> = {
    ...work,
    timeline: {
      ...work.timeline,
      tracks: work.timeline.tracks.map((track) =>
        track.clips.some((clip) => ids.has(clip.id))
          ? { ...track, clips: track.clips.filter((clip) => !ids.has(clip.id)) }
          : track,
      ),
    },
  };
  // Things attached to a removed clip go with it.
  if (next.nestedInstances?.some((item) => ids.has(item.id)))
    next.nestedInstances = next.nestedInstances.filter((item) => !ids.has(item.id));
  for (const field of ["masks", "particleEffects"] as const) {
    const items = (work[field] ?? []) as unknown as Array<{ clipId?: string }>;
    if (items.some((item) => item.clipId && ids.has(item.clipId)))
      Object.assign(next, {
        [field]: items.filter((item) => !(item.clipId && ids.has(item.clipId))),
      });
  }
  return next;
}

/** Disjoint, sorted union of ranges. */
function mergeRanges(
  ranges: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end - EPS) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Ripple delete clips. Each clip's own track closes up by that clip's length;
 * every other unlocked sync-locked track (not itself holding a deleted clip)
 * loses the same range if it is empty there and is otherwise a blocker. A
 * linked audio/video pair deleted together shifts the followers once.
 */
export function planRippleDelete(
  project: Project,
  clipIds: readonly string[],
  _operationId: string,
): TimelineToolPlan {
  return diffPlan(project, rippleDeleteWork(project, clipIds), "Ripple delete");
}

/** The scratch-project form of {@link planRippleDelete}, so composite edits
 * (silence cut) can chain several ripples and diff once. */
function rippleDeleteWork(project: Project, clipIds: readonly string[]): Project {
  if (!clipIds.length) throw new Error("There is nothing to delete.");
  const owners = new Map<string, Clip>();
  const trackOf = new Map<string, string>();
  for (const track of project.timeline.tracks)
    for (const clip of track.clips) {
      owners.set(clip.id, clip);
      trackOf.set(clip.id, track.id);
    }
  const clips = [...new Set(clipIds)].map((id) => {
    const clip = owners.get(id);
    if (!clip) throw new Error("The clip to delete no longer exists.");
    const track = project.timeline.tracks.find((t) => t.id === trackOf.get(id));
    if (track?.locked) throw new Error("Unlock the target track before editing.");
    return clip;
  });
  const editTracks = new Set(clips.map((clip) => trackOf.get(clip.id)!));
  const followers = syncFollowerTrackIds(project, editTracks);
  const end = (clip: Clip) => clip.startTime + clip.duration;

  // Everything is evaluated right to left so earlier ranges are unaffected by
  // the closing of later ones.
  let work = project;
  const intervals = mergeRanges(
    clips.map((clip) => ({ start: clip.startTime, end: end(clip) })),
  ).sort((a, b) => b.start - a.start);
  for (const interval of intervals) {
    if (followers.length)
      assertRangeEmptyOnTracks(work, followers, interval.start, interval.end);
  }
  const byStart = [...clips].sort((a, b) => b.startTime - a.startTime);
  for (const clip of byStart) {
    work = removeClipsById(work, new Set([clip.id]));
    work = shiftAfter(work, [trackOf.get(clip.id)!], end(clip), -clip.duration);
  }
  for (const interval of intervals)
    work = shiftAfter(
      work,
      followers,
      interval.end,
      -(interval.end - interval.start),
    );
  // Sequence markers ripple with the edit (range markers are trimmed, shortened
  // or dropped like in an extract). Captions stay where they are.
  for (const interval of intervals)
    work = removeTimelineSpan(work, interval.start, interval.end, false);
  return pruneTransitions(work, project);
}

/**
 * Cut silent sections out of one clip (Auto-Cut Silence). `regions` are
 * relative to the clip's start. Each region is split out and ripple deleted
 * exactly like a manual ripple delete, so every unlocked sync-locked track
 * closes the same ranges (or the whole edit is blocked). One plan = one undo.
 */
export function planSilenceCut(
  project: Project,
  clipId: string,
  regions: readonly { start: number; end: number }[],
  operationId: string,
): TimelineToolPlan {
  const owner = project.timeline.tracks.find((t) =>
    t.clips.some((c) => c.id === clipId),
  );
  const clip = owner?.clips.find((c) => c.id === clipId);
  if (!owner || !clip) throw new Error("Clip not found");
  if (owner.locked) throw new Error("Unlock the selected track before cutting silence.");
  const sorted = [...regions].sort((a, b) => b.start - a.start);
  for (const [index, region] of sorted.entries()) {
    if (
      !Number.isFinite(region.start) ||
      !Number.isFinite(region.end) ||
      region.start < 0 ||
      region.end <= region.start ||
      region.end > clip.duration + EPS
    )
      throw new Error("The clip changed. Re-analyze it before applying these cuts.");
    if (index > 0 && region.end > sorted[index - 1].start + EPS)
      throw new Error("The proposed cuts overlap. Re-analyze the clip before applying them.");
  }
  const counter = { n: 0 };
  let work = project;
  for (const region of sorted) {
    const start = clip.startTime + region.start;
    const end = clip.startTime + region.end;
    work = splitAt(work, [owner.id], end, operationId, counter);
    work = splitAt(work, [owner.id], start, operationId, counter);
    const doomed = work.timeline.tracks
      .find((t) => t.id === owner.id)!
      .clips.filter((c) => c.startTime >= start - EPS && c.startTime + c.duration <= end + EPS)
      .map((c) => c.id);
    if (!doomed.length) throw new Error("The selected clip changed. Re-analyze it before applying cuts.");
    work = rippleDeleteWork(work, doomed);
  }
  return diffPlan(project, work, "Cut silence");
}

/**
 * Remove Gaps: close every empty stretch on one track, including leading
 * space. Each gap is a close-gap, so every unlocked sync-locked track must be
 * empty over it (else the edit is blocked) and shifts with it.
 */
export function planRemoveGaps(
  project: Project,
  trackId: string,
  _operationId: string,
): TimelineToolPlan {
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("The target track no longer exists.");
  if (track.locked) throw new Error("Unlock the target track before editing.");
  const spans = mergeRanges(
    trackSpans(project, trackId).map((s) => ({ start: s.startTime, end: s.startTime + s.duration })),
  );
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start - cursor > EPS) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  const followers = syncFollowerTrackIds(project, [trackId]);
  let work = project;
  for (const gap of gaps.reverse()) {
    if (followers.length) assertRangeEmptyOnTracks(work, followers, gap.start, gap.end);
    work = shiftAfter(work, [trackId, ...followers], gap.end, -(gap.end - gap.start));
  }
  return diffPlan(project, work, "Remove gaps");
}

/** Close the gap in front of a clip on its own track (sync-lock aware). */
export function planCloseGapBeforeClip(
  project: Project,
  clipId: string,
  operationId: string,
): TimelineToolPlan {
  const track = project.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) throw new Error("Clip not found");
  const previousEnd = Math.max(
    0,
    ...track.clips
      .filter((c) => c.id !== clipId && c.startTime < clip.startTime)
      .map((c) => c.startTime + c.duration),
  );
  if (clip.startTime - previousEnd <= EPS) return { label: "Close gap", delta: 0, edits: [] };
  return planCloseGap(project, track.id, { start: previousEnd, end: clip.startTime }, operationId);
}

/**
 * Close a gap [start, end) on one track (Premiere's ripple delete of a gap).
 * The edit track must be empty there; every other unlocked sync-locked track
 * must be empty there too (otherwise blocked) and shifts with it.
 */
export function planCloseGap(
  project: Project,
  trackId: string,
  gap: { start: number; end: number },
  _operationId: string,
): TimelineToolPlan {
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("The target track no longer exists.");
  if (track.locked) throw new Error("Unlock the target track before editing.");
  if (!(gap.end - gap.start > EPS)) throw new Error("There is no gap to close.");
  const followers = syncFollowerTrackIds(project, [trackId]);
  assertRangeEmptyOnTracks(project, [trackId, ...followers], gap.start, gap.end);
  const work = shiftAfter(
    project,
    [trackId, ...followers],
    gap.end,
    -(gap.end - gap.start),
  );
  return diffPlan(project, work, "Close gap");
}

/**
 * Keep sync-locked tracks in step with a ripple trim. The base plan already
 * resizes the trimmed items and moves what follows them on their own tracks;
 * this extends it to the follower tracks: growing the clip opens a gap at the
 * cut (splitting what straddles it), shrinking it removes the same range,
 * which must be empty on the followers.
 */
export function withSyncLockedRipple(
  project: Project,
  prepared: PreparedTimelineToolEdit,
  cutTime: number,
  edge: "left" | "right",
): PreparedTimelineToolEdit {
  return {
    ...prepared,
    plan(delta: number): TimelineToolPlan {
      const base = prepared.plan(delta);
      if (!base.delta || !base.edits.length) return base;
      const change = edge === "left" ? -base.delta : base.delta;
      const editTracks = new Set(
        base.edits.map((edit) => edit.trackId).filter(Boolean),
      );
      const followers = syncFollowerTrackIds(project, editTracks);
      if (!followers.length) return base;
      if (change < 0)
        assertRangeEmptyOnTracks(project, followers, cutTime + change, cutTime);
      let work = applyTimelineToolEdits(project, base.edits);
      if (change > 0)
        work = splitAt(work, followers, cutTime, newOperationId(), { n: 0 });
      work = shiftAfter(work, followers, cutTime, change);
      const synced = diffPlan(project, work, base.label);
      return { ...synced, delta: base.delta };
    },
  };
}

function newOperationId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  return (
    cryptoApi?.randomUUID?.() ??
    `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
