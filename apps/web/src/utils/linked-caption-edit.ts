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
  const tracks = new Map(store.project.timeline.tracks.map(track => [track.id, track]));
  const sourceTrack = tracks.get(sourceClip.trackId);
  const root = typeof sourceClip.metadata?.splitSourceClipId === "string" ? sourceClip.metadata.splitSourceClipId : sourceClip.id;
  const split = root !== sourceClip.id || store.project.timeline.tracks.some(track => (track.clips ?? []).some(clip => clip.id !== sourceClip.id && clip.metadata?.splitSourceClipId === root));
  const start = sourceClip.startTime;
  const end = sourceClip.startTime + sourceClip.duration;

  return store.getAllTextClips().filter((caption) => {
    const captionTrack = tracks.get(caption.trackId);
    if (captionTrack?.locked) return false;
    const source = caption.metadata?.captionSourceClipId;
    if (typeof source === "string") {
      if (source !== sourceClip.id && source !== root) return false;
      return !split || (caption.startTime < end - EPSILON && caption.startTime + caption.duration > start + EPSILON);
    }
    if (!sourceTrack?.groupId) return false;
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
