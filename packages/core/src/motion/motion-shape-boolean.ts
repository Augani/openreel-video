import polygonClipping from "polygon-clipping";

import type { MotionShapePathPoint } from "./motion-shape-path";
import type { MotionShapeMergeMode, MotionVector2 } from "./types";

export type { MotionShapeMergeMode };

type ClippingPair = [number, number];
type ClippingRing = ClippingPair[];
type ClippingPolygon = ClippingRing[];
type ClippingMultiPolygon = ClippingPolygon[];

export class MotionShapeBooleanError extends Error {
  readonly mode: MotionShapeMergeMode;

  constructor(mode: MotionShapeMergeMode, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`polygon-clipping ${mode} operation failed: ${detail}`);
    this.name = "MotionShapeBooleanError";
    this.mode = mode;
  }
}

const isFinitePoint = (point: MotionVector2): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const isNonEmptyRing = (ring: ReadonlyArray<MotionVector2>): boolean =>
  ring.length > 0;

const filterRingSet = (
  ringSet: ReadonlyArray<ReadonlyArray<MotionVector2>>,
): ReadonlyArray<ReadonlyArray<MotionVector2>> =>
  ringSet.filter(isNonEmptyRing);

const cloneRing = (ring: ReadonlyArray<MotionVector2>): MotionVector2[] =>
  ring.map((point) => ({ x: point.x, y: point.y }));

const cloneRingSet = (
  ringSet: ReadonlyArray<ReadonlyArray<MotionVector2>>,
): MotionVector2[][] => ringSet.map(cloneRing);

const assertFinite = (
  ringSet: ReadonlyArray<ReadonlyArray<MotionVector2>>,
  mode: MotionShapeMergeMode,
): void => {
  for (const ring of ringSet) {
    for (const point of ring) {
      if (!isFinitePoint(point)) {
        throw new MotionShapeBooleanError(
          mode,
          new Error("non-finite coordinate"),
        );
      }
    }
  }
};

const toClippingPolygon = (
  ringSet: ReadonlyArray<ReadonlyArray<MotionVector2>>,
): ClippingPolygon =>
  ringSet.map((ring) => {
    const converted: ClippingRing = ring.map((point) => [point.x, point.y]);
    if (converted.length > 0) {
      const first = converted[0];
      const last = converted[converted.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        converted.push([first[0], first[1]]);
      }
    }
    return converted;
  });

const fromClippingMultiPolygon = (
  multiPolygon: ClippingMultiPolygon,
): MotionVector2[][][] =>
  multiPolygon.map((polygon) =>
    polygon.map((ring) => {
      const points: MotionVector2[] = ring.map(([x, y]) => ({ x, y }));
      if (points.length > 1) {
        const first = points[0];
        const last = points[points.length - 1];
        if (first.x === last.x && first.y === last.y) {
          points.pop();
        }
      }
      return points;
    }),
  );

const runClipping = (
  mode: MotionShapeMergeMode,
  polygons: ReadonlyArray<ClippingPolygon>,
): ClippingMultiPolygon => {
  const [head, ...rest] = polygons;
  switch (mode) {
    case "union":
      return polygonClipping.union(head, ...rest);
    case "subtract":
      return polygonClipping.difference(head, ...rest);
    case "intersect":
      return polygonClipping.intersection(head, ...rest);
    case "exclude":
      return rest.reduce<ClippingMultiPolygon>(
        (accumulated, next) => polygonClipping.xor(accumulated, next),
        [head],
      );
    case "none":
      return polygons.map((polygon) => [...polygon]);
    default: {
      const exhaustive: never = mode;
      throw new MotionShapeBooleanError(
        exhaustive,
        new Error("unsupported merge mode"),
      );
    }
  }
};

export function mergeMotionShapeRings(
  ringSets: ReadonlyArray<ReadonlyArray<ReadonlyArray<MotionVector2>>>,
  mode: MotionShapeMergeMode,
): MotionVector2[][][] {
  const nonEmpty = ringSets
    .map(filterRingSet)
    .filter((ringSet) => ringSet.length > 0);

  for (const ringSet of nonEmpty) {
    assertFinite(ringSet, mode);
  }

  if (mode === "none" || nonEmpty.length < 2) {
    return nonEmpty.map(cloneRingSet);
  }

  const polygons = nonEmpty.map(toClippingPolygon);

  let result: ClippingMultiPolygon;
  try {
    result = runClipping(mode, polygons);
  } catch (error) {
    if (error instanceof MotionShapeBooleanError) {
      throw error;
    }
    throw new MotionShapeBooleanError(mode, error);
  }

  return fromClippingMultiPolygon(result);
}

const readOutHandle = (point: MotionShapePathPoint): MotionVector2 | null =>
  point.outX !== undefined && point.outY !== undefined
    ? { x: point.outX, y: point.outY }
    : null;

const readInHandle = (point: MotionShapePathPoint): MotionVector2 | null =>
  point.inX !== undefined && point.inY !== undefined
    ? { x: point.inX, y: point.inY }
    : null;

const cubicAt = (
  start: MotionVector2,
  control1: MotionVector2,
  control2: MotionVector2,
  end: MotionVector2,
  t: number,
): MotionVector2 => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = 3 * mt2 * t;
  const c = 3 * mt * t2;
  const d = t2 * t;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
};

export function flattenPathPointsToRing(
  points: readonly MotionShapePathPoint[],
  closed: boolean,
  samplesPerCurve = 16,
): MotionVector2[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [{ x: points[0].x, y: points[0].y }];
  }

  const samples = Math.max(1, Math.floor(samplesPerCurve));
  const ring: MotionVector2[] = [{ x: points[0].x, y: points[0].y }];

  const segmentCount = closed ? points.length : points.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const outHandle = readOutHandle(start);
    const inHandle = readInHandle(end);
    const isCurve = outHandle !== null || inHandle !== null;

    if (!isCurve) {
      if (!closed || index < segmentCount - 1) {
        ring.push({ x: end.x, y: end.y });
      }
      continue;
    }

    const startPoint: MotionVector2 = { x: start.x, y: start.y };
    const endPoint: MotionVector2 = { x: end.x, y: end.y };
    const control1: MotionVector2 = outHandle ?? startPoint;
    const control2: MotionVector2 = inHandle ?? endPoint;

    const lastStep = closed && index === segmentCount - 1 ? samples - 1 : samples;
    for (let step = 1; step <= lastStep; step += 1) {
      ring.push(cubicAt(startPoint, control1, control2, endPoint, step / samples));
    }
  }

  return ring;
}
