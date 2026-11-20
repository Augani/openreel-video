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
  const itemById = new Map(mediaLibrary.items.map((item) => [item.id, item] as const));
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      // A clip's own Interpret Footage override wins over its footage item's.
      const item = clip.colorInterpretation ? itemById.get(clip.mediaId) : undefined;
      const transform = item
        ? item.type === "video" || item.type === "image" ? inputTransformFor(inputSpaceForItem(item, clip.colorInterpretation)) : null
        : byMedia.get(clip.mediaId);
      if (transform) byClip.set(clip.id, transform);
    }
  }
}

/** The input transform of a timeline clip's footage, or null (plain SDR: nothing to do). */
export function inputTransformForClip(clipId: string): InputTransform | null {
  rebuild();
  return byClip.get(clipId) ?? null;
}
