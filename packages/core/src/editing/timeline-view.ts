/**
 * Pure viewport math for the Zoom tool. `scrollX` is the pixel offset of the
 * left edge of the visible timeline, `pointerX` a pixel offset inside the
 * viewport.
 */
export interface ZoomLimits {
  min: number;
  max: number;
}
export interface ViewState {
  pixelsPerSecond: number;
  scrollX: number;
}

const clamp = (value: number, { min, max }: ZoomLimits) =>
  Math.max(min, Math.min(max, value));

/** Zoom by `factor`, keeping the time under `pointerX` fixed on screen. */
export function zoomAtPoint(
  view: ViewState,
  pointerX: number,
  factor: number,
  limits: ZoomLimits,
): ViewState {
  if (!(factor > 0) || !Number.isFinite(factor)) return view;
  const next = clamp(view.pixelsPerSecond * factor, limits);
  if (next === view.pixelsPerSecond) return view;
  const timeAtPointer = (pointerX + view.scrollX) / view.pixelsPerSecond;
  return {
    pixelsPerSecond: next,
    scrollX: Math.max(0, timeAtPointer * next - pointerX),
  };
}

/** Fit the time range [start, end] to the viewport width. */
export function zoomToRange(
  start: number,
  end: number,
  viewportWidth: number,
  limits: ZoomLimits,
): ViewState | null {
  const span = end - start;
  if (!(span > 1e-6) || !(viewportWidth > 0)) return null;
  const pixelsPerSecond = clamp(viewportWidth / span, limits);
  return { pixelsPerSecond, scrollX: Math.max(0, start * pixelsPerSecond) };
}
