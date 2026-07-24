import { describe, expect, it } from "vitest";

import {
  MotionShapeBooleanError,
  flattenPathPointsToRing,
  mergeMotionShapeRings,
} from "./motion-shape-boolean";
import type { MotionShapePathPoint } from "./motion-shape-path";
import type { MotionVector2 } from "./types";

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
): MotionVector2[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const cornerKey = (point: MotionVector2): string =>
  `${Math.round(point.x)},${Math.round(point.y)}`;

const cornerSet = (rings: MotionVector2[][][]): Set<string> => {
  const set = new Set<string>();
  for (const ringSet of rings) {
    for (const ring of ringSet) {
      for (const point of ring) {
        set.add(cornerKey(point));
      }
    }
  }
  return set;
};

const ringCount = (rings: MotionVector2[][][]): number =>
  rings.reduce((total, ringSet) => total + ringSet.length, 0);

const signedArea = (ring: readonly MotionVector2[]): number => {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
};

describe("mergeMotionShapeRings", () => {
  it("unions two overlapping rects into a single ring covering all outer corners", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(50, 50, 100, 100)];

    const result = mergeMotionShapeRings([a, b], "union");

    expect(ringCount(result)).toBe(1);
    const corners = cornerSet(result);
    for (const corner of ["0,0", "100,0", "150,50", "150,150", "50,150", "0,100"]) {
      expect(corners.has(corner)).toBe(true);
    }
  });

  it("subtracts overlapping rect producing an L-shape (6 vertices)", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(50, 50, 100, 100)];

    const result = mergeMotionShapeRings([a, b], "subtract");

    expect(ringCount(result)).toBe(1);
    const uniqueVertices = new Set<string>();
    for (const ringSet of result) {
      for (const ring of ringSet) {
        for (const point of ring) {
          uniqueVertices.add(cornerKey(point));
        }
      }
    }
    expect(uniqueVertices.size).toBe(6);
    const corners = cornerSet(result);
    expect(corners.has("50,50")).toBe(true);
    expect(corners.has("50,100")).toBe(true);
    expect(corners.has("100,50")).toBe(true);
  });

  it("subtracts a fully-contained rect producing an outer ring plus a hole", () => {
    const outer = [rect(0, 0, 100, 100)];
    const inner = [rect(25, 25, 50, 50)];

    const result = mergeMotionShapeRings([outer, inner], "subtract");

    expect(ringCount(result)).toBe(2);
    const areas = result
      .flat()
      .map((ring) => signedArea(ring));
    const hasOuter = areas.some((area) => Math.abs(area) > 8000);
    const hasHole = areas.some((area) => Math.abs(area) > 2000 && Math.abs(area) < 3000);
    expect(hasOuter).toBe(true);
    expect(hasHole).toBe(true);
  });

  it("intersects disjoint rects into an empty result", () => {
    const a = [rect(0, 0, 10, 10)];
    const b = [rect(100, 100, 10, 10)];

    const result = mergeMotionShapeRings([a, b], "intersect");

    expect(ringCount(result)).toBe(0);
  });

  it("intersects overlapping rects into the overlap region", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(50, 50, 100, 100)];

    const result = mergeMotionShapeRings([a, b], "intersect");

    expect(ringCount(result)).toBe(1);
    const corners = cornerSet(result);
    for (const corner of ["50,50", "100,50", "100,100", "50,100"]) {
      expect(corners.has(corner)).toBe(true);
    }
  });

  it("excludes two identical rects into an empty result", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(0, 0, 100, 100)];

    const result = mergeMotionShapeRings([a, b], "exclude");

    expect(ringCount(result)).toBe(0);
  });

  it("unions three inputs into a single connected ring", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(80, 0, 100, 100)];
    const c = [rect(160, 0, 100, 100)];

    const result = mergeMotionShapeRings([a, b, c], "union");

    expect(ringCount(result)).toBe(1);
    const corners = cornerSet(result);
    expect(corners.has("0,0")).toBe(true);
    expect(corners.has("260,100")).toBe(true);
  });

  it("passes through unchanged for mode none", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(50, 50, 100, 100)];

    const result = mergeMotionShapeRings([a, b], "none");

    expect(ringCount(result)).toBe(2);
    expect(result[0][0]).toEqual(a[0]);
    expect(result[1][0]).toEqual(b[0]);
  });

  it("passes through a single input without invoking the library", () => {
    const a = [rect(0, 0, 100, 100)];

    const result = mergeMotionShapeRings([a], "union");

    expect(ringCount(result)).toBe(1);
    expect(result[0][0]).toEqual(a[0]);
  });

  it("filters empty inputs so a single non-empty input is a passthrough", () => {
    const a = [rect(0, 0, 100, 100)];

    const result = mergeMotionShapeRings([a, [], [[]]], "union");

    expect(ringCount(result)).toBe(1);
    expect(result[0][0]).toEqual(a[0]);
  });

  it("throws on a non-finite coordinate", () => {
    const a = [rect(0, 0, 100, 100)];
    const bad = [[{ x: Number.NaN, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]];

    expect(() => mergeMotionShapeRings([a, bad], "union")).toThrow(
      MotionShapeBooleanError,
    );
  });

  it("throws on a non-finite coordinate in a single-input passthrough", () => {
    const bad = [[{ x: Number.NaN, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]];

    expect(() => mergeMotionShapeRings([bad], "union")).toThrow(
      MotionShapeBooleanError,
    );
  });

  it("throws on a non-finite coordinate in mode none", () => {
    const a = [rect(0, 0, 100, 100)];
    const bad = [[{ x: 0, y: Number.NaN }]];

    expect(() => mergeMotionShapeRings([a, bad], "none")).toThrow(
      MotionShapeBooleanError,
    );
  });

  it("throws MotionShapeBooleanError carrying the mode when the library fails", () => {
    try {
      mergeMotionShapeRings(
        [[[{ x: Number.POSITIVE_INFINITY, y: 0 }]], [rect(0, 0, 1, 1)]],
        "intersect",
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MotionShapeBooleanError);
      if (error instanceof MotionShapeBooleanError) {
        expect(error.mode).toBe("intersect");
      }
    }
  });
});

