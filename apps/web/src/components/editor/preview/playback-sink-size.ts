/**
 * Decoded frame size for preview playback.
 *
 * The Program monitor paints into a canvas of at most PREVIEW_MAX_DIMENSION on its long edge, but a
 * mediabunny CanvasSink without a size hands back canvases at the SOURCE resolution: for 4K that is a
 * 33 MB canvas per pooled slot and another 33 MB ImageBitmap per layer per frame, tens of thousands of
 * allocations a minute. Asking the sink for the size the monitor can actually show cuts those 4x.
 *
 * `zoom` is the clip's own scale, so a clip scaled up 2x keeps twice the detail. Only one dimension is
 * returned: mediabunny derives the other from the aspect ratio (passing both would letterbox).
 *
 * `minZoom` (default 1: never decode below the monitor size) lets a layer that is only SHOWN small, a picture-in-picture
 * at 35 % scale, be decoded and graded at a fraction of the monitor size: the per-pixel work of decode copy, bitmap
 * copy and CPU grading scales with the area (a 0.5 floor is 4x fewer pixels). The caller passes it only for layers
 * whose look does not depend on the decoded pixel count (see `canDecodeBelowMonitorSize`).
 */
export function playbackSinkSize(
  displayWidth: number,
  displayHeight: number,
  previewLongEdge: number,
  zoom = 1,
  minZoom = 1,
): { width: number } | { height: number } | null {
  if (!(displayWidth > 0) || !(displayHeight > 0) || !(previewLongEdge > 0)) return null;
  const floor = Number.isFinite(minZoom) ? Math.min(1, Math.max(0.25, minZoom)) : 1;
  const safeZoom = Number.isFinite(zoom) ? Math.min(4, Math.max(floor, zoom)) : 1;
  const cap = Math.ceil(previewLongEdge * safeZoom);
  const long = Math.max(displayWidth, displayHeight);
  if (long <= cap) return null;
  return displayWidth >= displayHeight ? { width: cap } : { height: cap };
}

/** Never decode a layer below this fraction of the monitor size, however small it is shown. */
export const MIN_LAYER_DECODE_ZOOM = 0.5;

/**
 * True when a layer can be decoded below the monitor size without changing what it looks like: it is not animated
 * (a keyframed scale / crop would show detail the small decode no longer has), has no crop (a crop magnifies the
 * decoded region) and carries no effects (blur, glow, sharpen... take radii in decoded pixels). Colour grading is
 * per-pixel and unaffected.
 */
export function canDecodeBelowMonitorSize(clip: {
  keyframes?: readonly unknown[];
  effects?: readonly unknown[];
  transform?: { crop?: unknown };
}): boolean {
  return (clip.keyframes?.length ?? 0) === 0 && (clip.effects?.length ?? 0) === 0 && !clip.transform?.crop;
}
