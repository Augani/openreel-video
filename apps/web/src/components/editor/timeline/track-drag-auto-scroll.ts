const DEFAULT_EDGE_ZONE = 72;
const DEFAULT_MIN_SPEED = 2;
const DEFAULT_MAX_SPEED = 18;

interface TrackDragAutoScrollOptions {
  edgeZone?: number;
  minSpeed?: number;
  maxSpeed?: number;
}

/**
 * Returns the vertical scroll delta for one animation frame while reordering a
 * track. Speed ramps up as the pointer approaches the edge so entering the
 * zone feels controlled while holding at the boundary still crosses long lists.
 */
export function getTrackDragAutoScrollDelta(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number,
  scrollTop: number,
  maxScrollTop: number,
  options: TrackDragAutoScrollOptions = {},
): number {
  const edgeZone = options.edgeZone ?? DEFAULT_EDGE_ZONE;
  const minSpeed = options.minSpeed ?? DEFAULT_MIN_SPEED;
  const maxSpeed = options.maxSpeed ?? DEFAULT_MAX_SPEED;

  if (edgeZone <= 0 || viewportBottom <= viewportTop) return 0;

  const speedForDepth = (depth: number) => {
    const progress = Math.max(0, Math.min(1, depth / edgeZone));
    return minSpeed + (maxSpeed - minSpeed) * progress * progress;
  };

  const topBoundary = viewportTop + edgeZone;
  if (pointerY < topBoundary && scrollTop > 0) {
    return -speedForDepth(topBoundary - pointerY);
  }

  const bottomBoundary = viewportBottom - edgeZone;
  if (pointerY > bottomBoundary && scrollTop < maxScrollTop) {
    return speedForDepth(pointerY - bottomBoundary);
  }

  return 0;
}
