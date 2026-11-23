import { subclipRange } from "../media/bins";
import type {
  Clip,
  Marker,
  Project,
  Subtitle,
  Track,
  Transition,
} from "../types";
import type { MediaItem } from "../types/project";
import { SpeedEngine } from "../video/speed-engine";
import { prepareClipSplit } from "./clip-fragments";
import {
  applyTimelineToolEdits,
  collections,
  ownedCollections,
  resizeKeys,
  type Item,
  type TimelineToolItemEdit,
  type TimelineToolPlan,
} from "./timeline-tool-edit";
import {
  assertRangeEmptyOnTracks,
  isSyncLocked,
  syncFollowerTrackIds,
} from "./sync-lock";

/**
 * Premiere-style range edits (Add Edit, Lift, Extract, Insert, Overwrite).
 *
 * Every command is computed on a scratch copy of the project and returned as a
 * single TimelineToolPlan (the same shape ripple/slip/split use), so applying
 * it is one history entry. Splitting reuses prepareClipSplit, which preserves
 * source frames, fades, automation, keyframes, masks, particles and
 * transitions; only whole pieces are then removed or moved.
 */
const EPS = 1e-6;
const ADJACENT = 1e-3;

export interface ClipPlacement {
  trackId: string;
  clip: Clip;
  /** Start relative to the edit point (paste-insert keeps the copied spacing). */
  offset?: number;
}

/** A track to create in the same edit (and therefore the same undo step),
 * for placements whose `trackId` does not exist yet. */
export interface NewTrackPlacement {
  track: Track;
  /** Position in the track list; omitted means the end. */
  index?: number;
}

