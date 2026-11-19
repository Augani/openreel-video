import type { Clip, Project } from "../types";
import { clipSourceTimeAt } from "./premiere-edits";

export interface ReverseMatch {
  clipId: string;
  trackId: string;
  /** Timeline time at which the clip shows the requested source time. */
  time: number;
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

/**
 * Reverse Match Frame: find where `mediaId` at `sourceTime` appears in the
 * sequence. The topmost track wins (lower index is on top; video/image before
 * audio, hidden video skipped); when that track holds several instances the
 * one nearest `playhead` wins. `frameDuration` is the match tolerance.
 */
export function findReverseMatch(
  project: Project,
  mediaId: string,
  sourceTime: number,
  playhead: number,
  frameDuration = 0,
): ReverseMatch | null {
  const tolerance = Math.max(0, frameDuration) / 2;
  const tracks = project.timeline.tracks;
  const visual = tracks.filter(
    (t) => (t.type === "video" || t.type === "image") && !t.hidden,
  );
  const rest = tracks.filter((t) => t.type === "audio");
  for (const track of [...visual, ...rest]) {
    let best: ReverseMatch | null = null;
    for (const clip of track.clips) {
      if (clip.mediaId !== mediaId) continue;
      const time = timelineTimeForSource(clip, sourceTime, tolerance);
      if (time === null) continue;
      if (!best || Math.abs(time - playhead) < Math.abs(best.time - playhead))
        best = { clipId: clip.id, trackId: track.id, time };
    }
    if (best) return best;
  }
  return null;
}
