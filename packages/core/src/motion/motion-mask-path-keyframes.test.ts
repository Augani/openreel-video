import { describe, expect, it, vi } from "vitest";
import type { MotionLayer, MotionMask } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  applyMotionLayerMasksToCanvas,
  evaluateMotionLayerMasksAtTime,
  getMotionMaskPathPoints,
  getMotionMaskPathPointsAtTime,
  removeMotionMaskPathKeyframe,
  upsertMotionMaskPathKeyframe,
} from "./motion-masks";
import {
  getMotionLayerPropertyValueAtTime,
  getMotionMaskPathKeyframeProperty,
  isMotionAnimatableProperty,
  parseMotionMaskPathKeyframeProperty,
} from "./motion-keyframes";
import {
  buildMotionPathData,
  type MotionShapePathPoint,
} from "./motion-shape-path";

const makeShapeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 320,
  height: 180,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeSquare = (): MotionShapePathPoint[] => [
  { x: -80, y: -80 },
  { x: 80, y: -80 },
  { x: 80, y: 80 },
  { x: -80, y: 80 },
];

const makePulled = (): MotionShapePathPoint[] => [
  { x: -80, y: -80, outX: -40, outY: -120 },
  { x: 80, y: -80, inX: 40, inY: -120 },
  { x: 80, y: 80 },
  { x: -80, y: 80 },
];

const makePathMask = (
  id: string,
  pathPoints: readonly MotionShapePathPoint[],
): MotionMask => ({
  id,
  name: "Path Mask",
  enabled: true,
  shape: "path",
  mode: "add",
  inverted: false,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  rotation: 0,
  expansion: 0,
  feather: 0,
  opacity: 1,
  pathPoints,
});

const withKeyframes = (
  square: readonly MotionShapePathPoint[],
  pulled: readonly MotionShapePathPoint[],
): MotionMask => {
  let layer = addMask(makeShapeLayer(), makePathMask("mask-path", square));
  layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 0, buildMotionPathData(square), "linear");
  layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 1, buildMotionPathData(pulled), "linear");
  return layer.masks![0];
};

