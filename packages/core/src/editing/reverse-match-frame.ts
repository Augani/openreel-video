import type { Clip, Project, Track } from "../types";
import { clipSourceTimeAt } from "./premiere-edits";

export interface ReverseMatch {
  clipId: string;
  trackId: string;
  /** Timeline time at which the clip shows the requested source time. */
  time: number;
  /**
   * Nested sequences (outermost first) the frame was found inside. `clipId` is then the nest clip
   * in the active sequence and `time` is where that nest clip plays the frame. Empty for a direct hit.
   */
  nestPath: string[];
}

/**
 * Timeline time at which `clip` shows `sourceTime`, honouring speed, reverse
 * and speed keyframes (the mapping is monotonic, so it is inverted by
 * bisection over the same function the renderer uses). Null when the clip
 * never shows that source time. `tolerance` (seconds) forgives a source time
 * just outside the clip's used range, e.g. a frame of rounding.
 */
export function timelineTimeForSource(
  clip: Clip,
  sourceTime: number,
  tolerance = 0,
): number | null {
  if (clip.duration <= 0) return null;
  const start = clip.startTime;
  const end = clip.startTime + clip.duration;
  const a = clipSourceTimeAt(clip, start);
  const b = clipSourceTimeAt(clip, end);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (sourceTime < lo - tolerance || sourceTime > hi + tolerance) return null;
  const target = Math.min(hi, Math.max(lo, sourceTime));
  const ascending = b >= a;
  let left = start;
  let right = end;
  for (let i = 0; i < 48; i++) {
    const mid = (left + right) / 2;
    const value = clipSourceTimeAt(clip, mid);
    if (value < target === ascending) left = mid;
    else right = mid;
  }
  return (left + right) / 2;
}

const COMPOUND_PREFIX = "compound:";
const MAX_NEST_DEPTH = 8;

function collectMatches(
  project: Project,
  tracks: readonly Track[],
  mediaId: string,
  sourceTime: number,
  tolerance: number,
  visiting: readonly string[],
): ReverseMatch[] {
  const visual = tracks.filter((t) => (t.type === "video" || t.type === "image") && !t.hidden);
  const rest = tracks.filter((t) => t.type === "audio");
  const out: ReverseMatch[] = [];
  for (const track of [...visual, ...rest]) {
    const here: ReverseMatch[] = [];
    for (const clip of track.clips) {
      if (clip.mediaId === mediaId) {
        const time = timelineTimeForSource(clip, sourceTime, tolerance);
        if (time !== null) here.push({ clipId: clip.id, trackId: track.id, time, nestPath: [] });
        continue;
      }
      if (!clip.mediaId.startsWith(COMPOUND_PREFIX)) continue;
      const sequenceId = clip.mediaId.slice(COMPOUND_PREFIX.length);
      if (visiting.includes(sequenceId) || visiting.length >= MAX_NEST_DEPTH) continue;
      const sequence = project.sequences?.find((s) => s.id === sequenceId);
      if (!sequence) continue;
      for (const inner of collectMatches(project, sequence.timeline.tracks, mediaId, sourceTime, tolerance, [...visiting, sequenceId])) {
        // `inner.time` is time inside the nested sequence; find where this nest clip plays it.
        const time = timelineTimeForSource(clip, inner.time, tolerance);
        if (time !== null) here.push({ clipId: clip.id, trackId: track.id, time, nestPath: [sequenceId, ...inner.nestPath] });
      }
    }
    here.sort((a, b) => a.time - b.time);
    out.push(...here);
  }
  return out;
}

/**
 * Every place `mediaId` at `sourceTime` appears in the active sequence, in priority order: the
 * topmost track first (lower index is on top; video/image before audio, hidden video skipped),
 * earliest first within a track. Instances inside nested sequences are reported on the nest
 * clip of the active sequence. `frameDuration` is the match tolerance.
 */
export function findReverseMatches(
  project: Project,
  mediaId: string,
  sourceTime: number,
  frameDuration = 0,
): ReverseMatch[] {
  return collectMatches(project, project.timeline.tracks, mediaId, sourceTime, Math.max(0, frameDuration) / 2, [
    ...(project.activeSequenceId ? [project.activeSequenceId] : []),
  ]);
}

/**
 * Reverse Match Frame: find where `mediaId` at `sourceTime` appears in the
 * sequence. The topmost track wins; when that track holds several instances
 * the one nearest `playhead` wins.
 */
export function findReverseMatch(
  project: Project,
  mediaId: string,
  sourceTime: number,
  playhead: number,
  frameDuration = 0,
): ReverseMatch | null {
  const all = findReverseMatches(project, mediaId, sourceTime, frameDuration);
  return nearestOnTopTrack(all, playhead);
}

function nearestOnTopTrack(all: readonly ReverseMatch[], playhead: number): ReverseMatch | null {
  if (!all.length) return null;
  const topTrack = all[0].trackId;
  let best: ReverseMatch | null = null;
  for (const m of all) {
    if (m.trackId !== topTrack) continue;
    if (!best || Math.abs(m.time - playhead) < Math.abs(best.time - playhead)) best = m;
  }
  return best;
}

export interface ReverseMatchPick {
  match: ReverseMatch;
  /** 0-based position among all instances (priority order). */
  index: number;
  count: number;
}

/**
 * Choose which instance Reverse Match Frame lands on. Pressing it again while the playhead sits on
 * an instance (and that clip is selected) cycles to the next one, wrapping; otherwise the instance
 * on the topmost track nearest the playhead wins. `tolerance` is how close (seconds) the playhead
 * must be to count as "on" an instance.
 */
export function pickReverseMatch(
  matches: readonly ReverseMatch[],
  playhead: number,
  selectedClipId: string | null,
  tolerance: number,
): ReverseMatchPick | null {
  if (!matches.length) return null;
  const current = matches.findIndex(
    (m) => m.clipId === selectedClipId && Math.abs(m.time - playhead) <= Math.max(tolerance, 1e-4),
  );
  if (current >= 0 && matches.length > 1) {
    const index = (current + 1) % matches.length;
    return { match: matches[index], index, count: matches.length };
  }
  const match = nearestOnTopTrack(matches, playhead)!;
  return { match, index: matches.indexOf(match), count: matches.length };
}
