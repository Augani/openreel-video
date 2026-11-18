import type { Clip } from "@openreel/core";

/**
 * Clips that must stay mounted while a pointer gesture (drag/trim) is in
 * progress. A dragged clip keeps its authored startTime until drop, so scrolling
 * during the drag would otherwise cull the element that owns the gesture.
 */
const pinnedClipIds = new Map<string, number>();

export const pinTimelineClip = (clipId: string): (() => void) => {
  pinnedClipIds.set(clipId, (pinnedClipIds.get(clipId) ?? 0) + 1);
  return () => {
    const next = (pinnedClipIds.get(clipId) ?? 1) - 1;
    if (next <= 0) pinnedClipIds.delete(clipId);
    else pinnedClipIds.set(clipId, next);
  };
};

export const isTimelineClipPinned = (clipId: string): boolean => pinnedClipIds.has(clipId);

/**
 * Clips intersecting the scrolled viewport plus half a viewport of lookahead per
 * side. Selected and pinned clips always stay mounted. Unknown viewport width
 * disables culling so first paint never drops clips.
 */
export function getVisibleClips(
  clips: readonly Clip[],
  scrollX: number,
  viewportWidth: number,
  pixelsPerSecond: number,
  selectedClipIds: readonly string[] = [],
  overscan = viewportWidth / 2,
): Clip[] {
  if (viewportWidth <= 0 || pixelsPerSecond <= 0 || clips.length === 0) {
    return clips.slice();
  }
  const from = scrollX - overscan;
  const to = scrollX + viewportWidth + overscan;
  return clips.filter((clip) => {
    const left = clip.startTime * pixelsPerSecond;
    const right = left + clip.duration * pixelsPerSecond;
    if (right >= from && left <= to) return true;
    return selectedClipIds.includes(clip.id) || pinnedClipIds.has(clip.id);
  });
}