describe("mask path keyframes", () => {
  it("recognizes mask path property as animatable", () => {
    expect(isMotionAnimatableProperty("mask.abc.path")).toBe(true);
    expect(parseMotionMaskPathKeyframeProperty("mask.abc.path")).toEqual({
      maskId: "abc",
    });
    expect(getMotionMaskPathKeyframeProperty("abc")).toBe("mask.abc.path");
  });

  it("evaluates a mask with a single keyframe statically", () => {
    let layer = addMask(makeShapeLayer(), makePathMask("mask-path", makeSquare()));
    layer = upsertMotionMaskPathKeyframe(
      layer,
      "mask-path",
      0,
      buildMotionPathData(makeSquare()),
    );
    const mask = layer.masks![0];
    const points = getMotionMaskPathPointsAtTime(mask, 5);
    expect(points).toBeDefined();
    expect(points!.length).toBe(4);
  });

  it("interpolates vertices and handles between keyframes", () => {
    const mask = withKeyframes(makeSquare(), makePulled());
    const withStatic: MotionMask = { ...mask, pathPoints: makeSquare() };
    const points = getMotionMaskPathPointsAtTime(withStatic, 0.5);
    expect(points).toBeDefined();
    expect(points!.length).toBe(4);
    expect(points![0].outX).toBeCloseTo(-60, 4);
    expect(points![0].outY).toBeCloseTo(-100, 4);
    expect(points![1].inX).toBeCloseTo(60, 4);
    expect(points![1].inY).toBeCloseTo(-100, 4);
  });

  it("applies keyframe easing to progress", () => {
    let layer = addMask(makeShapeLayer(), makePathMask("mask-path", makeSquare()));
    layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 0, buildMotionPathData([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]), "ease-out");
    layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 1, buildMotionPathData([
      { x: 0, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 300 },
    ]), "ease-out");
    const eased = getMotionMaskPathPointsAtTime(layer.masks![0], 0.5);
    expect(eased).toBeDefined();
    expect(eased![0].y).not.toBeCloseTo(100, 2);
  });

  it("replaces a keyframe at the same time instead of duplicating", () => {
    let layer = addMask(makeShapeLayer(), makePathMask("mask-path", makeSquare()));
    layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 0, buildMotionPathData(makeSquare()));
    layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 0, buildMotionPathData(makePulled()));
    expect(layer.masks![0].pathKeyframes).toHaveLength(1);
  });

  it("removes a keyframe by id", () => {
    let layer = addMask(makeShapeLayer(), makePathMask("mask-path", makeSquare()));
    layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 0, buildMotionPathData(makeSquare()));
    layer = upsertMotionMaskPathKeyframe(layer, "mask-path", 1, buildMotionPathData(makePulled()));
    const keyframeId = layer.masks![0].pathKeyframes![0].id;
    layer = removeMotionMaskPathKeyframe(layer, "mask-path", keyframeId);
    expect(layer.masks![0].pathKeyframes).toHaveLength(1);
    expect(layer.masks![0].pathKeyframes![0].id).not.toBe(keyframeId);
  });

  it("threads localTime through getMotionMaskPathPoints", () => {
    const mask: MotionMask = {
      ...withKeyframes(makeSquare(), makePulled()),
      pathPoints: makeSquare(),
    };
    const layer = makeShapeLayer();
    const atStart = getMotionMaskPathPoints(mask, layer, 0);
    const atEnd = getMotionMaskPathPoints(mask, layer, 1);
    expect(atStart).toBeDefined();
    expect(atEnd).toBeDefined();
    expect(atStart![0].outX).toBeUndefined();
    expect(atEnd![0].outX).toBeCloseTo(-40, 4);
  });

  it("guards numeric evaluation of the mask path property to 0", () => {
    const layer = addMask(makeShapeLayer(), makePathMask("mask-path", makeSquare()));
    expect(
      getMotionLayerPropertyValueAtTime(layer, "mask.mask-path.path", 0.5),
    ).toBe(0);
  });

  it("bakes rotoscoped mask path keyframes into pathPoints at the render localTime", () => {
    const mask = withKeyframes(makeSquare(), makePulled());
    const layer = addMask(makeShapeLayer(), { ...mask, pathPoints: makeSquare() });

    const atStart = evaluateMotionLayerMasksAtTime(layer, 0);
    const atEnd = evaluateMotionLayerMasksAtTime(layer, 1);

    expect(atStart.masks![0].pathPoints![0].outX).toBeUndefined();
    expect(atEnd.masks![0].pathPoints![0].outX).toBeCloseTo(-40, 4);
  });

  it("clips using the localTime-evaluated rotoscoped path, not the static path", () => {
    const mask = withKeyframes(makeSquare(), makePulled());
    const layer = addMask(makeShapeLayer(), { ...mask, pathPoints: makeSquare() });
    const evaluated = evaluateMotionLayerMasksAtTime(layer, 1);

    const beziers: number[][] = [];
    const path2d = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn((...args: number[]) => {
        beziers.push(args);
      }),
      rect: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    };
    const originalPath2d = globalThis.Path2D;
    (globalThis as { Path2D: unknown }).Path2D = vi.fn(() => path2d);
    const ctx = { clip: vi.fn() } as unknown as CanvasRenderingContext2D;
    try {
      applyMotionLayerMasksToCanvas(ctx, evaluated);
    } finally {
      (globalThis as { Path2D: unknown }).Path2D = originalPath2d;
    }

    expect(ctx.clip).toHaveBeenCalled();
    expect(beziers.length).toBeGreaterThanOrEqual(1);
    const usesPulledHandle = beziers.some((args) =>
      args.some((value) => Math.abs(value - -40) < 1e-6),
    );
    expect(usesPulledHandle).toBe(true);
  });
});

function addMask(layer: MotionLayer, mask: MotionMask): MotionLayer {
  return { ...layer, masks: [...(layer.masks ?? []), mask] };
}
