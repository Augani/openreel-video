import type { Clip, Marker } from "../types/timeline";
import type { MediaItem } from "../types/project";

/**
 * Clip markers and master-clip markers (Premiere). Both store `time` in SOURCE media seconds,
 * so they stay on the same frame of the footage through trims, speed changes and reverse.
 * Master-clip markers live on the media item and show on every timeline instance; clip markers
 * live on one timeline instance. These helpers map between source time and timeline time.
 */

const EPS = 1e-6;

export type ClipMarkerScope = "master" | "clip";

export interface ResolvedClipMarker {
  readonly marker: Marker;
  readonly scope: ClipMarkerScope;
  /** Timeline seconds of the marker's start (for a reversed clip: where its source start plays). */
  readonly timelineTime: number;
  /** Timeline length of a range marker (0 for a point marker), speed applied. */
  readonly timelineDuration: number;
}

const speedOf = (clip: Pick<Clip, "speed">): number => {
  const s = Math.abs(clip.speed ?? 1);
  return s > 0 ? s : 1;
};

const isReversed = (clip: Pick<Clip, "speed" | "reversed">): boolean => clip.reversed === true || (clip.speed ?? 1) < 0;

/** Timeline time at which `clip` plays source time `sourceTime` (not clamped to the clip). */
export function sourceToTimelineTime(clip: Clip, sourceTime: number): number {
  const s = speedOf(clip);
  const offset = isReversed(clip) ? clip.outPoint - sourceTime : sourceTime - clip.inPoint;
  return clip.startTime + offset / s;
}

/** Source time that `clip` plays at timeline `time` (constant speed; not clamped to the clip). */
export function timelineToSourceTime(clip: Clip, time: number): number {
  const s = speedOf(clip);
  const local = (time - clip.startTime) * s;
  return isReversed(clip) ? clip.outPoint - local : clip.inPoint + local;
}

/** True when source time lies inside the clip's in..out range. */
export function sourceTimeInClip(clip: Clip, sourceTime: number): boolean {
  return sourceTime >= clip.inPoint - EPS && sourceTime <= clip.outPoint + EPS;
}

/**
 * Markers of one timeline instance: the media's master markers plus the clip's own, mapped to
 * timeline time and filtered to the visible source range. A range marker is clipped to it.
 * Sorted by timeline time.
 */
export function resolveClipMarkers(
  clip: Clip,
  media?: Pick<MediaItem, "markers"> | null,
): ResolvedClipMarker[] {
  const out: ResolvedClipMarker[] = [];
  const add = (markers: readonly Marker[] | undefined, scope: ClipMarkerScope): void => {
    for (const marker of markers ?? []) {
      const srcStart = marker.time;
      const srcEnd = srcStart + (marker.duration ?? 0);
      if (srcEnd < clip.inPoint - EPS || srcStart > clip.outPoint + EPS) continue;
      const a = sourceToTimelineTime(clip, Math.max(srcStart, clip.inPoint));
      const b = sourceToTimelineTime(clip, Math.min(srcEnd, clip.outPoint));
      const start = Math.min(a, b);
      out.push({ marker, scope, timelineTime: start, timelineDuration: Math.abs(b - a) });
    }
  };
  add(media?.markers, "master");
  add(clip.markers, "clip");
  return out.sort((x, y) => x.timelineTime - y.timelineTime);
}

/** A marker placed at timeline `time` on `clip`, as a source-time marker draft; null when off the clip. */
export function sourceTimeForTimelineMarker(clip: Clip, time: number): number | null {
  if (time < clip.startTime - EPS || time > clip.startTime + clip.duration + EPS) return null;
  const src = timelineToSourceTime(clip, time);
  return Math.min(clip.outPoint, Math.max(clip.inPoint, src));
}

/** Every marker visible on timeline instances of `clips`, as timeline-time `Marker`s (for lists and navigation). */
export function flattenClipMarkers(
  clips: readonly Clip[],
  mediaFor: (mediaId: string) => Pick<MediaItem, "markers"> | undefined,
): Array<ResolvedClipMarker & { readonly clipId: string }> {
  const out: Array<ResolvedClipMarker & { readonly clipId: string }> = [];
  for (const clip of clips)
    for (const r of resolveClipMarkers(clip, mediaFor(clip.mediaId))) out.push({ ...r, clipId: clip.id });
  return out.sort((a, b) => a.timelineTime - b.timelineTime);
}
