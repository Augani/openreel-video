import { describe, expect, it } from "vitest";
import {
  buildMotionPathData,
  centerMotionPathData,
  getEditableMotionShapePathPoints,
  getMotionPathDrawCommands,
  interpolateMotionPathPoints,
  setMotionShapePathPointHandle,
  getMotionShapePathDataAtTime,
  getMotionPathBounds,
  insertMotionShapePathPoint,
  morphMotionPathData,
  parseMotionPathData,
  parseMotionPathSegments,
  removeMotionShapePathPoint,
  setMotionShapePathPoint,
  upsertMotionShapePathKeyframe,
} from "./motion-shape-path";
import type { MotionShapePathPoint } from "./motion-shape-path";
import type { MotionShapeLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

const makePathLayer = (): MotionShapeLayer => ({
  id: "path-1",
  type: "shape",
  name: "Path",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "path",
  width: 100,
  height: 100,
  pathData: "M 0 0 L 100 0",
  pathClosed: false,
  style: {
    fill: { type: "none", opacity: 0 },
    stroke: { color: "#ffffff", width: 4, opacity: 1 },
    cornerRadius: 0,
  },
});

describe("motion shape paths", () => {
  it("parses line, horizontal, vertical, and close commands", () => {
    const points = parseMotionPathData("M 10 20 h 80 v 40 H 10 Z");

    expect(points).toEqual([
      { x: 10, y: 20 },
      { x: 90, y: 20 },
      { x: 90, y: 60 },
      { x: 10, y: 60 },
      { x: 10, y: 20 },
    ]);
    expect(buildMotionPathData(points)).toBe(
      "M 10 20 L 90 20 L 90 60 L 10 60 L 10 20",
    );
  });

  it("flattens cubic curves into deterministic points", () => {
    const points = parseMotionPathData("M0 0 C 0 100 100 100 100 0", 4);

    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[2]).toEqual({ x: 50, y: 75 });
    expect(points[4]).toEqual({ x: 100, y: 0 });
  });

  it("centers scaled path data for motion layer coordinates", () => {
    const centered = centerMotionPathData("M10 20 L 30 20 L 30 40 Z", {
      scaleX: 2,
      scaleY: 3,
      translateX: -20,
      translateY: -30,
    });

    expect(centered).toMatchObject({
      width: 40,
      height: 60,
      centerX: 20,
      centerY: 60,
      closed: true,
    });
    expect(centered?.pathData).toBe("M -20 -30 L 20 -30 L 20 30 L -20 -30");
    expect(getMotionPathBounds(parseMotionPathData(centered?.pathData))).toEqual({
      x: -20,
      y: -30,
      width: 40,
      height: 60,
    });
  });

  it("morphs equal-count open paths by preserving vertices", () => {
    const morphed = morphMotionPathData(
      "M 0 0 L 100 0",
      "M 0 100 L 100 100",
      0.5,
      3,
    );

    expect(morphed).toBe("M 0 50 L 100 50");
  });

  it("morphs mismatched-count paths via resampling fallback", () => {
    const morphed = morphMotionPathData(
      "M 0 0 L 100 0",
      "M 0 100 L 50 100 L 100 100",
      0.5,
      3,
    );

    expect(morphed).toBe("M 0 50 L 50 50 L 100 50");
  });

  it("evaluates path-data keyframes as morphing path data", () => {
    const layer = upsertMotionShapePathKeyframe(
      upsertMotionShapePathKeyframe(makePathLayer(), 0, {
        pathData: "M 0 0 L 100 0",
        easing: "linear",
        idFactory: () => "start",
      }),
      1,
      {
        pathData: "M 0 100 L 100 100",
        easing: "linear",
        idFactory: () => "end",
      },
    );

    const morphed = getMotionShapePathDataAtTime(layer, 0.5);
    const points = parseMotionPathData(morphed);

    expect(layer.keyframes.map((keyframe) => keyframe.property)).toEqual([
      "shape.pathData",
      "shape.pathData",
    ]);
    expect(points).toHaveLength(2);
    expect(points.every((point) => point.y === 50)).toBe(true);
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 50 });
  });

  it("edits path points as an editable polyline", () => {
    const moved = setMotionShapePathPoint(makePathLayer(), 1, {
      x: 120,
      y: 12,
    });
    const inserted = insertMotionShapePathPoint(moved, 0);
    const removed = removeMotionShapePathPoint(inserted, 1);

    expect(moved.pathData).toBe("M 0 0 L 120 12");
    expect(inserted.pathData).toBe("M 0 0 L 60 6 L 120 12");
    expect(removed.pathData).toBe("M 0 0 L 120 12");
  });

  it("does not expose duplicate closing points when editing closed paths", () => {
    const layer: MotionShapeLayer = {
      ...makePathLayer(),
      pathClosed: true,
      pathData: "M 0 0 L 100 0 L 100 100 Z",
    };

    expect(getEditableMotionShapePathPoints(layer)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(removeMotionShapePathPoint(layer, 1).pathData).toBe(layer.pathData);
  });

  it("can write edited path points into path morph keyframes", () => {
    const layer = upsertMotionShapePathKeyframe(makePathLayer(), 0, {
      pathData: "M 0 0 L 100 0",
      easing: "linear",
      idFactory: () => "start",
    });
    const edited = setMotionShapePathPoint(
      layer,
      1,
      { x: 100, y: 100 },
      {
        keyframe: true,
        localTime: 1,
        easing: "linear",
        idFactory: () => "end",
      },
    );

    expect(edited.pathData).toBe(layer.pathData);
    expect(edited.keyframes).toHaveLength(2);
    expect(edited.keyframes[1]).toMatchObject({
      id: "end",
      time: 1,
      property: "shape.pathData",
      value: "M 0 0 L 100 100",
    });
  });
});

