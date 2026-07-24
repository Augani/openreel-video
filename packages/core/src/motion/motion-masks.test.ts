import { describe, expect, it, vi } from "vitest";
import type { MotionLayer, MotionMask } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionLayerMask,
  applyMotionLayerMasksToCanvas,
  buildMotionCssClipPath,
  createMotionMask,
  evaluateMotionLayerMasksAtTime,
  getMotionLayerVisualBounds,
  getMotionMaskPathPoints,
  isAdvancedMotionMask,
  layerMayUseAdvancedMotionMasks,
  layerUsesAdvancedMotionMasks,
  paintMotionLayerMaskAlphaToCanvas,
  reorderMotionLayerMask,
  toggleMotionLayerMask,
  updateMotionLayerMask,
} from "./motion-masks";
import type { MotionShapePathPoint } from "./motion-shape-path";
import { getMotionMaskKeyframeProperty } from "./motion-keyframes";

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

const makeTextLayer = (): MotionLayer => ({
  id: "text-1",
  type: "text",
  name: "Headline",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  text: "Launch",
  style: {
    fontFamily: "Inter",
    fontSize: 40,
    color: "#ffffff",
    lineHeight: 1.1,
  },
});

describe("motion masks", () => {
  it("creates mask presets and adds them to a layer immutably", () => {
    const layer = makeShapeLayer();
    const mask = createMotionMask("rectangle", "mask-1");
    const updated = addMotionLayerMask(layer, mask);

    expect(layer.masks).toBeUndefined();
    expect(updated.masks).toEqual([
      {
        id: "mask-1",
        name: "Rectangle Mask",
        enabled: true,
        shape: "rectangle",
        mode: "add",
        inverted: false,
        x: 0.15,
        y: 0.15,
        width: 0.7,
        height: 0.7,
        rotation: 0,
        expansion: 0,
        feather: 0,
        opacity: 1,
      },
    ]);
  });

  it("updates, toggles, and reorders mask stack entries", () => {
    const layer = addMotionLayerMask(
      addMotionLayerMask(makeShapeLayer(), createMotionMask("rectangle", "mask-1")),
      createMotionMask("ellipse", "mask-2"),
    );
    const updated = updateMotionLayerMask(layer, "mask-1", (mask) => ({
      ...mask,
      x: 0.25,
      width: 0.5,
    }));
    const disabled = toggleMotionLayerMask(updated, "mask-2", false);
    const reordered = reorderMotionLayerMask(disabled, "mask-2", -1);

    expect(reordered.masks?.map((mask) => mask.id)).toEqual([
      "mask-2",
      "mask-1",
    ]);
    expect(reordered.masks?.[0]?.enabled).toBe(false);
    expect(reordered.masks?.[1]).toMatchObject({ x: 0.25, width: 0.5 });
  });

  it("builds CSS clip paths for additive rectangle and ellipse masks", () => {
    const rectangle = addMotionLayerMask(
      makeShapeLayer(),
      createMotionMask("rectangle", "mask-1"),
    );
    const ellipse = addMotionLayerMask(
      makeShapeLayer(),
      createMotionMask("ellipse", "mask-2"),
    );

    expect(buildMotionCssClipPath(rectangle)).toBe("inset(15% 15% 15% 15%)");
    expect(buildMotionCssClipPath(ellipse)).toBe(
      "ellipse(35% 35% at 50% 50%)",
    );
  });

  it("applies pixel expansion to CSS mask preview bounds", () => {
    const expanded = addMotionLayerMask(
      makeShapeLayer(),
      {
        ...createMotionMask("rectangle", "mask-1"),
        expansion: 20,
      },
    );
    const contracted = addMotionLayerMask(
      makeShapeLayer(),
      {
        ...createMotionMask("rectangle", "mask-2"),
        expansion: -18,
      },
    );

    expect(buildMotionCssClipPath(expanded)).toBe("inset(3.89% 8.75% 3.89% 8.75%)");
    expect(buildMotionCssClipPath(contracted)).toBe("inset(25% 20.63% 25% 20.63%)");
  });

  it("routes feathered and translucent masks away from CSS clip previews", () => {
    const feathered = addMotionLayerMask(makeShapeLayer(), {
      ...createMotionMask("ellipse", "mask-1"),
      feather: 24,
    });
    const translucent = addMotionLayerMask(makeShapeLayer(), {
      ...createMotionMask("rectangle", "mask-2"),
      opacity: 0.5,
    });
    const sanitized = addMotionLayerMask(makeShapeLayer(), {
      ...createMotionMask("rectangle", "mask-3"),
      feather: -10,
      opacity: 2,
    });

    expect(buildMotionCssClipPath(feathered)).toBeUndefined();
    expect(buildMotionCssClipPath(translucent)).toBeUndefined();
    expect(layerUsesAdvancedMotionMasks(feathered)).toBe(true);
    expect(layerUsesAdvancedMotionMasks(translucent)).toBe(true);
    expect(sanitized.masks?.[0]).toMatchObject({ feather: 0, opacity: 1 });
    expect(layerUsesAdvancedMotionMasks(sanitized)).toBe(false);
  });

  it("evaluates mask property keyframes at layer-local time", () => {
    const layer = {
      ...addMotionLayerMask(makeShapeLayer(), createMotionMask("rectangle", "mask-1")),
      keyframes: [
        {
          id: "kf-1",
          property: getMotionMaskKeyframeProperty("mask-1", "x"),
          time: 0,
          value: 0.1,
          easing: "linear" as const,
        },
        {
          id: "kf-2",
          property: getMotionMaskKeyframeProperty("mask-1", "x"),
          time: 1,
          value: 0.3,
          easing: "linear" as const,
        },
        {
          id: "kf-3",
          property: getMotionMaskKeyframeProperty("mask-1", "opacity"),
          time: 0,
          value: 1,
          easing: "linear" as const,
        },
        {
          id: "kf-4",
          property: getMotionMaskKeyframeProperty("mask-1", "opacity"),
          time: 1,
          value: 0.4,
          easing: "linear" as const,
        },
      ],
    };

    const evaluated = evaluateMotionLayerMasksAtTime(layer, 0.5);

    expect(evaluated.masks?.[0]?.x).toBeCloseTo(0.2);
    expect(evaluated.masks?.[0]?.opacity).toBeCloseTo(0.7);
    expect(layerMayUseAdvancedMotionMasks(layer)).toBe(true);
  });

  it("estimates visual bounds for shapes and text layers", () => {
    expect(getMotionLayerVisualBounds(makeShapeLayer())).toEqual({
      x: -160,
      y: -90,
      width: 320,
      height: 180,
    });
    expect(getMotionLayerVisualBounds(makeTextLayer())).toEqual({
      x: -69.6,
      y: -22,
      width: 139.2,
      height: 44,
    });
  });

  it("builds a CSS polygon clip-path for polygon masks", () => {
    const layer = addMotionLayerMask(
      makeShapeLayer(),
      createMotionMask("polygon", "mask-poly"),
    );

    const clipPath = buildMotionCssClipPath(layer);
    expect(clipPath).toBeDefined();
    expect(clipPath?.startsWith("polygon(")).toBe(true);
    expect((clipPath ?? "").split(",").length).toBeGreaterThanOrEqual(3);
  });

  const makeCurvedTriangle = (): MotionShapePathPoint[] => [
    { x: 0, y: -80, outX: 40, outY: -80 },
    { x: 80, y: 60, inX: 60, inY: 20 },
    { x: -80, y: 60 },
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

  it("returns validated path points for path masks", () => {
    const layer = makeShapeLayer();
    const mask = makePathMask("mask-path", makeCurvedTriangle());
    expect(getMotionMaskPathPoints(mask, layer)).toEqual(makeCurvedTriangle());
  });

  it("treats a plain add path mask as advanced so the renderer preview matches export", () => {
    const mask = makePathMask("mask-path", makeCurvedTriangle());
    const layer = addMotionLayerMask(makeShapeLayer(), mask);

    expect(isAdvancedMotionMask(mask)).toBe(true);
    expect(layerUsesAdvancedMotionMasks(layer)).toBe(true);
    expect(buildMotionCssClipPath(layer)).toBeUndefined();
  });

  it("ignores path masks with fewer than three points", () => {
    const layer = makeShapeLayer();
    const twoPoints = makePathMask("mask-path", [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(getMotionMaskPathPoints(twoPoints, layer)).toBeUndefined();

    const nonFinite = makePathMask("mask-path", [
      { x: Number.NaN, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 20 },
    ]);
    expect(getMotionMaskPathPoints(nonFinite, layer)).toBeUndefined();

    const legacyShape = createMotionMask("rectangle", "mask-rect");
    expect(getMotionMaskPathPoints(legacyShape, layer)).toBeUndefined();
  });

  it("emits bezier curves when clipping a path mask", () => {
    const layer = addMotionLayerMask(
      makeShapeLayer(),
      makePathMask("mask-path", makeCurvedTriangle()),
    );

    const bezierCalls: number[][] = [];
    const path2d = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn((...args: number[]) => {
        bezierCalls.push(args);
      }),
      rect: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    };
    const path2dCtor = vi.fn(() => path2d);
    const originalPath2d = globalThis.Path2D;
    (globalThis as { Path2D: unknown }).Path2D = path2dCtor;

    const clipped: unknown[] = [];
    const ctx = {
      clip: vi.fn((...args: unknown[]) => {
        clipped.push(args);
      }),
    } as unknown as CanvasRenderingContext2D;

    try {
      applyMotionLayerMasksToCanvas(ctx, layer);
    } finally {
      (globalThis as { Path2D: unknown }).Path2D = originalPath2d;
    }

    expect(path2d.moveTo).toHaveBeenCalled();
    expect(path2d.bezierCurveTo).toHaveBeenCalled();
    expect(bezierCalls.length).toBeGreaterThanOrEqual(1);
    expect(ctx.clip).toHaveBeenCalled();
  });

  it("ignores degenerate path masks during clipping without emitting a region", () => {
    const layer = addMotionLayerMask(
      makeShapeLayer(),
      makePathMask("mask-path", [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    );

    const path2d = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    };
    const originalPath2d = globalThis.Path2D;
    (globalThis as { Path2D: unknown }).Path2D = vi.fn(() => path2d);

    const ctx = { clip: vi.fn() } as unknown as CanvasRenderingContext2D;

    try {
      applyMotionLayerMasksToCanvas(ctx, layer);
    } finally {
      (globalThis as { Path2D: unknown }).Path2D = originalPath2d;
    }

    expect(path2d.moveTo).not.toHaveBeenCalled();
    expect(path2d.bezierCurveTo).not.toHaveBeenCalled();
    expect(ctx.clip).not.toHaveBeenCalled();
  });

  it("renders unmasked in both clip and alpha paths when the only add mask is degenerate", () => {
    const layer = addMotionLayerMask(
      makeShapeLayer(),
      makePathMask("mask-path", [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    );
    const bounds = getMotionLayerVisualBounds(layer);

    const clipPath2d = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    };
    const alphaRects: number[][] = [];
    const alphaPath2d = {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      rect: vi.fn((...args: number[]) => {
        alphaRects.push(args);
      }),
      ellipse: vi.fn(),
      closePath: vi.fn(),
    };
    const originalPath2d = globalThis.Path2D;

    const clipCtx = { clip: vi.fn() } as unknown as CanvasRenderingContext2D;
    (globalThis as { Path2D: unknown }).Path2D = vi.fn(() => clipPath2d);
    try {
      applyMotionLayerMasksToCanvas(clipCtx, layer);
    } finally {
      (globalThis as { Path2D: unknown }).Path2D = originalPath2d;
    }

    const fills: unknown[] = [];
    const alphaCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fill: vi.fn((path: unknown) => {
        fills.push(path);
      }),
      globalCompositeOperation: "source-over",
      globalAlpha: 1,
      fillStyle: "#000000",
      canvas: { width: 320, height: 180 },
    } as unknown as OffscreenCanvasRenderingContext2D;
    (globalThis as { Path2D: unknown }).Path2D = vi.fn(() => alphaPath2d);
    try {
      paintMotionLayerMaskAlphaToCanvas(alphaCtx, layer);
    } finally {
      (globalThis as { Path2D: unknown }).Path2D = originalPath2d;
    }

    expect(clipCtx.clip).not.toHaveBeenCalled();
    expect(fills).toHaveLength(1);
    expect(alphaRects).toEqual([
      [bounds.x, bounds.y, bounds.width, bounds.height],
    ]);
  });
});
