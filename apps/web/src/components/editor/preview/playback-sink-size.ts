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
 */
export function playbackSinkSize(
  displayWidth: number,
  displayHeight: number,
  previewLongEdge: number,
  zoom = 1,
): { width: number } | { height: number } | null {
  if (!(displayWidth > 0) || !(displayHeight > 0) || !(previewLongEdge > 0)) return null;
  const safeZoom = Number.isFinite(zoom) ? Math.min(4, Math.max(1, zoom)) : 1;
  const cap = Math.ceil(previewLongEdge * safeZoom);
  const long = Math.max(displayWidth, displayHeight);
  if (long <= cap) return null;
  return displayWidth >= displayHeight ? { width: cap } : { height: cap };
}
