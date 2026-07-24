import type { MotionShapePathPoint, MotionVector2 } from "@openreel/core";

export function penAddCorner(
  points: readonly MotionShapePathPoint[],
  p: MotionVector2,
): MotionShapePathPoint[] {
  return [...points, { x: p.x, y: p.y }];
}

export function penDragHandles(
  points: readonly MotionShapePathPoint[],
  drag: { readonly anchor: MotionVector2; readonly current: MotionVector2 },
): MotionShapePathPoint[] {
  if (points.length === 0) return [...points];
  const lastIndex = points.length - 1;
  const last = points[lastIndex];
  if (!last) return [...points];
  const { anchor, current } = drag;
  const updated: MotionShapePathPoint = {
    ...last,
    x: last.x,
    y: last.y,
    outX: current.x,
    outY: current.y,
    inX: 2 * anchor.x - current.x,
    inY: 2 * anchor.y - current.y,
  };
  const next = [...points];
  next[lastIndex] = updated;
  return next;
}

export function penShouldClose(
  points: readonly MotionShapePathPoint[],
  p: MotionVector2,
  tolerancePx: number,
): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  if (!first) return false;
  const tolerance = Math.max(0, tolerancePx);
  return Math.hypot(first.x - p.x, first.y - p.y) <= tolerance;
}

export function shouldShowSelectionHandles(args: {
  readonly layerId: string;
  readonly selectedLayerId: string | null;
  readonly selectionCount: number;
  readonly locked: boolean;
  readonly penDraftLayerId: string | null;
}): boolean {
  const { layerId, selectedLayerId, selectionCount, locked, penDraftLayerId } =
    args;
  if (layerId !== selectedLayerId) return false;
  if (selectionCount !== 1) return false;
  if (locked) return false;
  if (penDraftLayerId === layerId) return false;
  return true;
}

export function moveVertex(
  points: readonly MotionShapePathPoint[],
  index: number,
  delta: MotionVector2,
): MotionShapePathPoint[] {
  const next = [...points];
  const point = next[index];
  if (!point) return next;
  const moved: MotionShapePathPoint = {
    ...point,
    x: point.x + delta.x,
    y: point.y + delta.y,
    ...(point.outX !== undefined ? { outX: point.outX + delta.x } : {}),
    ...(point.outY !== undefined ? { outY: point.outY + delta.y } : {}),
    ...(point.inX !== undefined ? { inX: point.inX + delta.x } : {}),
    ...(point.inY !== undefined ? { inY: point.inY + delta.y } : {}),
  };
  next[index] = moved;
  return next;
}

export function moveHandle(
  points: readonly MotionShapePathPoint[],
  index: number,
  which: "in" | "out",
  p: MotionVector2,
  symmetric: boolean,
): MotionShapePathPoint[] {
  const next = [...points];
  const point = next[index];
  if (!point) return next;
  const mirrorX = 2 * point.x - p.x;
  const mirrorY = 2 * point.y - p.y;
  const moved: MotionShapePathPoint =
    which === "out"
      ? {
          ...point,
          outX: p.x,
          outY: p.y,
          ...(symmetric ? { inX: mirrorX, inY: mirrorY } : {}),
        }
      : {
          ...point,
          inX: p.x,
          inY: p.y,
          ...(symmetric ? { outX: mirrorX, outY: mirrorY } : {}),
        };
  next[index] = moved;
  return next;
}

export function toggleVertexSmooth(
  points: readonly MotionShapePathPoint[],
  index: number,
  closed: boolean,
): MotionShapePathPoint[] {
  const next = [...points];
  const point = next[index];
  if (!point) return next;

  const isSmooth =
    point.inX !== undefined ||
    point.inY !== undefined ||
    point.outX !== undefined ||
    point.outY !== undefined;

  if (isSmooth) {
    next[index] = { x: point.x, y: point.y };
    return next;
  }

  const previous = neighborPoint(points, index, -1, closed);
  const following = neighborPoint(points, index, 1, closed);
  if (!previous && !following) {
    next[index] = { x: point.x, y: point.y };
    return next;
  }
  const anchorPrevious = previous ?? point;
  const anchorFollowing = following ?? point;
  const smoothed: MotionShapePathPoint = {
    x: point.x,
    y: point.y,
    inX: point.x + (anchorPrevious.x - point.x) / 3,
    inY: point.y + (anchorPrevious.y - point.y) / 3,
    outX: point.x + (anchorFollowing.x - point.x) / 3,
    outY: point.y + (anchorFollowing.y - point.y) / 3,
  };
  next[index] = smoothed;
  return next;
}

function neighborPoint(
  points: readonly MotionShapePathPoint[],
  index: number,
  direction: 1 | -1,
  closed: boolean,
): MotionShapePathPoint | undefined {
  const count = points.length;
  const direct = points[index + direction];
  if (direct) return direct;
  if (!closed || count < 2) return undefined;
  const wrapped = direction === 1 ? points[0] : points[count - 1];
  return wrapped;
}