describe("svg elliptical arc flattening", () => {
  const distanceToChord = (
    point: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => {
    const area = Math.abs(
      (b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y),
    );
    return area / Math.hypot(b.x - a.x, b.y - a.y);
  };

  it("samples a curved arc instead of drawing a straight chord", () => {
    const points = parseMotionPathData("M 0 0 A 50 50 0 0 1 100 0");
    expect(points.length).toBeGreaterThan(4);
    expect(points[points.length - 1].x).toBeCloseTo(100, 5);
    expect(points[points.length - 1].y).toBeCloseTo(0, 5);

    const start = points[0];
    const end = points[points.length - 1];
    const maxBulge = Math.max(
      ...points.map((point) => distanceToChord(point, start, end)),
    );
    expect(maxBulge).toBeGreaterThan(20);
  });

  it("reaches the endpoint for a half-circle traced through the upper side", () => {
    const points = parseMotionPathData("M 0 0 A 50 50 0 0 0 100 0");
    const end = points[points.length - 1];
    expect(end.x).toBeCloseTo(100, 5);
    expect(end.y).toBeCloseTo(0, 5);
    const maxY = Math.max(...points.map((point) => point.y));
    expect(maxY).toBeGreaterThan(20);
  });

  it("honors the sweep flag direction", () => {
    const sweepClockwise = parseMotionPathData("M 0 0 A 50 50 0 0 1 100 0");
    const sweepCounter = parseMotionPathData("M 0 0 A 50 50 0 0 0 100 0");
    const minYClockwise = Math.min(...sweepClockwise.map((point) => point.y));
    const maxYCounter = Math.max(...sweepCounter.map((point) => point.y));
    expect(minYClockwise).toBeLessThan(-20);
    expect(maxYCounter).toBeGreaterThan(20);
  });

  it("handles relative arc commands and applies x-axis rotation", () => {
    const points = parseMotionPathData("M 10 10 a 30 60 90 1 1 0 80");
    expect(points.length).toBeGreaterThan(4);
    const end = points[points.length - 1];
    expect(end.x).toBeCloseTo(10, 4);
    expect(end.y).toBeCloseTo(90, 4);
  });

  it("falls back to a line when radii are zero", () => {
    const points = parseMotionPathData("M 0 0 A 0 0 0 0 1 40 0");
    expect(points).toHaveLength(2);
    expect(points[1]).toMatchObject({ x: 40, y: 0 });
  });

  it("preserves bezier handles through parse/build round-trip", () => {
    const segments = parseMotionPathSegments("M 0 0 C 10 0 20 10 20 20");
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ x: 0, y: 0, outX: 10, outY: 0 });
    expect(segments[1]).toMatchObject({ x: 20, y: 20, inX: 20, inY: 10 });

    const rebuilt = buildMotionPathData(segments);
    expect(rebuilt).toBe("M 0 0 C 10 0 20 10 20 20");
  });

  it("round-trips bezier handles through build then parse within tolerance", () => {
    const points: MotionShapePathPoint[] = [
      { x: 0, y: 0, outX: 12.3456, outY: -4.2 },
      { x: 20.5, y: 20.5, inX: 8.1, inY: 15.9, outX: 33.7, outY: 41.2 },
      { x: 60.25, y: 5.75, inX: 45.5, inY: -3.5 },
    ];
    const roundTripped = parseMotionPathSegments(buildMotionPathData(points));
    expect(roundTripped).toHaveLength(points.length);
    for (let index = 0; index < points.length; index += 1) {
      const source = points[index];
      const result = roundTripped[index];
      expect(result.x).toBeCloseTo(source.x, 6);
      expect(result.y).toBeCloseTo(source.y, 6);
      if (source.outX !== undefined && source.outY !== undefined) {
        expect(result.outX).toBeCloseTo(source.outX, 6);
        expect(result.outY).toBeCloseTo(source.outY, 6);
      }
      if (source.inX !== undefined && source.inY !== undefined) {
        expect(result.inX).toBeCloseTo(source.inX, 6);
        expect(result.inY).toBeCloseTo(source.inY, 6);
      }
    }
  });

  it("interpolates vertices and handles at t=0.5 for equal-count paths", () => {
    const from: MotionShapePathPoint[] = [
      { x: 0, y: 0, outX: 10, outY: 0 },
      { x: 100, y: 0, inX: 90, inY: 0 },
    ];
    const to: MotionShapePathPoint[] = [
      { x: 0, y: 100, outX: 20, outY: 100 },
      { x: 100, y: 100, inX: 70, inY: 100 },
    ];
    const result = interpolateMotionPathPoints(from, to, 0.5);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ x: 0, y: 50, outX: 15, outY: 50 });
    expect(result[1]).toMatchObject({ x: 100, y: 50, inX: 80, inY: 50 });
  });

  it("keeps the equal-count fast path when only one keyframe is geometrically closed", () => {
    const from: MotionShapePathPoint[] = [
      { x: 0, y: 0, outX: 10, outY: 0 },
      { x: 100, y: 0, inX: 90, inY: 0 },
      { x: 0, y: 0, inX: -10, inY: 0 },
    ];
    const to: MotionShapePathPoint[] = [
      { x: 0, y: 100, outX: 20, outY: 100 },
      { x: 100, y: 100, inX: 70, inY: 100 },
      { x: 40, y: 100, inX: 30, inY: 100 },
    ];
    const result = interpolateMotionPathPoints(from, to, 0.5);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ x: 0, y: 50, outX: 15, outY: 50 });
    expect(result[1]).toMatchObject({ x: 100, y: 50, inX: 80, inY: 50 });
    expect(result[2]).toMatchObject({ x: 20, y: 50, inX: 10, inY: 50 });
  });

  it("keeps corners handle-less when both sides lack a handle", () => {
    const from: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const to: MotionShapePathPoint[] = [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];
    const result = interpolateMotionPathPoints(from, to, 0.5);
    expect(result[0]).toEqual({ x: 0, y: 50 });
    expect(result[1]).toEqual({ x: 100, y: 50 });
    expect(result[0].inX).toBeUndefined();
    expect(result[0].outX).toBeUndefined();
  });

  it("treats a missing handle as the vertex position when the other side has one", () => {
    const from: MotionShapePathPoint[] = [
      { x: 0, y: 0, outX: 20, outY: 0 },
      { x: 100, y: 0 },
    ];
    const to: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const result = interpolateMotionPathPoints(from, to, 0.5);
    expect(result[0].outX).toBeCloseTo(10, 6);
    expect(result[0].outY).toBeCloseTo(0, 6);
  });

  it("falls back to resample morph when counts mismatch", () => {
    const from: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const to: MotionShapePathPoint[] = [
      { x: 0, y: 100 },
      { x: 50, y: 100 },
      { x: 100, y: 100 },
    ];
    const result = interpolateMotionPathPoints(from, to, 0.5, 5);
    expect(result).toHaveLength(5);
    expect(() => interpolateMotionPathPoints(from, to, 0.5)).not.toThrow();
  });

  it("yields a cubic-containing path between two handled keyframes", () => {
    const layer = upsertMotionShapePathKeyframe(
      upsertMotionShapePathKeyframe(makePathLayer(), 0, {
        pathData: "M 0 0 C 10 0 20 10 20 20",
        easing: "linear",
        idFactory: () => "start",
      }),
      1,
      {
        pathData: "M 0 40 C 10 40 20 50 20 60",
        easing: "linear",
        idFactory: () => "end",
      },
    );
    const morphed = getMotionShapePathDataAtTime(layer, 0.5);
    expect(morphed).toMatch(/C/);
    const points = parseMotionPathSegments(morphed);
    expect(points[0].outY).toBeCloseTo(20, 6);
    expect(points[1]).toMatchObject({ x: 20, y: 40 });
  });

  it("emits cubic draw commands for curved segments and lines for corners", () => {
    const commands = getMotionPathDrawCommands(
      parseMotionPathSegments("M 0 0 L 10 0 C 20 0 30 10 30 20"),
    );
    expect(commands[0]).toEqual({ type: "move", x: 0, y: 0 });
    expect(commands[1]).toEqual({ type: "line", x: 10, y: 0 });
    expect(commands[2]).toMatchObject({ type: "cubic", x: 30, y: 20 });
  });

  it("keeps building plain M/L paths for handle-less points", () => {
    expect(buildMotionPathData([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(
      "M 0 0 L 10 10",
    );
  });

  it("preserves curve handles when moving an anchor point", () => {
    const curved = { ...makePathLayer(), pathData: "M 0 0 C 10 0 20 10 20 20" };
    const moved = setMotionShapePathPoint(curved, 1, { x: 30, y: 30 });
    expect(moved.pathData).toMatch(/C/);
    const points = getEditableMotionShapePathPoints(moved);
    expect(points[1]).toMatchObject({ x: 30, y: 30, inX: 30, inY: 20 });
  });

  it("sets a bezier handle on a path point", () => {
    const layer = setMotionShapePathPointHandle(
      makePathLayer(),
      0,
      "out",
      { x: 40, y: -20 },
    );
    expect(layer.pathData).toMatch(/C/);
    expect(getEditableMotionShapePathPoints(layer)[0]).toMatchObject({
      outX: 40,
      outY: -20,
    });
  });
});
