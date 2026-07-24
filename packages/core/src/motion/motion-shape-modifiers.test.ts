import { describe, expect, it } from "vitest";
import type {
  MotionOffsetPathsModifier,
  MotionRepeaterModifier,
  MotionRoundCornersModifier,
  MotionShapeLayer,
  MotionShapeModifier,
  MotionTrimPathsModifier,
  MotionTwistModifier,
  MotionWigglePathsModifier,
  MotionZigZagModifier,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type { MotionShapePathPoint } from "./motion-shape-path";
import {
  addMotionShapeModifier,
  applyMotionOffsetPathsToPoints,
  applyMotionPuckerBloatToPoints,
  applyMotionShapeOperatorStack,
  applyMotionTwistToPoints,
  buildMotionShapePolyline,
  buildMotionSvgPathData,
  createMotionShapeModifier,
  getMotionRepeaterCopies,
  getMotionRepeaterModifier,
  getMotionRoundCornersModifier,
  getMotionShapeModifierKeyframeProperty,
  getMotionTrimPathsModifier,
  getMotionWigglePathsModifier,
  getMotionZigZagModifier,
  getTrimmedMotionPathPoints,
  evaluateMotionShapeModifiersAtTime,
  toggleMotionShapeModifier,
  updateMotionShapeModifier,
} from "./motion-shape-modifiers";
import { upsertMotionShapePathKeyframe } from "./motion-shape-path";

const makeShapeLayer = (): MotionShapeLayer => ({
  id: "shape-1",
  type: "shape",
  name: "Box",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 50,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#ffffff", width: 4, opacity: 1 },
    cornerRadius: 0,
  },
});

const makeTrimPathsModifier = (id = "trim-1"): MotionTrimPathsModifier => {
  const modifier = createMotionShapeModifier("trim-paths", id);
  if (modifier.type !== "trim-paths") {
    throw new Error("Expected Trim Paths modifier");
  }
  return modifier;
};

const makeRepeaterModifier = (id = "repeat-1"): MotionRepeaterModifier => {
  const modifier = createMotionShapeModifier("repeater", id);
  if (modifier.type !== "repeater") {
    throw new Error("Expected Repeater modifier");
  }
  return modifier;
};

const makeZigZagModifier = (id = "zig-1"): MotionZigZagModifier => {
  const modifier = createMotionShapeModifier("zig-zag", id);
  if (modifier.type !== "zig-zag") {
    throw new Error("Expected Zig Zag modifier");
  }
  return modifier;
};

const makeRoundCornersModifier = (
  id = "round-1",
): MotionRoundCornersModifier => {
  const modifier = createMotionShapeModifier("round-corners", id);
  if (modifier.type !== "round-corners") {
    throw new Error("Expected Round Corners modifier");
  }
  return modifier;
};

const makeWigglePathsModifier = (
  id = "wiggle-1",
): MotionWigglePathsModifier => {
  const modifier = createMotionShapeModifier("wiggle-paths", id);
  if (modifier.type !== "wiggle-paths") {
    throw new Error("Expected Wiggle Paths modifier");
  }
  return modifier;
};

