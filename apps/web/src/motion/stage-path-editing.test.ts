import { describe, expect, it } from "vitest";
import type { MotionShapePathPoint } from "@openreel/core";
import {
  moveHandle,
  moveVertex,
  penAddCorner,
  penDragHandles,
  penShouldClose,
  shouldShowSelectionHandles,
  toggleVertexSmooth,
} from "./stage-path-editing";

describe("penAddCorner", () => {
  it("appends a handle-less vertex", () => {
    const points: MotionShapePathPoint[] = [{ x: 0, y: 0 }];
    const next = penAddCorner(points, { x: 10, y: 20 });
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ x: 10, y: 20 });
    expect(next[1]?.outX).toBeUndefined();
    expect(next[1]?.inX).toBeUndefined();
  });

  it("does not mutate the input array", () => {
    const points: MotionShapePathPoint[] = [{ x: 0, y: 0 }];
    penAddCorner(points, { x: 5, y: 5 });
    expect(points).toHaveLength(1);
  });

  it("appends to an empty array", () => {
    const next = penAddCorner([], { x: 3, y: 7 });
    expect(next).toEqual([{ x: 3, y: 7 }]);
  });
});

describe("penDragHandles", () => {
  it("yields symmetric in/out handles mirrored about the anchor", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const next = penDragHandles(points, {
      anchor: { x: 100, y: 100 },
      current: { x: 130, y: 140 },
    });
    const last = next[next.length - 1];
    expect(last?.x).toBe(100);
    expect(last?.y).toBe(100);
    expect(last?.outX).toBe(130);
    expect(last?.outY).toBe(140);
    expect(last?.inX).toBe(70);
    expect(last?.inY).toBe(60);
  });

  it("replaces only the last vertex handles, leaving prior vertices intact", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0, outX: 1, outY: 2 },
      { x: 50, y: 50 },
    ];
    const next = penDragHandles(points, {
      anchor: { x: 50, y: 50 },
      current: { x: 60, y: 70 },
    });
    expect(next[0]).toEqual({ x: 0, y: 0, outX: 1, outY: 2 });
  });

  it("returns the input unchanged when there are no points", () => {
    expect(penDragHandles([], { anchor: { x: 0, y: 0 }, current: { x: 1, y: 1 } })).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const points: MotionShapePathPoint[] = [{ x: 10, y: 10 }];
    penDragHandles(points, { anchor: { x: 10, y: 10 }, current: { x: 20, y: 20 } });
    expect(points[0]).toEqual({ x: 10, y: 10 });
  });
});

describe("penShouldClose", () => {
  const points: MotionShapePathPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("is true within tolerance of the first point", () => {
    expect(penShouldClose(points, { x: 3, y: 4 }, 8)).toBe(true);
  });

  it("is false outside tolerance of the first point", () => {
    expect(penShouldClose(points, { x: 50, y: 50 }, 8)).toBe(false);
  });

  it("is false with fewer than 3 points", () => {
    expect(
      penShouldClose(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        { x: 0, y: 0 },
        8,
      ),
    ).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(penShouldClose([], { x: 0, y: 0 }, 8)).toBe(false);
  });
});

describe("shouldShowSelectionHandles", () => {
  it("shows handles for the sole selected unlocked layer", () => {
    expect(
      shouldShowSelectionHandles({
        layerId: "a",
        selectedLayerId: "a",
        selectionCount: 1,
        locked: false,
        penDraftLayerId: null,
      }),
    ).toBe(true);
  });

  it("hides handles for a non-active layer", () => {
    expect(
      shouldShowSelectionHandles({
        layerId: "b",
        selectedLayerId: "a",
        selectionCount: 1,
        locked: false,
        penDraftLayerId: null,
      }),
    ).toBe(false);
  });

  it("hides handles when multiple layers are selected", () => {
    expect(
      shouldShowSelectionHandles({
        layerId: "a",
        selectedLayerId: "a",
        selectionCount: 2,
        locked: false,
        penDraftLayerId: null,
      }),
    ).toBe(false);
  });

  it("hides handles for a locked layer", () => {
    expect(
      shouldShowSelectionHandles({
        layerId: "a",
        selectedLayerId: "a",
        selectionCount: 1,
        locked: true,
        penDraftLayerId: null,
      }),
    ).toBe(false);
  });

  it("hides handles while the layer is the active pen draft so the close click reaches the stage", () => {
    expect(
      shouldShowSelectionHandles({
        layerId: "a",
        selectedLayerId: "a",
        selectionCount: 1,
        locked: false,
        penDraftLayerId: "a",
      }),
    ).toBe(false);
  });

  it("still shows handles for a different selected layer while an unrelated pen draft exists", () => {
    expect(
      shouldShowSelectionHandles({
        layerId: "a",
        selectedLayerId: "a",
        selectionCount: 1,
        locked: false,
        penDraftLayerId: "z",
      }),
    ).toBe(true);
  });
});

