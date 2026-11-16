import { inputSpaceForItem, inputTransformFor, type InputTransform } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

/**
 * The preview half of source colour management: which clips need an input
 * transform (wide-gamut / HDR footage on the native decode path, or any footage
 * the user re-interpreted). The core export renderer resolves the same
 * transform with the same function (`inputSpaceForItem`), so the preview and
 * the export apply an identical pixel transform at the same stage, before
 * effects and grading.
 */

let cachedItems: unknown = null;
let cachedTracks: unknown = null;
let byClip = new Map<string, InputTransform>();

function rebuild(): void {
  const { mediaLibrary, timeline } = useProjectStore.getState().project;
  if (cachedItems === mediaLibrary.items && cachedTracks === timeline.tracks) return;
  cachedItems = mediaLibrary.items;
  cachedTracks = timeline.tracks;
  byClip = new Map();
  const byMedia = new Map<string, InputTransform>();
  for (const item of mediaLibrary.items) {
    if (item.type !== "video" && item.type !== "image") continue;
    const transform = inputTransformFor(inputSpaceForItem(item));
    if (transform) byMedia.set(item.id, transform);
  }
  if (byMedia.size === 0) return;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const transform = byMedia.get(clip.mediaId);
      if (transform) byClip.set(clip.id, transform);
    }
  }
}

/** The input transform of a timeline clip's footage, or null (plain SDR: nothing to do). */
export function inputTransformForClip(clipId: string): InputTransform | null {
  rebuild();
  return byClip.get(clipId) ?? null;
}