describe("motion shape modifiers", () => {
  it("adds and updates Trim Paths immutably", () => {
    const layer = makeShapeLayer();
    const modifier = makeTrimPathsModifier("trim-1");
    const withModifier = addMotionShapeModifier(layer, modifier);
    const updated = updateMotionShapeModifier(
      withModifier,
      "trim-1",
      (current) =>
        current.type === "trim-paths"
          ? { ...current, end: 45, offset: 90 }
          : current,
    );
    const disabled = toggleMotionShapeModifier(updated, "trim-1", false);

    expect(layer.modifiers).toBeUndefined();
    expect(getMotionTrimPathsModifier(updated)).toMatchObject({
      id: "trim-1",
      end: 45,
      offset: 90,
    });
    expect(getMotionTrimPathsModifier(disabled)?.enabled).toBe(false);
  });

  it("builds rectangle shape paths from centered layer bounds", () => {
    expect(buildMotionShapePolyline(makeShapeLayer())).toEqual([
      { x: -50, y: -25 },
      { x: 50, y: -25 },
      { x: 50, y: 25 },
      { x: -50, y: 25 },
      { x: -50, y: -25 },
    ]);
  });

  it("builds a two-point polyline for line shapes", () => {
    const layer: MotionShapeLayer = { ...makeShapeLayer(), shapeType: "line" };
    expect(buildMotionShapePolyline(layer)).toEqual([
      { x: -50, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("builds a regular polygon with the requested side count", () => {
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "polygon",
      width: 100,
      height: 100,
      style: { ...makeShapeLayer().style, points: 5 },
    };
    const points = buildMotionShapePolyline(layer);
    expect(points).toHaveLength(6);
    expect(points[0].x).toBeCloseTo(0, 5);
    expect(points[0].y).toBeCloseTo(-50, 5);
    expect(points[points.length - 1].x).toBeCloseTo(points[0].x, 5);
    expect(points[points.length - 1].y).toBeCloseTo(points[0].y, 5);
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(50, 5);
    }
  });

  it("defaults the polygon to a pentagon when no side count is set", () => {
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "polygon",
      width: 80,
      height: 80,
    };
    const points = buildMotionShapePolyline(layer);
    expect(points).toHaveLength(6);
  });

  it("clamps polygon side count to 3..24", () => {
    const few: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "polygon",
      style: { ...makeShapeLayer().style, points: 1 },
    };
    const many: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "polygon",
      style: { ...makeShapeLayer().style, points: 99 },
    };
    expect(buildMotionShapePolyline(few)).toHaveLength(4);
    expect(buildMotionShapePolyline(many)).toHaveLength(25);
  });

  it("builds a star with the requested point and inner-radius ratio", () => {
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "star",
      width: 100,
      height: 100,
      style: { ...makeShapeLayer().style, points: 7, innerRadius: 0.3 },
    };
    const points = buildMotionShapePolyline(layer);
    expect(points).toHaveLength(15);
    const outerRadius = 50;
    const radiusOf = (point: { x: number; y: number }): number =>
      Math.hypot(point.x, point.y);
    expect(radiusOf(points[0])).toBeCloseTo(outerRadius, 5);
    expect(radiusOf(points[1])).toBeCloseTo(outerRadius * 0.3, 5);
  });

  it("clamps star point count to 3..24 and inner radius to 0.05..0.95", () => {
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "star",
      width: 100,
      height: 100,
      style: { ...makeShapeLayer().style, points: 99, innerRadius: 5 },
    };
    const points = buildMotionShapePolyline(layer);
    expect(points).toHaveLength(24 * 2 + 1);
    expect(Math.hypot(points[1].x, points[1].y)).toBeCloseTo(50 * 0.95, 5);
  });

  it("builds a closed arrow outline that points to the right edge", () => {
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "arrow",
      width: 120,
      height: 60,
    };
    const points = buildMotionShapePolyline(layer);
    expect(points.length).toBeGreaterThan(4);
    expect(points[0]).toEqual(points[points.length - 1]);
    const tip = points.reduce((best, point) =>
      point.x > best.x ? point : best,
    );
    expect(tip).toEqual({ x: 60, y: 0 });
  });

  it("trims a rectangle path by path percentage", () => {
    const layer = makeShapeLayer();
    const points = getTrimmedMotionPathPoints(
      buildMotionShapePolyline(layer),
      {
        ...makeTrimPathsModifier("trim-1"),
        end: 50,
      },
    );

    expect(points).toEqual([
      { x: -50, y: -25 },
      { x: 50, y: -25 },
      { x: 50, y: 25 },
    ]);
    expect(buildMotionSvgPathData(points)).toBe("M -50 -25 L 50 -25 L 50 25");
  });

  it("builds editable path shape polylines from path data", () => {
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      shapeType: "path",
      width: 100,
      height: 100,
      pathData: "M -50 -50 L 50 -50 L 0 50 Z",
      pathClosed: true,
    };

    expect(buildMotionShapePolyline(layer)).toEqual([
      { x: -50, y: -50 },
      { x: 50, y: -50 },
      { x: 0, y: 50 },
      { x: -50, y: -50 },
    ]);
  });

  it("applies Zig Zag peaks along shape segments", () => {
    const layer = addMotionShapeModifier(
      {
        ...makeShapeLayer(),
        shapeType: "path",
        pathData: "M 0 0 L 100 0",
        pathClosed: false,
      },
      {
        ...makeZigZagModifier("zig-1"),
        size: 10,
        ridgesPerSegment: 2,
      },
    );

    expect(getMotionZigZagModifier(layer)).toMatchObject({
      id: "zig-1",
      size: 10,
      ridgesPerSegment: 2,
    });
    const points = buildMotionShapePolyline(layer);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1].x).toBeCloseTo(100 / 3);
    expect(points[1].y).toBe(10);
    expect(points[2].x).toBeCloseTo(200 / 3);
    expect(points[2].y).toBe(-10);
    expect(points[3]).toEqual({ x: 100, y: 0 });
  });

  it("normalizes Zig Zag values and leaves disabled modifiers inert", () => {
    const layer = addMotionShapeModifier(
      {
        ...makeShapeLayer(),
        shapeType: "path",
        pathData: "M 0 0 L 100 0",
        pathClosed: false,
      },
      {
        ...makeZigZagModifier("zig-1"),
        enabled: false,
        size: 9999,
        ridgesPerSegment: 999,
      },
    );

    expect(getMotionZigZagModifier(layer)).toMatchObject({
      size: 4000,
      ridgesPerSegment: 128,
      enabled: false,
    });
    expect(buildMotionShapePolyline(layer)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("rounds closed shape corners with generated curve samples", () => {
    const layer = addMotionShapeModifier(
      makeShapeLayer(),
      {
        ...makeRoundCornersModifier("round-1"),
        radius: 10,
        segments: 2,
      },
    );

    expect(getMotionRoundCornersModifier(layer)).toMatchObject({
      id: "round-1",
      radius: 10,
      segments: 2,
    });
    const points = buildMotionShapePolyline(layer);
    expect(points).toHaveLength(13);
    expect(points[0]).toEqual({ x: -50, y: -15 });
    expect(points[1]).toEqual({ x: -47.5, y: -22.5 });
    expect(points[2]).toEqual({ x: -40, y: -25 });
    expect(points[3]).toEqual({ x: 40, y: -25 });
    expect(points[points.length - 1]).toEqual(points[0]);
  });

  it("rounds interior corners on open paths without moving endpoints", () => {
    const layer = addMotionShapeModifier(
      {
        ...makeShapeLayer(),
        shapeType: "path",
        pathData: "M 0 0 L 100 0 L 100 100",
        pathClosed: false,
      },
      {
        ...makeRoundCornersModifier("round-1"),
        radius: 20,
        segments: 2,
      },
    );

    const points = buildMotionShapePolyline(layer);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 95, y: 5 },
      { x: 100, y: 20 },
      { x: 100, y: 100 },
    ]);
  });

  it("normalizes Round Corners values and leaves disabled modifiers inert", () => {
    const layer = addMotionShapeModifier(
      makeShapeLayer(),
      {
        ...makeRoundCornersModifier("round-1"),
        enabled: false,
        radius: 9999,
        segments: 999,
      },
    );

    expect(getMotionRoundCornersModifier(layer)).toMatchObject({
      radius: 4000,
      segments: 48,
      enabled: false,
    });
    expect(buildMotionShapePolyline(layer)).toEqual([
      { x: -50, y: -25 },
      { x: 50, y: -25 },
      { x: 50, y: 25 },
      { x: -50, y: 25 },
      { x: -50, y: -25 },
    ]);
  });

  it("applies deterministic animated Wiggle Paths detail", () => {
    const layer = addMotionShapeModifier(
      {
        ...makeShapeLayer(),
        shapeType: "path",
        pathData: "M 0 0 L 100 0 L 100 100",
        pathClosed: false,
      },
      {
        ...makeWigglePathsModifier("wiggle-1"),
        size: 10,
        detail: 1,
        speed: 1,
        seed: 42,
      },
    );

    expect(getMotionWigglePathsModifier(layer)).toMatchObject({
      id: "wiggle-1",
      size: 10,
      detail: 1,
      speed: 1,
      seed: 42,
    });
    const pointsAtStart = buildMotionShapePolyline(layer, 96, 0);
    const pointsAtStartAgain = buildMotionShapePolyline(layer, 96, 0);
    const pointsLater = buildMotionShapePolyline(layer, 96, 0.25);

    expect(pointsAtStart).toEqual(pointsAtStartAgain);
    expect(pointsAtStart).toHaveLength(5);
    expect(pointsAtStart[0]).toEqual({ x: 0, y: 0 });
    expect(pointsAtStart[pointsAtStart.length - 1]).toEqual({ x: 100, y: 100 });
    expect(pointsAtStart[1]).not.toEqual({ x: 50, y: 0 });
    expect(pointsLater[1]).not.toEqual(pointsAtStart[1]);
  });

  it("normalizes Wiggle Paths values and leaves disabled modifiers inert", () => {
    const layer = addMotionShapeModifier(
      makeShapeLayer(),
      {
        ...makeWigglePathsModifier("wiggle-1"),
        enabled: false,
        size: 9999,
        detail: 999,
        speed: 999,
        seed: 1.2,
      },
    );

    expect(getMotionWigglePathsModifier(layer)).toMatchObject({
      size: 4000,
      detail: 32,
      speed: 60,
      seed: 1,
      enabled: false,
    });
    expect(buildMotionShapePolyline(layer)).toEqual([
      { x: -50, y: -25 },
      { x: 50, y: -25 },
      { x: 50, y: 25 },
      { x: -50, y: 25 },
      { x: -50, y: -25 },
    ]);
  });

  it("builds path polylines from evaluated path morph keyframes", () => {
    const layer = upsertMotionShapePathKeyframe(
      upsertMotionShapePathKeyframe(
        {
          ...makeShapeLayer(),
          shapeType: "path",
          pathData: "M 0 0 L 100 0",
          pathClosed: false,
        },
        0,
        {
          pathData: "M 0 0 L 100 0",
          easing: "linear",
          idFactory: () => "start",
        },
      ),
      1,
      {
        pathData: "M 0 100 L 100 100",
        easing: "linear",
        idFactory: () => "end",
      },
    );

    const points = buildMotionShapePolyline(layer, 96, 0.5);

    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 0, y: 50 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 50 });
  });

  it("keeps a full Trim Paths range visible", () => {
    const layer = makeShapeLayer();
    const points = getTrimmedMotionPathPoints(
      buildMotionShapePolyline(layer),
      makeTrimPathsModifier("trim-1"),
    );

    expect(points).toEqual(buildMotionShapePolyline(layer));
  });

  it("supports wrapped trim ranges with offset", () => {
    const layer = makeShapeLayer();
    const points = getTrimmedMotionPathPoints(
      buildMotionShapePolyline(layer),
      {
        ...makeTrimPathsModifier("trim-1"),
        start: 75,
        end: 25,
      },
    );

    expect(points[0]).toEqual({ x: -25, y: 25 });
    expect(points[points.length - 1]).toEqual({ x: 25, y: -25 });
  });

  it("evaluates Repeater copy transforms", () => {
    const layer = addMotionShapeModifier(
      makeShapeLayer(),
      {
        ...makeRepeaterModifier("repeat-1"),
        copies: 3,
        offset: 1,
        transform: {
          position: { x: 10, y: 5 },
          scale: { x: 2, y: 1 },
          rotation: 15,
          opacity: 0.5,
        },
      },
    );

    const repeater = getMotionRepeaterModifier(layer);
    const copies = getMotionRepeaterCopies(repeater);

    expect(repeater).toMatchObject({ id: "repeat-1", copies: 3 });
    expect(copies).toEqual([
      {
        index: 0,
        amount: 1,
        position: { x: 10, y: 5 },
        scale: { x: 2, y: 1 },
        rotation: 15,
        opacity: 1,
      },
      {
        index: 1,
        amount: 2,
        position: { x: 20, y: 10 },
        scale: { x: 4, y: 1 },
        rotation: 30,
        opacity: 0.5,
      },
      {
        index: 2,
        amount: 3,
        position: { x: 30, y: 15 },
        scale: { x: 8, y: 1 },
        rotation: 45,
        opacity: 0.25,
      },
    ]);
  });
});

