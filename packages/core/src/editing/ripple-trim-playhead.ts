import type { Project } from "../types";
import {
  diffPlan,
  pruneTransitions,
  removeInside,
  removeTimelineSpan,
  shiftAfter,
  splitAt,
} from "./premiere-edits";
import { assertRangeEmptyOnTracks, syncFollowerTrackIds } from "./sync-lock";
import { collections, type TimelineToolPlan } from "./timeline-tool-edit";

/**
 * Ripple Trim Previous/Next Edit to Playhead (Premiere Q / W).
 *
 * For every item under the playhead on the chosen tracks, the part between the
 * item's start and the playhead (Q) or the playhead and its end (W) is removed
 * and the gap is closed on that track. Every other unlocked sync-locked track
 * must be empty over the removed range and closes it too (otherwise the whole
 * edit is blocked), exactly like a ripple delete. The cut goes through the
 * clip splitter, so source in/out points follow clip speed and reverse. The
 * result is one TimelineToolPlan, i.e. one undo step.
 */
const EPS = 1e-6;

export interface RippleTrimToPlayheadOptions {
  /** Explicit items to trim (media clips or overlays). They must be under the playhead. */
  itemIds?: readonly string[];
  /** Otherwise: every item under the playhead on these unlocked tracks. */
  trackIds?: readonly string[];
}

interface Target {
  trackId: string;
  start: number;
  end: number;
}

function findTargets(
  project: Project,
  time: number,
  options: RippleTrimToPlayheadOptions,
): Target[] {
  const wanted = options.itemIds ? new Set(options.itemIds) : null;
  // An explicit empty list means "no tracks"; only undefined means no filter.
  const tracks = options.trackIds ? new Set(options.trackIds) : null;
  const trackById = new Map(project.timeline.tracks.map((t) => [t.id, t]));
  const targets: Target[] = [];
  const consider = (item: {
    id: string;
    trackId?: string;
    startTime: number;
    duration: number;
  }) => {
    if (!item.trackId) return;
    if (wanted ? !wanted.has(item.id) : tracks && !tracks.has(item.trackId)) return;
    const track = trackById.get(item.trackId);
    if (!track) return;
    const end = item.startTime + item.duration;
    if (!(item.startTime < time - EPS && end > time + EPS)) return;
    if (track.locked) {
      // Explicitly named items on a locked track are an error; track-derived are skipped.
      if (wanted) throw new Error("Unlock the target track before editing.");
      return;
    }
    targets.push({ trackId: item.trackId, start: item.startTime, end });
  };
  for (const track of project.timeline.tracks)
    for (const clip of track.clips) consider({ ...clip, trackId: track.id });
  for (const field of Object.values(collections))
    for (const item of (project[field] ?? []) as unknown as Array<{
      id: string;
      trackId?: string;
      startTime: number;
      duration: number;
    }>)
      consider(item);
  return targets;
}

/**
 * Groups overlapping ranges (linked items on different tracks) and returns, per
 * group, the shortest range: followers and markers must shift by what every
 * edit track actually closed, never by the union. Right to left.
 */
function sharedRanges(
  ranges: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const groups: { end: number; shortest: { start: number; end: number } }[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = groups[groups.length - 1];
    if (last && r.start < last.end - EPS) {
      last.end = Math.max(last.end, r.end);
      if (r.end - r.start < last.shortest.end - last.shortest.start)
        last.shortest = { start: r.start, end: r.end };
    } else groups.push({ end: r.end, shortest: { start: r.start, end: r.end } });
  }
  return groups.map((g) => g.shortest).reverse();
}

export function planRippleTrimToPlayhead(
  project: Project,
  time: number,
  trimStart: boolean,
  options: RippleTrimToPlayheadOptions,
  operationId: string,
): TimelineToolPlan {
  const label = trimStart
    ? "Ripple trim previous edit to playhead"
    : "Ripple trim next edit to playhead";
  if (!Number.isFinite(time) || time < 0)
    throw new Error("The edit time must be a finite, non-negative number.");
  const targets = findTargets(project, time, options);
  if (!targets.length) return { label, delta: 0, edits: [] };

  const ranges = targets
    .map((t) => ({
      trackId: t.trackId,
      start: trimStart ? t.start : time,
      end: trimStart ? time : t.end,
    }))
    // Right to left, so closing a later range never moves an earlier one.
    .sort((a, b) => b.start - a.start);
  const editTracks = [...new Set(ranges.map((r) => r.trackId))];
  const followers = syncFollowerTrackIds(project, editTracks);
  if (followers.length)
    for (const r of ranges)
      assertRangeEmptyOnTracks(project, followers, r.start, r.end);

  const counter = { n: 0 };
  let work = splitAt(project, editTracks, time, operationId, counter);
  const reference = work;
  for (const r of ranges) {
    work = removeInside(work, [r.trackId], r.start, r.end);
    work = shiftAfter(work, [r.trackId], r.end, -(r.end - r.start));
  }
  // Linked items trim the same range: followers and markers close it once.
  for (const r of sharedRanges(ranges)) {
    work = shiftAfter(work, followers, r.end, -(r.end - r.start));
    work = removeTimelineSpan(work, r.start, r.end, false);
  }
  return diffPlan(project, pruneTransitions(work, reference), label);
}