describe("flattenPathPointsToRing", () => {
  const CIRCLE_KAPPA = 0.5522847498307936;

  const circlePoints = (radius: number): MotionShapePathPoint[] => {
    const control = radius * CIRCLE_KAPPA;
    return [
      { x: radius, y: 0, outX: radius, outY: control, inX: radius, inY: -control },
      { x: 0, y: radius, outX: -control, outY: radius, inX: control, inY: radius },
      { x: -radius, y: 0, outX: -radius, outY: -control, inX: -radius, inY: control },
      { x: 0, y: -radius, outX: control, outY: -radius, inX: -control, inY: -radius },
    ];
  };

  it("passes line segments through as the polyline", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];

    const ring = flattenPathPointsToRing(points, true);

    expect(ring).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("returns an open polyline unchanged in point count for open paths", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ];

    const ring = flattenPathPointsToRing(points, false);

    expect(ring).toHaveLength(3);
  });

  it("samples a cubic circle approximation with 4*16 points within 1% radial error", () => {
    const radius = 100;
    const ring = flattenPathPointsToRing(circlePoints(radius), true, 16);

    expect(ring).toHaveLength(4 * 16);
    let maxError = 0;
    for (const point of ring) {
      const distance = Math.hypot(point.x, point.y);
      maxError = Math.max(maxError, Math.abs(distance - radius));
    }
    expect(maxError).toBeLessThan(radius * 0.01);
  });

  it("respects a custom samplesPerCurve count", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0, outX: 33, outY: 0 },
      { x: 100, y: 0, inX: 66, inY: 0 },
    ];

    const ring = flattenPathPointsToRing(points, false, 8);

    expect(ring.length).toBe(1 + 8);
  });
});
