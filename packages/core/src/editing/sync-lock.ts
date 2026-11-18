import type { Project, Track } from "../types";

/**
 * Sync Lock (Premiere Pro semantics).
 *
 * Every ripple-type edit (ripple delete, ripple trim, Insert, Extract,
 * paste-insert, close gap) has two kinds of tracks:
 *
 *  - EDIT tracks: the tracks the edit is applied to directly (the tracks of
 *    the deleted/trimmed clips, the Insert destinations, the Extract targets).
 *    They are changed by the edit itself, whatever their Sync Lock setting.
 *  - FOLLOWER tracks: every other track that is unlocked AND has Sync Lock on.
 *    They are kept in sync with the edit point:
 *      * adding time (Insert, ripple-trim extension): a clip straddling the
 *        edit point is split there and everything at or after the edit point
 *        shifts later by the added length, leaving a gap;
 *      * removing time (ripple delete, Extract, ripple-trim shrink, close
 *        gap): the removed range must be EMPTY on the follower, in which case
 *        everything at or after the end of the range shifts earlier. If any
 *        clip or overlay overlaps the range the whole edit is blocked and
 *        nothing changes; the error names the first blocking track.
 *
 * Tracks with Sync Lock off are never touched by an edit they are not part of.
 * Locked tracks never change at all, regardless of Sync Lock. A track with no
 * `syncLock` value is treated as ON, so older projects load unchanged.
 */
const EPS = 1e-6;

const OVERLAY_FIELDS = [
  "textClips",
  "shapeClips",
  "svgClips",
  "stickerClips",
  "adjustmentLayers",
  "motionInstances",
] as const;

export const isSyncLocked = (track: Pick<Track, "syncLock">): boolean =>
  track.syncLock !== false;

/**
 * A track holding only fixed-angle multicam audio. Those clips are derived from
 * the multicam video clips and re-derived after every edit, so the track needs
 * neither to follow nor to block a ripple: the video edit moves its audio.
 */
function isDerivedMulticamAudioTrack(project: Project, track: Track): boolean {
  if (track.clips.length === 0) return false;
  return track.clips.every((clip) => {
    const id = clip.metadata?.multicamAudio;
    return (
      typeof id === "string" &&
      project.multicamSources?.some((s) => s.id === id && s.audio.mode === "fixed") === true
    );
  });
}

/** Unlocked, sync-locked tracks that are not edit tracks, in timeline order. */
export function syncFollowerTrackIds(
  project: Project,
  editTrackIds: Iterable<string>,
): string[] {
  const edit = new Set(editTrackIds);
  return project.timeline.tracks
    .filter(
      (track) =>
        !track.locked &&
        isSyncLocked(track) &&
        !edit.has(track.id) &&
        !isDerivedMulticamAudioTrack(project, track),
    )
    .map((track) => track.id);
}

/** Thrown when a removal would cut through a sync-locked track. */
export class SyncLockBlockedError extends Error {
  readonly trackId: string;
  readonly trackName: string;
  readonly start: number;
  readonly end: number;
  constructor(track: Pick<Track, "id" | "name">, start: number, end: number) {
    const range = `${start.toFixed(2)}s-${end.toFixed(2)}s`;
    super(
      `Sync Lock blocked this edit: "${track.name}" has content between ${range}. Move it, or turn off Sync Lock on "${track.name}".`,
    );
    this.name = "SyncLockBlockedError";
    this.trackId = track.id;
    this.trackName = track.name;
    this.start = start;
    this.end = end;
  }
}

interface Span {
  startTime: number;
  duration: number;
}

/** Everything placed on a track: media clips plus text/shape/graphics lanes. */
export function trackSpans(project: Project, trackId: string): Span[] {
  const spans: Span[] = [];
  const track = project.timeline.tracks.find((t) => t.id === trackId);
  for (const clip of track?.clips ?? []) spans.push(clip);
  for (const field of OVERLAY_FIELDS) {
    const items = (project[field] ?? []) as unknown as Array<
      Span & { trackId?: string }
    >;
    for (const item of items) if (item.trackId === trackId) spans.push(item);
  }
  return spans;
}

/** The first of `trackIds` (timeline order) with content overlapping (start, end). */
export function findSyncBlocker(
  project: Project,
  trackIds: readonly string[],
  start: number,
  end: number,
): Track | null {
  const wanted = new Set(trackIds);
  for (const track of project.timeline.tracks) {
    if (!wanted.has(track.id)) continue;
    const blocked = trackSpans(project, track.id).some(
      (span) =>
        span.startTime < end - EPS && span.startTime + span.duration > start + EPS,
    );
    if (blocked) return track;
  }
  return null;
}

/** Throw SyncLockBlockedError unless (start, end) is empty on every follower. */
export function assertRangeEmptyOnTracks(
  project: Project,
  trackIds: readonly string[],
  start: number,
  end: number,
): void {
  const blocker = findSyncBlocker(project, trackIds, start, end);
  if (blocker) throw new SyncLockBlockedError(blocker, start, end);
}