const square = (half: number): MotionShapePathPoint[] => [
  { x: -half, y: -half },
  { x: half, y: -half },
  { x: half, y: half },
  { x: -half, y: half },
  { x: -half, y: -half },
];

const ringArea = (ring: readonly MotionShapePathPoint[]): number => {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

const maxRadius = (ring: readonly MotionShapePathPoint[]): number =>
  Math.max(...ring.map((point) => Math.hypot(point.x, point.y)));

describe("motion shape operators", () => {
  it("offsets a closed square outward by amount within miter tolerance", () => {
    const result = applyMotionOffsetPathsToPoints(square(50), 10, "miter");
    const corner = maxRadius(result);
    const expectedCorner = Math.hypot(60, 60);
    expect(corner).toBeGreaterThan(50);
    expect(Math.abs(corner - expectedCorner)).toBeLessThan(1);
  });

  it("insets a closed square with negative offset", () => {
    const result = applyMotionOffsetPathsToPoints(square(50), -10, "miter");
    const bounds = Math.max(...result.map((point) => Math.abs(point.x)));
    expect(bounds).toBeLessThan(45);
    expect(bounds).toBeGreaterThan(35);
  });

  it("returns open paths unchanged from offset", () => {
    const open: MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(applyMotionOffsetPathsToPoints(open, 10, "miter")).toEqual(open);
  });

  it("puckers vertices toward the centroid halving radius at amount -50", () => {
    const result = applyMotionPuckerBloatToPoints(square(50), -50);
    expect(maxRadius(result)).toBeCloseTo(maxRadius(square(50)) / 2, 5);
  });

  it("collapses toward centroid at pucker -100", () => {
    const result = applyMotionPuckerBloatToPoints(square(50), -100);
    expect(maxRadius(result)).toBeCloseTo(0, 5);
  });

  it("bloats symmetrically at amount +50", () => {
    const result = applyMotionPuckerBloatToPoints(square(50), 50);
    expect(maxRadius(result)).toBeCloseTo(maxRadius(square(50)) * 1.5, 5);
  });

  it("twists center-adjacent vertices more than rim vertices (monotonic falloff)", () => {
    const ring: MotionShapePathPoint[] = [
      { x: 10, y: 0 },
      { x: 40, y: 0 },
      { x: 100, y: 0 },
    ];
    const center = { x: 0, y: 0 };
    const result = applyMotionTwistToPoints(ring, 90, center);
    const angleOf = (point: MotionShapePathPoint): number =>
      Math.atan2(point.y, point.x);
    const near = angleOf(result[0]);
    const mid = angleOf(result[1]);
    const rim = angleOf(result[2]);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(rim);
    expect(Math.abs(rim)).toBeLessThan(1e-6);
  });

  it("leaves twist a no-op when maxDist is zero", () => {
    const ring: MotionShapePathPoint[] = [{ x: 5, y: 5 }];
    expect(applyMotionTwistToPoints(ring, 90, { x: 5, y: 5 })).toEqual(ring);
  });

  it("produces different geometry for offset then twist vs twist then offset", () => {
    const offset = createMotionShapeModifier("offset-paths", "off-1");
    const twist = createMotionShapeModifier("twist", "tw-1");
    if (offset.type !== "offset-paths" || twist.type !== "twist") {
      throw new Error("bad presets");
    }
    const strongTwist: MotionTwistModifier = {
      ...twist,
      angle: 120,
      center: { x: 40, y: 0 },
    };
    const strongOffset: MotionOffsetPathsModifier = { ...offset, amount: 30 };
    const base: MotionShapePathPoint[][][] = [[square(50)]];
    const forward = applyMotionShapeOperatorStack(base, [
      strongOffset,
      strongTwist,
    ]);
    const reverse = applyMotionShapeOperatorStack(base, [
      strongTwist,
      strongOffset,
    ]);
    expect(JSON.stringify(forward)).not.toEqual(JSON.stringify(reverse));
  });

  it("triples ring count via a repeater in the stack", () => {
    const repeater = createMotionShapeModifier("repeater", "rep-1");
    if (repeater.type !== "repeater") throw new Error("bad preset");
    const tripled: MotionRepeaterModifier = { ...repeater, copies: 3 };
    const base: MotionShapePathPoint[][][] = [[square(20)]];
    const result = applyMotionShapeOperatorStack(base, [tripled]);
    const totalRings = result.reduce((sum, set) => sum + set.length, 0);
    expect(totalRings).toBe(3);
  });

  it("bakes repeater copy translation into ring points", () => {
    const repeater = createMotionShapeModifier("repeater", "rep-2");
    if (repeater.type !== "repeater") throw new Error("bad preset");
    const two: MotionRepeaterModifier = {
      ...repeater,
      copies: 2,
      transform: {
        position: { x: 100, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
    };
    const base: MotionShapePathPoint[][][] = [[square(10)]];
    const result = applyMotionShapeOperatorStack(base, [two]);
    const firstX = result[0][0][0].x;
    const secondX = result[1][0][0].x;
    expect(secondX - firstX).toBeCloseTo(100, 5);
  });

  it("shortens a ring via trim in the stack", () => {
    const trim = createMotionShapeModifier("trim-paths", "trim-9");
    if (trim.type !== "trim-paths") throw new Error("bad preset");
    const half: MotionTrimPathsModifier = { ...trim, start: 0, end: 50 };
    const base: MotionShapePathPoint[][][] = [[square(50)]];
    const full = ringArea(base[0][0]);
    const result = applyMotionShapeOperatorStack(base, [half]);
    const trimmedLength = result[0][0].length;
    expect(trimmedLength).toBeGreaterThan(1);
    expect(ringArea(result[0][0])).toBeLessThan(full);
  });

  it("creates the three new operators with defaults", () => {
    const offset = createMotionShapeModifier("offset-paths");
    const pucker = createMotionShapeModifier("pucker-bloat");
    const twist = createMotionShapeModifier("twist");
    expect(offset).toMatchObject({
      type: "offset-paths",
      enabled: true,
      amount: 10,
      lineJoin: "miter",
    });
    expect(pucker).toMatchObject({ type: "pucker-bloat", amount: 0 });
    expect(twist).toMatchObject({
      type: "twist",
      angle: 0,
      center: { x: 0, y: 0 },
    });
  });

  it("keyframes the new operator params through evaluation", () => {
    const twist = createMotionShapeModifier("twist", "tw-key");
    if (twist.type !== "twist") throw new Error("bad preset");
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      modifiers: [twist],
      keyframes: [
        {
          id: "k0",
          property: getMotionShapeModifierKeyframeProperty("tw-key", "angle"),
          time: 0,
          value: 0,
          easing: "linear",
        },
        {
          id: "k1",
          property: getMotionShapeModifierKeyframeProperty("tw-key", "angle"),
          time: 1,
          value: 90,
          easing: "linear",
        },
      ],
    };
    const evaluated = evaluateMotionShapeModifiersAtTime(layer, 0.5);
    const resolved = evaluated.modifiers?.[0];
    expect(resolved?.type).toBe("twist");
    if (resolved?.type === "twist") {
      expect(resolved.angle).toBeCloseTo(45, 5);
    }
  });

  it("applies offset then pucker then twist at layer level after wiggle", () => {
    const offset = createMotionShapeModifier("offset-paths", "o1");
    const pucker = createMotionShapeModifier("pucker-bloat", "p1");
    if (offset.type !== "offset-paths" || pucker.type !== "pucker-bloat") {
      throw new Error("bad preset");
    }
    const layer: MotionShapeLayer = {
      ...makeShapeLayer(),
      width: 100,
      height: 100,
      modifiers: [
        { ...offset, amount: 20 } satisfies MotionShapeModifier,
        { ...pucker, amount: 50 } satisfies MotionShapeModifier,
      ],
    };
    const points = buildMotionShapePolyline(layer, 96, 0);
    const plain = buildMotionShapePolyline(makeShapeLayer(), 96, 0);
    expect(maxRadius(points)).toBeGreaterThan(maxRadius(plain));
  });
});