function withNewTracks(
  project: Project,
  newTracks: readonly NewTrackPlacement[] | undefined,
): Project {
  if (!newTracks?.length) return project;
  const tracks = [...project.timeline.tracks];
  for (const { track, index } of newTracks) {
    if (tracks.some((t) => t.id === track.id))
      throw new Error("The new track ID is already in use.");
    tracks.splice(index ?? tracks.length, 0, {
      ...track,
      clips: [],
      transitions: [],
    });
  }
  return { ...project, timeline: { ...project.timeline, tracks } };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Timed {
  id: string;
  trackId?: string;
  startTime: number;
  duration: number;
}
type Edit = TimelineToolItemEdit;

const end = (item: { startTime: number; duration: number }) =>
  item.startTime + item.duration;

function unlockedTrackIds(project: Project, ids?: readonly string[]): string[] {
  const allowed = ids ? new Set(ids) : null;
  return project.timeline.tracks
    .filter((track) => !track.locked && (!allowed || allowed.has(track.id)))
    .map((track) => track.id);
}

function assertTime(...values: number[]) {
  for (const value of values)
    if (!Number.isFinite(value) || value < 0)
      throw new Error("The edit time must be a finite, non-negative number.");
}

/** Split every clip of the given tracks that straddles `time`. */
/** @internal shared with the sync-lock ripple planners. */
export function splitAt(
  work: Project,
  trackIds: readonly string[],
  time: number,
  operationId: string,
  counter: { n: number },
): Project {
  let current = work;
  for (const trackId of trackIds) {
    const track = current.timeline.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    for (const clip of track.clips) {
      if (clip.startTime < time - EPS && end(clip) > time + EPS) {
        const plan = prepareClipSplit(
          current,
          clip.id,
          time,
          `${operationId}:${counter.n++}`,
        );
        current = applyTimelineToolEdits(current, plan.edits);
      }
    }
  }
  return splitOverlays(current, trackIds, time, operationId, counter);
}

/** Split text/shape/graphics/adjustment/motion items that straddle `time`.
 * The left piece keeps the original ID; the right piece is a copy with a
 * fresh ID, so undo (which records both) restores the original item. */
function splitOverlays(
  work: Project,
  trackIds: readonly string[],
  time: number,
  operationId: string,
  counter: { n: number },
): Project {
  const tracks = new Set(trackIds);
  let next: Mutable<Project> | null = null;
  for (const field of Object.values(collections)) {
    const items = (work[field] ?? []) as unknown as Item[];
    if (
      !items.some(
        (item) =>
          tracks.has(item.trackId) &&
          item.startTime < time - EPS &&
          end(item) > time + EPS,
      )
    )
      continue;
    const result: Item[] = [];
    for (const item of items) {
      if (
        !tracks.has(item.trackId) ||
        item.startTime >= time - EPS ||
        end(item) <= time + EPS
      ) {
        result.push(item);
        continue;
      }
      const offset = time - item.startTime;
      const right = resizeKeys(
        {
          ...structuredClone(item),
          id: `${item.id.slice(0, 48)}:split:${operationId}:${counter.n++}`,
          startTime: time,
        },
        item.duration - offset,
      );
      result.push(resizeKeys(item, offset), right);
    }
    next = { ...(next ?? work), [field]: result };
  }
  return next ?? work;
}

/** Map a time through the removal of [start, stop). */
function collapse(time: number, start: number, stop: number): number {
  if (time <= start) return time;
  return time >= stop ? time - (stop - start) : start;
}

function remapWords(
  subtitle: Subtitle,
  map: (time: number) => number,
): Partial<Pick<Subtitle, "words" | "text">> {
  if (!subtitle.words) return {};
  const words = subtitle.words
    .map((word) => ({
      ...word,
      startTime: map(word.startTime),
      endTime: map(word.endTime),
    }))
    .filter((word) => word.endTime - word.startTime > EPS);
  const changed = words.length !== subtitle.words.length;
  return {
    words,
    ...(changed && words.length
      ? { text: words.map((word) => word.text).join(" ") }
      : {}),
  };
}

/** True when every track of the project takes part in the ripple, so
 * sequence-wide data (captions) can ripple with it without desyncing a track. */
export const allTracksRipple = (
  project: Project,
  rippled: readonly string[],
): boolean => {
  const set = new Set(rippled);
  return project.timeline.tracks.every((track) => set.has(track.id));
};

/** Close [start, stop) for one marker. A point marker inside the span is
 * dropped; later ones move earlier. A range marker is trimmed where it
 * overlaps the span, shortened when it spans it, and dropped when it lies
 * wholly inside it. */
function closeMarker(marker: Marker, start: number, stop: number): Marker[] {
  const duration = marker.duration ?? 0;
  const end = marker.time + duration;
  if (duration <= EPS) {
    if (marker.time < start - EPS) return [marker];
    if (marker.time >= stop - EPS) return [{ ...marker, time: collapse(marker.time, start, stop) }];
    return [];
  }
  if (end <= start + EPS) return [marker];
  if (marker.time >= stop - EPS) return [{ ...marker, time: collapse(marker.time, start, stop) }];
  if (marker.time >= start - EPS && end <= stop + EPS) return [];
  const newTime = Math.min(marker.time, start);
  const newEnd = end > stop + EPS ? collapse(end, start, stop) : start;
  return [{ ...marker, time: newTime, duration: newEnd - newTime }];
}

/** Close [start, stop) in markers and subtitles: markers inside it are
 * dropped, later ones move earlier, captions are trimmed like clips. When
 * `moveCaptions` is false (a locked track would desync) only the sequence
 * markers ripple and captions stay where they are, as in Premiere. */
export function removeTimelineSpan(
  work: Project,
  start: number,
  stop: number,
  moveCaptions = true,
): Project {
  const markers = work.timeline.markers.flatMap((marker): Marker[] =>
    closeMarker(marker, start, stop),
  );
  const subtitles = !moveCaptions ? work.timeline.subtitles : work.timeline.subtitles.flatMap((subtitle) => {
    const map = (time: number) => collapse(time, start, stop);
    const startTime = map(subtitle.startTime),
      endTime = map(subtitle.endTime);
    if (endTime - startTime <= EPS) return [];
    return [
      {
        ...subtitle,
        startTime,
        endTime,
        ...remapWords(subtitle, map),
      } as Subtitle,
    ];
  });
  return { ...work, timeline: { ...work.timeline, markers, subtitles } };
}

/** Open a gap of `length` at `at` in markers and subtitles. A caption that
 * straddles `at` becomes two captions, like a clip does. */
export function openTimelineGap(
  work: Project,
  at: number,
  length: number,
  operationId: string,
  moveCaptions = true,
): Project {
  const markers: Marker[] = work.timeline.markers.map((marker) => {
    if (marker.time >= at - EPS) return { ...marker, time: marker.time + length };
    // A range marker spanning the gap stretches over it.
    if (marker.duration && marker.time + marker.duration > at + EPS)
      return { ...marker, duration: marker.duration + length };
    return marker;
  });
  const subtitles: Subtitle[] = !moveCaptions ? work.timeline.subtitles : work.timeline.subtitles.flatMap((subtitle) => {
    if (subtitle.endTime <= at + EPS) return [subtitle];
    if (subtitle.startTime >= at - EPS)
      return [
        {
          ...subtitle,
          startTime: subtitle.startTime + length,
          endTime: subtitle.endTime + length,
          ...(subtitle.words
            ? {
                words: subtitle.words.map((word) => ({
                  ...word,
                  startTime: word.startTime + length,
                  endTime: word.endTime + length,
                })),
              }
            : {}),
        },
      ];
    // Word-timed captions split at the word nearest `at`. Untimed captions
    // split their text proportionally to where `at` falls in their duration,
    // so no text is ever shown on both sides. A side that would get no text is
    // dropped: the whole caption stays, trimmed, on the other side.
    const words = subtitle.words?.length ? subtitle.words : undefined;
    const tokens = words
      ? null
      : subtitle.text.split(/\s+/).filter(Boolean);
    let before = words?.filter(
      (word) => (word.startTime + word.endTime) / 2 < at,
    );
    let after = words?.filter(
      (word) => (word.startTime + word.endTime) / 2 >= at,
    );
    let leftText: string | null = null;
    let rightText: string | null = null;
    if (tokens) {
      const fraction =
        (at - subtitle.startTime) / (subtitle.endTime - subtitle.startTime);
      const cut = Math.min(
        tokens.length,
        Math.max(0, Math.round(tokens.length * fraction)),
      );
      // One token (or a cut at either end) cannot be divided: it stays whole
      // on the side holding most of its time.
      const keepLeft =
        tokens.length < 2 || cut === 0 || cut === tokens.length
          ? fraction >= 0.5
          : null;
      if (keepLeft === true) leftText = subtitle.text;
      else if (keepLeft === false) rightText = subtitle.text;
      else {
        leftText = tokens.slice(0, cut).join(" ");
        rightText = tokens.slice(cut).join(" ");
      }
    } else {
      if (!before?.length) before = undefined;
      if (!after?.length) after = undefined;
    }
    const hasLeft = tokens ? leftText !== null : !!before;
    const hasRight = tokens ? rightText !== null : !!after;
    const result: Subtitle[] = [];
    if (hasLeft)
      result.push({
        ...subtitle,
        endTime: at,
        ...(before
          ? {
              words: before.map((word) => ({
                ...word,
                endTime: Math.min(word.endTime, at),
              })),
              text: before.map((word) => word.text).join(" "),
            }
          : { text: leftText ?? subtitle.text }),
      });
    if (hasRight)
      result.push({
        ...subtitle,
        id: hasLeft
          ? `${subtitle.id.slice(0, 48)}:split:${operationId}`
          : subtitle.id,
        startTime: at + length,
        endTime: subtitle.endTime + length,
        ...(after
          ? {
              words: after.map((word) => ({
                ...word,
                startTime: Math.max(word.startTime, at) + length,
                endTime: word.endTime + length,
              })),
              text: after.map((word) => word.text).join(" "),
            }
          : { text: rightText ?? subtitle.text }),
      });
    return result;
  });
  return { ...work, timeline: { ...work.timeline, markers, subtitles } };
}

/** Index of the first value in ascending `values` that is greater than `x`. */
function upperBound(values: readonly number[], x: number): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Several {@link removeTimelineSpan} calls (right to left over disjoint ranges)
 * in one pass over markers and captions, O((markers + captions) log ranges).
 */
export function removeTimelineSpans(
  work: Project,
  ranges: readonly { start: number; stop: number }[],
  moveCaptions = true,
): Project {
  if (!ranges.length) return work;
  const asc = [...ranges].sort((a, b) => a.start - b.start);
  const stops = asc.map((r) => r.stop - EPS);
  const starts = asc.map((r) => r.start);
  const prefix: number[] = [0];
  for (const r of asc) prefix.push(prefix[prefix.length - 1] + (r.stop - r.start));
  /** Ranges that end at or before `time` all shift it by their whole length. */
  const mapTime = (time: number): number => {
    const done = upperBound(stops, time); // ranges with stop - EPS <= time
    const shift = prefix[done];
    const next = asc[done];
    if (next && time > next.start && time < next.stop - EPS) return next.start - shift;
    return time - shift;
  };
  const markers = work.timeline.markers.flatMap((marker): Marker[] => {
    // Ranges wholly left of the marker only shift it; the few that touch it
    // are applied right to left with the single-range rule.
    const left = upperBound(stops, marker.time);
    const reach = upperBound(starts, marker.time + (marker.duration ?? 0) + EPS);
    let current: Marker[] = [marker];
    for (let i = reach - 1; i >= left; i--)
      current = current.flatMap((m) => closeMarker(m, asc[i].start, asc[i].stop));
    const shift = prefix[left];
    return shift === 0 ? current : current.map((m) => ({ ...m, time: m.time - shift }));
  });
  const subtitles = !moveCaptions
    ? work.timeline.subtitles
    : work.timeline.subtitles.flatMap((subtitle) => {
        const startTime = mapTime(subtitle.startTime),
          endTime = mapTime(subtitle.endTime);
        if (endTime - startTime <= EPS) return [];
        if (startTime === subtitle.startTime && endTime === subtitle.endTime && !subtitle.words)
          return [subtitle];
        return [{ ...subtitle, startTime, endTime, ...remapWords(subtitle, mapTime) } as Subtitle];
      });
  return { ...work, timeline: { ...work.timeline, markers, subtitles } };
}

/**
 * Several {@link openTimelineGap} calls (right to left over disjoint gaps).
 * Markers and captions that do not straddle a gap are shifted in one pass; a
 * caption that does straddle one is split, which keeps the sequential path.
 */
export function openTimelineGaps(
  work: Project,
  gaps: readonly { at: number; length: number }[],
  operationId: string,
  moveCaptions = true,
): Project {
  if (!gaps.length) return work;
  const asc = [...gaps].sort((a, b) => a.at - b.at);
  const ats = asc.map((g) => g.at);
  const prefix: number[] = [0];
  for (const g of asc) prefix.push(prefix[prefix.length - 1] + g.length);
  const straddled =
    moveCaptions &&
    work.timeline.subtitles.some((subtitle) => {
      // Any gap with subtitle.startTime < at - EPS and at < endTime - EPS splits it.
      const first = upperBound(ats, subtitle.startTime + EPS);
      return first < asc.length && asc[first].at < subtitle.endTime - EPS;
    });
  if (straddled) {
    let sequential = work;
    for (const g of [...asc].reverse())
      sequential = openTimelineGap(sequential, g.at, g.length, operationId, moveCaptions);
    return sequential;
  }
  const markers = work.timeline.markers.map((marker) => {
    const shiftIndex = upperBound(ats, marker.time + EPS); // gaps with at <= time + EPS
    const shift = prefix[shiftIndex];
    let duration = marker.duration;
    if (duration) {
      // A range marker spanning gaps (at > time + EPS and at < end - EPS) stretches over them.
      const stretched = upperBound(ats, marker.time + duration - EPS) - shiftIndex;
      if (stretched > 0)
        duration += prefix[shiftIndex + stretched] - prefix[shiftIndex];
    }
    return shift === 0 && duration === marker.duration
      ? marker
      : { ...marker, time: marker.time + shift, ...(duration !== undefined ? { duration } : {}) };
  });
  const subtitles = !moveCaptions
    ? work.timeline.subtitles
    : work.timeline.subtitles.map((subtitle) => {
        const shift = prefix[upperBound(ats, subtitle.startTime + EPS)];
        if (shift === 0) return subtitle;
        return {
          ...subtitle,
          startTime: subtitle.startTime + shift,
          endTime: subtitle.endTime + shift,
          ...(subtitle.words
            ? {
                words: subtitle.words.map((word) => ({
                  ...word,
                  startTime: word.startTime + shift,
                  endTime: word.endTime + shift,
                })),
              }
            : {}),
        };
      });
  return { ...work, timeline: { ...work.timeline, markers, subtitles } };
}

interface OwnedItem {
  id: string;
  clipId?: string;
}

/** Drop media clips (and everything attached to them) fully inside a range. */
/** @internal shared with the sync-lock ripple planners. */
export function removeInside(
  work: Project,
  trackIds: readonly string[],
  start: number,
  stop: number,
): Project {
  const tracks = new Set(trackIds);
  const inside = (item: Timed) =>
    item.startTime >= start - EPS && end(item) <= stop + EPS;
  const removed = new Set<string>();
  const next: Mutable<Project> = {
    ...work,
    timeline: {
      ...work.timeline,
      tracks: work.timeline.tracks.map((track) => {
        if (!tracks.has(track.id)) return track;
        const clips = track.clips.filter((clip) => {
          if (!inside(clip)) return true;
          removed.add(clip.id);
          return false;
        });
        return clips.length === track.clips.length
          ? track
          : { ...track, clips };
      }),
    },
  };
  for (const field of Object.values(collections)) {
    const items = (work[field] ?? []) as unknown as Timed[];
    const kept = items.filter((item) => {
      if (!item.trackId || !tracks.has(item.trackId) || !inside(item))
        return true;
      removed.add(item.id);
      return false;
    });
    if (kept.length !== items.length) Object.assign(next, { [field]: kept });
  }
  if (next.nestedInstances)
    next.nestedInstances = next.nestedInstances.filter(
      (item) => !removed.has(item.id),
    );
  for (const field of ["masks", "particleEffects"] as const) {
    const items = (work[field] ?? []) as unknown as OwnedItem[];
    if (items.some((item) => item.clipId && removed.has(item.clipId)))
      Object.assign(next, {
        [field]: items.filter(
          (item) => !(item.clipId && removed.has(item.clipId)),
        ),
      });
  }
  return next;
}

/** Move everything starting at/after `from` on the given tracks by `delta`. */
/** @internal shared with the sync-lock ripple planners. */
export function shiftAfter(
  work: Project,
  trackIds: readonly string[],
  from: number,
  delta: number,
): Project {
  return shiftAfterBatch(work, trackIds, [{ from, delta }]);
}

export interface ShiftStep {
  from: number;
  delta: number;
}

/**
 * Several {@link shiftAfter} steps in one pass over the project. Each step
 * moves everything starting at/after its `from` by its `delta`; `from` values
 * are in the ORIGINAL timeline (before any step), and the steps must be
 * disjoint ripples (every step's span lies before the next step's `from`), as
 * a right-to-left sequence of ripple edits is. An item then moves by the sum
 * of the deltas of all steps whose `from` is at or before its start. That is
 * O(items log steps) instead of O(items x steps) for N sequential calls.
 */
export function shiftAfterBatch(
  work: Project,
  trackIds: readonly string[],
  steps: readonly ShiftStep[],
): Project {
  const tracks = new Set(trackIds);
  const sorted = [...steps].sort((a, b) => a.from - b.from);
  if (!sorted.length || !tracks.size) return work;
  const froms = sorted.map((s) => s.from - EPS);
  const prefix: number[] = [];
  let sum = 0;
  for (const step of sorted) prefix.push((sum += step.delta));
  /** Offset for an item starting at `time`, or null when no step applies. */
  const offsetAt = (time: number): number | null => {
    let lo = 0,
      hi = froms.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (froms[mid] <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? null : prefix[lo - 1];
  };
  const moved = new Map<string, number>();
  const shiftItem = <T extends Timed>(item: T): T => {
    const offset = offsetAt(item.startTime);
    if (offset === null) return item;
    const startTime = Math.max(0, item.startTime + offset);
    moved.set(item.id, offset);
    return { ...item, startTime };
  };
  const next: Mutable<Project> = {
    ...work,
    timeline: {
      ...work.timeline,
      tracks: work.timeline.tracks.map((track) => {
        if (!tracks.has(track.id)) return track;
        let changed = false;
        const clips = track.clips.map((clip) => {
          const result = shiftItem(clip);
          if (result !== clip) changed = true;
          return result;
        });
        return changed ? { ...track, clips } : track;
      }),
    },
  };
  for (const field of Object.values(collections)) {
    const items = (work[field] ?? []) as unknown as Timed[];
    if (!items.some((item) => item.trackId && tracks.has(item.trackId))) continue;
    let changed = false;
    const shifted = items.map((item) => {
      if (!item.trackId || !tracks.has(item.trackId)) return item;
      const result = shiftItem(item);
      if (result !== item) changed = true;
      return result;
    });
    if (changed) Object.assign(next, { [field]: shifted });
  }
  if (next.nestedInstances?.some((item) => moved.has(item.id)))
    next.nestedInstances = next.nestedInstances.map((item) =>
      moved.has(item.id)
        ? { ...item, startTime: Math.max(0, item.startTime + moved.get(item.id)!) }
        : item,
    );
  if (next.particleEffects?.some((effect) => moved.has(effect.clipId)))
    next.particleEffects = next.particleEffects.map((effect) =>
      moved.has(effect.clipId) && typeof effect.clipStartTime === "number"
        ? { ...effect, clipStartTime: Math.max(0, effect.clipStartTime + moved.get(effect.clipId)!) }
        : effect,
    );
  return next;
}

function adjacent(a: Clip | undefined, b: Clip | undefined) {
  return !!a && !!b && Math.abs(end(a) - b.startTime) <= ADJACENT;
}

/** Remove transitions whose clip is gone, or whose pair was adjacent before
 * the edit (`reference`) but is not any more. Undo restores them because the
 * plan records each removed transition. */
/** @internal shared with the sync-lock ripple planners. */
export function pruneTransitions(work: Project, reference: Project): Project {
  const referenceTracks = new Map(
    reference.timeline.tracks.map((track) => [track.id, track]),
  );
  return {
    ...work,
    timeline: {
      ...work.timeline,
      tracks: work.timeline.tracks.map((track) => {
        const before = referenceTracks.get(track.id);
        const clips = new Map(track.clips.map((clip) => [clip.id, clip]));
        const previous = new Map(
          (before?.clips ?? []).map((clip) => [clip.id, clip]),
        );
        const transitions = track.transitions.filter((t: Transition) => {
          const a = clips.get(t.clipAId);
          if (!a) return false;
          if (t.clipBId === undefined) return true;
          const b = clips.get(t.clipBId);
          if (!b) return false;
          return (
            adjacent(a, b) ||
            !adjacent(previous.get(t.clipAId), previous.get(t.clipBId))
          );
        });
        return transitions.length === track.transitions.length
          ? track
          : { ...track, transitions };
      }),
    },
  };
}

export function addClips(
  work: Project,
  placements: readonly ClipPlacement[],
  at: number,
): Project {
  return {
    ...work,
    timeline: {
      ...work.timeline,
      tracks: work.timeline.tracks.map((track) => {
        const added = placements.filter((p) => p.trackId === track.id);
        if (!added.length) return track;
        const clips = [...track.clips];
        for (const { clip, offset } of added) {
          const placed = { ...clip, trackId: track.id, startTime: at + (offset ?? 0) };
          let index = clips.length;
          while (index > 0 && clips[index - 1].startTime > placed.startTime)
            index--;
          clips.splice(index, 0, placed);
        }
        return { ...track, clips };
      }),
    },
  };
}

function same(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function diffList<T extends { id: string }>(
  kind: Edit["kind"],
  trackOf: (item: T) => string | undefined,
  before: readonly T[] | undefined,
  after: readonly T[] | undefined,
): Edit[] {
  const edits: Edit[] = [];
  const oldItems = before ?? [],
    newItems = after ?? [];
  const afterById = new Map(newItems.map((item) => [item.id, item]));
  const beforeIds = new Set(oldItems.map((item) => item.id));
  oldItems.forEach((item, index) => {
    const next = afterById.get(item.id) ?? null;
    if (next && same(item, next)) return;
    edits.push({
      kind,
      id: item.id,
      trackId: trackOf(item) ?? "",
      index,
      before: item as unknown as Edit["before"],
      after: next as unknown as Edit["after"],
    });
  });
  newItems.forEach((item, index) => {
    if (beforeIds.has(item.id)) return;
    edits.push({
      kind,
      id: item.id,
      trackId: trackOf(item) ?? "",
      index,
      before: null,
      after: item as unknown as Edit["after"],
    });
  });
  return edits;
}

/** Express the difference between two projects as one edit plan. */
/** @internal shared with the sync-lock ripple planners. */
export function diffPlan(
  original: Project,
  work: Project,
  label: string,
): TimelineToolPlan {
  const edits: Edit[] = [];
  const ownerTrack = new Map<string, string>();
  for (const project of [original, work])
    for (const track of project.timeline.tracks)
      for (const clip of track.clips) ownerTrack.set(clip.id, track.id);
  work.timeline.tracks.forEach((track, index) => {
    if (original.timeline.tracks.some((t) => t.id === track.id)) return;
    edits.push({
      kind: "track",
      id: track.id,
      trackId: track.id,
      index,
      before: null,
      after: { ...track, clips: [], transitions: [] },
    });
  });
  for (const [kind, field] of [
    ["marker", "markers"],
    ["subtitle", "subtitles"],
  ] as const)
    edits.push(
      ...diffList<{ id: string }>(
        kind,
        () => undefined,
        original.timeline[field] as never,
        work.timeline[field] as never,
      ),
    );
  for (const track of work.timeline.tracks) {
    const old = original.timeline.tracks.find((t) => t.id === track.id);
    edits.push(
      ...diffList("media", () => track.id, old?.clips, track.clips),
      ...diffList(
        "transition",
        () => track.id,
        old?.transitions,
        track.transitions,
      ),
    );
  }
  for (const [kind, field] of Object.entries(collections))
    edits.push(
      ...diffList<{ id: string; trackId?: string }>(
        kind as Edit["kind"],
        (item) => item.trackId,
        original[field] as never,
        work[field] as never,
      ),
    );
  for (const [kind, field] of Object.entries(ownedCollections))
    edits.push(
      ...diffList<{ id: string; trackId?: string; clipId?: string }>(
        kind as Edit["kind"],
        (item) =>
          item.trackId ?? (item.clipId ? ownerTrack.get(item.clipId) : undefined),
        original[field] as never,
        work[field] as never,
      ),
    );
  return { label, delta: 0, edits };
}

function requireUnlocked(project: Project, trackId: string): Track {
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error("The target track no longer exists.");
  if (track.locked) throw new Error("Unlock the target track before editing.");
  return track;
}

function validRange(range: { start: number; end: number }) {
  assertTime(range.start, range.end);
  if (range.end - range.start <= EPS)
    throw new Error("The In/Out range must have a positive duration.");
}

/** Split every clip under `time` on all unlocked tracks (one plan). */
export function planAddEditToAllTracks(
  project: Project,
  time: number,
  operationId: string,
): TimelineToolPlan {
  assertTime(time);
  const work = splitAt(project, unlockedTrackIds(project), time, operationId, {
    n: 0,
  });
  return diffPlan(project, work, "Add edit to all tracks");
}

/** Split every clip under `time` on the given unlocked tracks (Add Edit on the
 * targeted tracks). An empty or missing list means every unlocked track. */
export function planAddEdit(
  project: Project,
  time: number,
  operationId: string,
  trackIds?: readonly string[],
): TimelineToolPlan {
  assertTime(time);
  const tracks = unlockedTrackIds(
    project,
    trackIds?.length ? trackIds : undefined,
  );
  const work = splitAt(project, tracks, time, operationId, { n: 0 });
  return diffPlan(project, work, "Add edit");
}

function removeRange(
  project: Project,
  range: { start: number; end: number },
  operationId: string,
  ripple: boolean,
  trackIds?: readonly string[],
): Project {
  validRange(range);
  // Lift only cuts; Extract also ripples. Without explicit tracks Extract cuts
  // through every unlocked sync-locked track (a track with Sync Lock off is left
  // alone, like Premiere); with explicit tracks (the targeted ones) every other
  // sync-locked track is a follower: its range must be empty and it shifts.
  const tracks = ripple && !trackIds
    ? project.timeline.tracks
        .filter((track) => !track.locked && isSyncLocked(track))
        .map((track) => track.id)
    : unlockedTrackIds(project, trackIds);
  const followers =
    ripple && trackIds ? syncFollowerTrackIds(project, tracks) : [];
  if (followers.length)
    assertRangeEmptyOnTracks(project, followers, range.start, range.end);
  const counter = { n: 0 };
  let work = splitAt(project, tracks, range.start, operationId, counter);
  work = splitAt(work, tracks, range.end, operationId, counter);
  const reference = work;
  work = removeInside(work, tracks, range.start, range.end);
  if (ripple) {
    work = shiftAfter(
      work,
      [...tracks, ...followers],
      range.end,
      -(range.end - range.start),
    );
    // Markers and captions belong to the whole sequence: they ripple only
    // when every track does. If a locked (or sync-off) track would be desynced,
    // only the sequence markers ripple; captions stay put (Premiere behaviour).
    if (!trackIds)
      work = removeTimelineSpan(
        work,
        range.start,
        range.end,
        allTracksRipple(project, tracks),
      );
  }
  return pruneTransitions(work, reference);
}

/** Remove the range's contents without closing the gap. */
export function planLift(
  project: Project,
  range: { start: number; end: number },
  operationId: string,
  trackIds?: readonly string[],
): TimelineToolPlan {
  return diffPlan(
    project,
    removeRange(project, range, operationId, false, trackIds),
    "Lift",
  );
}

/** Remove the range's contents and close the gap on the same tracks. */
export function planExtract(
  project: Project,
  range: { start: number; end: number },
  operationId: string,
  trackIds?: readonly string[],
): TimelineToolPlan {
  return diffPlan(
    project,
    removeRange(project, range, operationId, true, trackIds),
    "Extract",
  );
}

function checkPlacements(
  project: Project,
  placements: readonly ClipPlacement[],
) {
  if (!placements.length) throw new Error("There is nothing to place.");
  const ids = new Set(
    project.timeline.tracks.flatMap((track) => track.clips.map((c) => c.id)),
  );
  for (const { trackId, clip } of placements) {
    requireUnlocked(project, trackId);
    if (clip.duration <= EPS || ids.has(clip.id))
      throw new Error("The clip to place is invalid.");
    ids.add(clip.id);
  }
}

/** Place clips at `at`, rippling later by their length: the destination tracks
 * and every other unlocked sync-locked track split at `at` and shift (see
 * sync-lock.ts); tracks with Sync Lock off stay put. */
export function planInsert(
  project: Project,
  at: number,
  placements: readonly ClipPlacement[],
  operationId: string,
  newTracks?: readonly NewTrackPlacement[],
): TimelineToolPlan {
  assertTime(at);
  const base = withNewTracks(project, newTracks);
  checkPlacements(base, placements);
  const destinations = new Set(placements.map((p) => p.trackId));
  const tracks = base.timeline.tracks
    .filter(
      (track) =>
        !track.locked && (destinations.has(track.id) || isSyncLocked(track)),
    )
    .map((track) => track.id);
  const length = Math.max(
    ...placements.map((p) => (p.offset ?? 0) + p.clip.duration),
  );
  let work = splitAt(base, tracks, at, operationId, { n: 0 });
  const reference = work;
  work = shiftAfter(work, tracks, at, length);
  work = openTimelineGap(work, at, length, operationId, allTracksRipple(base, tracks));
  work = pruneTransitions(work, reference);
  work = addClips(work, placements, at);
  return diffPlan(project, work, "Insert");
}

/** Place clips at `at`, replacing whatever they cover on their own tracks. */
export function planOverwrite(
  project: Project,
  at: number,
  placements: readonly ClipPlacement[],
  operationId: string,
  newTracks?: readonly NewTrackPlacement[],
): TimelineToolPlan {
  assertTime(at);
  const base = withNewTracks(project, newTracks);
  checkPlacements(base, placements);
  const counter = { n: 0 };
  let work = base;
  for (const placement of placements) {
    const tracks = [placement.trackId];
    work = splitAt(work, tracks, at, operationId, counter);
    work = splitAt(work, tracks, at + placement.clip.duration, operationId, counter);
  }
  const reference = work;
  for (const placement of placements)
    work = removeInside(
      work,
      [placement.trackId],
      at,
      at + placement.clip.duration,
    );
  work = pruneTransitions(work, reference);
  work = addClips(work, placements, at);
  return diffPlan(project, work, "Overwrite");
}

/** A new clip for library media, taking the same defaults as clip/add. */
export function createMediaClip(
  media: MediaItem,
  trackId: string,
  id: string,
  range?: { inPoint: number; outPoint: number },
): Clip {
  const source = media.metadata.duration > 0 ? media.metadata.duration : 5;
  const window = subclipRange(media);
  const inPoint = Math.max(0, Math.min(source, range?.inPoint ?? window?.start ?? 0));
  const outPoint = Math.max(
    inPoint,
    Math.min(source, range?.outPoint ?? window?.end ?? source),
  );
  if (outPoint - inPoint <= EPS)
    throw new Error("The selected media has no duration.");
  return {
    id,
    mediaId: media.id,
    trackId,
    startTime: 0,
    duration: outPoint - inPoint,
    inPoint,
    outPoint,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      fitMode: "contain",
    },
    volume: 1,
    keyframes: [],
  };
}

/**
 * The track Insert/Overwrite should target when none is named: the main
 * sequence track. Tracks composite from the first (top) to the last, so the
 * base video layer (V1) is the LAST unlocked video track, not the first; a
 * track named "Main"/"V1"/"A1" always wins. Audio has no layering, so it
 * defaults to the first unlocked audio track.
 */
export function findMainTrack(
  project: Project,
  type: Track["type"],
): Track | null {
  const ofType = project.timeline.tracks.filter((track) => track.type === type);
  const named = ofType.find((track) => /^(main|v1|a1)$/i.test(track.name.trim()));
  // An explicitly named main track that is locked is not silently replaced by
  // an overlay lane: the caller reports that the main track is unavailable.
  if (named) return named.locked ? null : named;
  const candidates = ofType.filter((track) => !track.locked);
  if (!candidates.length) return null;
  return type === "video" || type === "image"
    ? candidates[candidates.length - 1]
    : candidates[0];
}

/** Topmost visible video/image clip under `time` (lower track index is on top). */
export function findTopmostVisualClipAt(
  project: Project,
  time: number,
  trackIds?: readonly string[],
): Clip | null {
  const only = trackIds?.length ? new Set(trackIds) : null;
  for (const track of project.timeline.tracks) {
    if ((track.type !== "video" && track.type !== "image") || track.hidden)
      continue;
    if (only && !only.has(track.id)) continue;
    const clip = track.clips.find(
      (c) => c.startTime <= time + EPS && time < end(c) - EPS,
    );
    if (clip) return clip;
  }
  return null;
}

/** Source time shown by `clip` at timeline `time`, honouring speed/reverse. */
export function clipSourceTimeAt(clip: Clip, time: number): number {
  const engine = new SpeedEngine();
  const length = clip.outPoint - clip.inPoint;
  engine.setClipSpeed(clip.id, Math.abs(clip.speed ?? 1), length);
  engine.setReverse(
    clip.id,
    clip.reversed === true || (clip.speed ?? 1) < 0,
    length,
  );
  const local = Math.max(0, Math.min(clip.duration, time - clip.startTime));
  return clip.inPoint + engine.getSourceTimeAtPlaybackTime(clip.id, local);
}
