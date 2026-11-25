import type { Clip } from "../../types/timeline";
import { getRemovalAnalysis } from "./registry";
import { applyFillPatch } from "./render";

type RemovalClip = Pick<Clip, "id" | "startTime" | "objectRemoval"> & Partial<Pick<Clip, "inPoint" | "speed" | "reversed" | "speedKeyframes" | "freezeFrames">>;

/**
 * What decides which source frame sits at each clip frame. The analysis is stored per clip frame, so trimming the
 * head, changing speed or reversing the clip moves the footage under it; the fill then no longer matches.
 */
export function removalTimingOf(clip: Partial<Pick<Clip, "inPoint" | "speed" | "reversed" | "speedKeyframes" | "freezeFrames">>): string {
  return JSON.stringify([clip.inPoint ?? 0, clip.speed ?? 1, clip.reversed ?? false, clip.speedKeyframes ?? [], clip.freezeFrames ?? []]);
}

/** The mask Remove Object consumes on this clip (it only marks what is removed, it no longer cuts or scopes the picture). */
export function consumedMaskId(clip: Pick<Clip, "objectRemoval">): string | null {
  return clip.objectRemoval?.enabled && typeof clip.objectRemoval.analysisKey === "string" ? clip.objectRemoval.maskId : null;
}

/** True when the clip's picture is changed by Remove Object (so frame fast paths must not skip it). */
export function clipHasObjectRemoval(clip: Pick<Clip, "objectRemoval"> | undefined): boolean {
  return clip?.objectRemoval?.enabled === true && typeof clip.objectRemoval.analysisKey === "string";
}

/**
 * Remove Object (Content-Aware Fill) for one frame of a clip's raw footage: lays the analysed fill over it. The
 * Program monitor and the export call this same function, so the fill is the same pixels in both. Returns `bitmap`
 * itself when nothing changes; otherwise a new bitmap the caller owns. `strict` (export) throws when the clip's
 * analysis is missing instead of silently rendering the object.
 */
export async function applyObjectRemovalToBitmap(clip: RemovalClip, bitmap: ImageBitmap, time: number, strict = false): Promise<ImageBitmap> {
  const settings = clip.objectRemoval;
  if (!settings?.enabled || !settings.analysisKey) return bitmap;
  const timingChanged = settings.timing !== undefined && settings.timing !== removalTimingOf(clip);
  if (timingChanged) {
    if (strict) throw new Error("This clip was trimmed, retimed or reversed after Remove Object ran. Run Remove Object again before exporting.");
    return bitmap;
  }
  const analysis = await getRemovalAnalysis(clip.id, settings.analysisKey);
  if (!analysis) {
    if (strict) throw new Error("Remove Object has no analysis for this clip. Select the clip and run Remove Object again before exporting.");
    return bitmap;
  }
  const index = Math.max(0, Math.min(analysis.frames.length - 1, Math.floor((time - clip.startTime) * analysis.fps + 1e-4)));
  const patch = analysis.frames[index];
  if (!patch) return bitmap;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return bitmap;
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  if (!applyFillPatch(pixels, patch, analysis.width, analysis.height)) return bitmap;
  context.putImageData(pixels, 0, 0);
  return createImageBitmap(canvas);
}