describe("moveVertex", () => {
  it("translates the vertex and its handles by the delta", () => {
    const points: MotionShapePathPoint[] = [
      { x: 10, y: 10, outX: 20, outY: 10, inX: 0, inY: 10 },
      { x: 100, y: 100 },
    ];
    const next = moveVertex(points, 0, { x: 5, y: -5 });
    expect(next[0]).toEqual({ x: 15, y: 5, outX: 25, outY: 5, inX: 5, inY: 5 });
    expect(next[1]).toEqual({ x: 100, y: 100 });
  });

  it("leaves undefined handles undefined", () => {
    const points: MotionShapePathPoint[] = [{ x: 0, y: 0 }];
    const next = moveVertex(points, 0, { x: 3, y: 4 });
    expect(next[0]).toEqual({ x: 3, y: 4 });
  });

  it("returns a copy for out-of-range index without mutating", () => {
    const points: MotionShapePathPoint[] = [{ x: 0, y: 0 }];
    const next = moveVertex(points, 5, { x: 3, y: 4 });
    expect(next).toEqual(points);
    expect(next).not.toBe(points);
  });
});

describe("moveHandle", () => {
  it("symmetric drag of out mirrors in about the vertex", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const next = moveHandle(points, 0, "out", { x: 30, y: 40 }, true);
    expect(next[0]?.outX).toBe(30);
    expect(next[0]?.outY).toBe(40);
    expect(next[0]?.inX).toBe(-30);
    expect(next[0]?.inY).toBe(-40);
  });

  it("asymmetric drag of out leaves in untouched", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0, inX: -10, inY: -10 },
      { x: 100, y: 100 },
    ];
    const next = moveHandle(points, 0, "out", { x: 30, y: 40 }, false);
    expect(next[0]?.outX).toBe(30);
    expect(next[0]?.outY).toBe(40);
    expect(next[0]?.inX).toBe(-10);
    expect(next[0]?.inY).toBe(-10);
  });

  it("symmetric drag of in mirrors out about the vertex", () => {
    const points: MotionShapePathPoint[] = [{ x: 10, y: 10 }];
    const next = moveHandle(points, 0, "in", { x: 4, y: 6 }, true);
    expect(next[0]?.inX).toBe(4);
    expect(next[0]?.inY).toBe(6);
    expect(next[0]?.outX).toBe(16);
    expect(next[0]?.outY).toBe(14);
  });

  it("returns a copy for out-of-range index", () => {
    const points: MotionShapePathPoint[] = [{ x: 0, y: 0 }];
    const next = moveHandle(points, 3, "out", { x: 1, y: 1 }, true);
    expect(next).toEqual(points);
    expect(next).not.toBe(points);
  });
});

describe("toggleVertexSmooth", () => {
  it("corner to smooth adds handles one third toward neighbors", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
    ];
    const next = toggleVertexSmooth(points, 1, false);
    const mid = next[1];
    expect(mid?.inX).toBeCloseTo(20, 6);
    expect(mid?.inY).toBeCloseTo(0, 6);
    expect(mid?.outX).toBeCloseTo(30, 6);
    expect(mid?.outY).toBeCloseTo(10, 6);
  });

  it("smooth to corner drops handles", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0, inX: 20, inY: 0, outX: 30, outY: 10 },
      { x: 30, y: 30 },
    ];
    const next = toggleVertexSmooth(points, 1, false);
    expect(next[1]).toEqual({ x: 30, y: 0 });
  });

  it("round-trips corner to smooth to corner", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
    ];
    const roundTrip = toggleVertexSmooth(
      toggleVertexSmooth(points, 1, false),
      1,
      false,
    );
    expect(roundTrip[1]).toEqual({ x: 30, y: 0 });
  });

  it("returns a copy for out-of-range index", () => {
    const points: MotionShapePathPoint[] = [{ x: 0, y: 0 }];
    const next = toggleVertexSmooth(points, 4, false);
    expect(next).toEqual(points);
    expect(next).not.toBe(points);
  });

  it("does not wrap endpoints on an open path", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
    ];
    const next = toggleVertexSmooth(points, 0, false);
    const first = next[0];
    expect(first?.outX).toBeCloseTo(10, 6);
    expect(first?.outY).toBeCloseTo(0, 6);
    expect(first?.inX).toBeCloseTo(0, 6);
    expect(first?.inY).toBeCloseTo(0, 6);
  });

  it("wraps the first vertex to the last neighbor on a closed path without a duplicate closing point", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    const next = toggleVertexSmooth(points, 0, true);
    const first = next[0];
    expect(first?.inX).toBeCloseTo(0, 6);
    expect(first?.inY).toBeCloseTo(10, 6);
    expect(first?.outX).toBeCloseTo(10, 6);
    expect(first?.outY).toBeCloseTo(0, 6);
  });

  it("wraps the last vertex to the first neighbor on a closed path without a duplicate closing point", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    const next = toggleVertexSmooth(points, 3, true);
    const last = next[3];
    expect(last?.inX).toBeCloseTo(10, 6);
    expect(last?.inY).toBeCloseTo(30, 6);
    expect(last?.outX).toBeCloseTo(0, 6);
    expect(last?.outY).toBeCloseTo(20, 6);
  });
});
