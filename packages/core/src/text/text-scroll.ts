import type { TextScroll } from "./types";

/**
 * Roll / crawl position. Pure so the preview and the export renderer, which
 * both draw titles through `TitleEngine.renderText`, move text identically.
 * All values are canvas px; `above/below/left/right` are how far the text
 * block extends from its anchor point (they depend on the alignment).
 */
export interface ScrollExtents {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly above: number;
  readonly below: number;
  readonly left: number;
  readonly right: number;
}

export function scrollProgress(time: number, duration: number): number {
  if (!(duration > 0)) return 1;
  return Math.min(1, Math.max(0, time / duration));
}

export function resolveScrollDirection(scroll: TextScroll): "up" | "down" | "left" | "right" {
  if (scroll.mode === "roll") return scroll.direction === "down" ? "down" : "up";
  return scroll.direction === "right" ? "right" : "left";
}

/** Anchor position of the text at `progress` (0..1), given the resting anchor `rest`. */
export function computeScrollAnchor(
  scroll: TextScroll,
  progress: number,
  rest: { x: number; y: number },
  extents: ScrollExtents,
): { x: number; y: number } {
  const p = Math.min(1, Math.max(0, progress));
  const direction = resolveScrollDirection(scroll);
  const lerp = (a: number, b: number) => a + (b - a) * p;

  if (scroll.mode === "roll") {
    // Moving up: enters below the frame (top edge at the bottom), leaves above it.
    const below = extents.canvasHeight + extents.above;
    const above = -extents.below;
    const from = scroll.startOffscreen ? (direction === "up" ? below : above) : rest.y;
    const to = scroll.endOffscreen ? (direction === "up" ? above : below) : rest.y;
    return { x: rest.x, y: lerp(from, to) };
  }

  // Moving left: enters beyond the right edge, leaves beyond the left edge.
  const beyondRight = extents.canvasWidth + extents.left;
  const beyondLeft = -extents.right;
  const from = scroll.startOffscreen ? (direction === "left" ? beyondRight : beyondLeft) : rest.x;
  const to = scroll.endOffscreen ? (direction === "left" ? beyondLeft : beyondRight) : rest.x;
  return { x: lerp(from, to), y: rest.y };
}
