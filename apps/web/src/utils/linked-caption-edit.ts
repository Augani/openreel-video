import type { Clip, Project, TextClip } from "@openreel/core";

export interface LinkedCaptionEditStore {
  project: Project;
  getAllTextClips: () => TextClip[];
  updateOverlayClipTiming: (
    clipId: string,
    updates: { startTime?: number; duration?: number },
  ) => unknown;
  deleteTextClip: (clipId: string) => boolean;
}

const EPSILON = 0.001;

export function getLinkedCaptions(
  store: Pick<LinkedCaptionEditStore, "project" | "getAllTextClips">,
  sourceClip: Clip,
): TextClip[] {
  const sourceTrack = store.project.timeline.tracks.find(
    (track) => track.id === sourceClip.trackId,
  );
  const start = sourceClip.startTime;
  const end = sourceClip.startTime + sourceClip.duration;

  return store.getAllTextClips().filter((caption) => {
    if (caption.metadata?.captionSourceClipId === sourceClip.id) return true;
    if (!sourceTrack?.groupId) return false;
    const captionTrack = store.project.timeline.tracks.find(
      (track) => track.id === caption.trackId,
    );
    if (captionTrack?.groupId !== sourceTrack.groupId) return false;
    const captionEnd = caption.startTime + caption.duration;
    return caption.startTime < end - EPSILON && captionEnd > start + EPSILON;
  });
}

export function moveLinkedCaptions(
  store: LinkedCaptionEditStore,
  sourceClip: Clip,
  newStartTime: number,
): number {
  const delta = newStartTime - sourceClip.startTime;
  if (Math.abs(delta) < EPSILON) return 0;
  const captions = getLinkedCaptions(store, sourceClip);
  for (const caption of captions) {
    store.updateOverlayClipTiming(caption.id, {
      startTime: Math.max(0, caption.startTime + delta),
    });
  }
  return captions.length;
}

export function trimLinkedCaptions(
  store: LinkedCaptionEditStore,
  sourceClip: Clip,
  newStartTime: number,
  newEndTime: number,
): { updated: number; removed: number } {
  let updated = 0;
  let removed = 0;
  for (const caption of getLinkedCaptions(store, sourceClip)) {
    const captionEnd = caption.startTime + caption.duration;
    const clippedStart = Math.max(caption.startTime, newStartTime);
    const clippedEnd = Math.min(captionEnd, newEndTime);
    if (clippedEnd - clippedStart < 0.1) {
      if (store.deleteTextClip(caption.id)) removed += 1;
      continue;
    }
    if (
      Math.abs(clippedStart - caption.startTime) >= EPSILON ||
      Math.abs(clippedEnd - captionEnd) >= EPSILON
    ) {
      store.updateOverlayClipTiming(caption.id, {
        startTime: clippedStart,
        duration: clippedEnd - clippedStart,
      });
      updated += 1;
    }
  }
  return { updated, removed };
}
