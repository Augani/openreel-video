import { describe, expect, it, vi } from "vitest";
import { MotionRenderer } from "./motion-renderer";
import * as shapeBoolean from "./motion-shape-boolean";
import { MotionShapeBooleanError } from "./motion-shape-boolean";
import {
  collectShapeItemRings,
  SHAPE_IDENTITY_MATRIX,
  shapeGroupTransformToMatrix,
} from "./motion-shape-contents";
import type {
  MotionComposition,
  MotionShapeGroupItem,
  MotionShapeItem,
  MotionShapeLayer,
  MotionShapePathItem,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type { ShapeStyle } from "../graphics/types";

interface CtxCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

interface CtxRecorder {
  readonly calls: CtxCall[];
  readonly alphaAtFill: number[];
  readonly fillStyleAtFill: unknown[];
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
}

function createCtxRecorder(): {
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly recorder: CtxRecorder;
} {
  const recorder: CtxRecorder = {
    calls: [],
    alphaAtFill: [],
    fillStyleAtFill: [],
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
  };

  const saveStack: number[] = [];

  const record =
    (method: string) =>
    (...args: unknown[]): void => {
      recorder.calls.push({ method, args });
      if (method === "fill") {
        recorder.alphaAtFill.push(recorder.globalAlpha);
        recorder.fillStyleAtFill.push(recorder.fillStyle);
      }
      if (method === "save") {
        saveStack.push(recorder.globalAlpha);
      }
      if (method === "restore") {
        const restored = saveStack.pop();
        if (restored !== undefined) {
          recorder.globalAlpha = restored;
        }
      }
    };

  const target: Record<string, unknown> = {
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    rect: record("rect"),
    roundRect: record("roundRect"),
    ellipse: record("ellipse"),
    bezierCurveTo: record("bezierCurveTo"),
    fill: record("fill"),
    stroke: record("stroke"),
    clip: record("clip"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    rotate: record("rotate"),
    scale: record("scale"),
    transform: record("transform"),
    setTransform: record("setTransform"),
    setLineDash: record("setLineDash"),
    createLinearGradient: () => ({ addColorStop: (): void => {} }),
    createRadialGradient: () => ({ addColorStop: (): void => {} }),
    createConicGradient: () => ({ addColorStop: (): void => {} }),
    createPattern: () => null,
  };

  const proxy = new Proxy(target, {
    get(obj, prop: string): unknown {
      if (prop === "globalAlpha") return recorder.globalAlpha;
      if (prop === "fillStyle") return recorder.fillStyle;
      if (prop === "strokeStyle") return recorder.strokeStyle;
      if (prop in obj) return obj[prop];
      return (): void => {};
    },
    set(_obj, prop: string, value: unknown): boolean {
      if (prop === "globalAlpha" && typeof value === "number") {
        recorder.globalAlpha = value;
      } else if (prop === "fillStyle") {
        recorder.fillStyle = value;
      } else if (prop === "strokeStyle") {
        recorder.strokeStyle = value;
      }
      return true;
    },
  });

  return {
    ctx: proxy as unknown as OffscreenCanvasRenderingContext2D,
    recorder,
  };
}

const SOLID_STYLE: ShapeStyle = {
  fill: { type: "solid", color: "#ff0000", opacity: 1 },
  stroke: { color: "#0000ff", width: 4, opacity: 1 },
};

function makeLayer(overrides: Partial<MotionShapeLayer> = {}): MotionShapeLayer {
  return {
    id: "layer-1",
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: SOLID_STYLE,
    ...overrides,
  };
}

const COMPOSITION: MotionComposition = {
  id: "comp",
  name: "Comp",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 4,
  backgroundColor: "#000000",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
};

function pathItem(
  overrides: Partial<MotionShapePathItem> = {},
): MotionShapePathItem {
  return {
    kind: "path",
    id: overrides.id ?? "path-1",
    name: overrides.name ?? "Rect",
    shapeType: overrides.shapeType ?? "rectangle",
    width: overrides.width ?? 40,
    height: overrides.height ?? 40,
    position: overrides.position ?? { x: 0, y: 0 },
    pathData: overrides.pathData,
    pathClosed: overrides.pathClosed,
    style: overrides.style,
    visible: overrides.visible,
  };
}

function groupItem(
  items: readonly MotionShapeItem[],
  overrides: Partial<MotionShapeGroupItem> = {},
): MotionShapeGroupItem {
  return {
    kind: "group",
    id: overrides.id ?? "group-1",
    name: overrides.name ?? "Group",
    transform: overrides.transform ?? {
      anchor: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
    },
    items,
    operators: overrides.operators,
    mergeMode: overrides.mergeMode,
    style: overrides.style,
    visible: overrides.visible,
  };
}

function renderContents(
  layer: MotionShapeLayer,
): { readonly recorder: CtxRecorder } {
  const renderer = new MotionRenderer();
  const { ctx, recorder } = createCtxRecorder();
  (
    renderer as unknown as {
      renderShape(
        ctx: OffscreenCanvasRenderingContext2D,
        layer: MotionShapeLayer,
        localTime: number,
        composition?: MotionComposition,
      ): void;
    }
  ).renderShape(ctx, layer, 0, COMPOSITION);
  return { recorder };
}

function countMethod(recorder: CtxRecorder, method: string): number {
  return recorder.calls.filter((call) => call.method === method).length;
}

describe("collectShapeItemRings", () => {
  it("bakes a path item's position offset into ring points", () => {
    const item = pathItem({ position: { x: 50, y: 20 }, width: 10, height: 10 });
    const entries = collectShapeItemRings(
      item,
      makeLayer(),
      SHAPE_IDENTITY_MATRIX,
      1,
      SOLID_STYLE,
    );
    expect(entries).toHaveLength(1);
    const ring = entries[0].rings[0];
    const minX = Math.min(...ring.map((p) => p.x));
    const maxX = Math.max(...ring.map((p) => p.x));
    expect(minX).toBeCloseTo(45, 5);
    expect(maxX).toBeCloseTo(55, 5);
    const minY = Math.min(...ring.map((p) => p.y));
    expect(minY).toBeCloseTo(15, 5);
  });

  it("composes nested group transforms into baked points", () => {
    const inner = pathItem({ width: 10, height: 10 });
    const group = groupItem([inner], {
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 100, y: 0 },
        scale: { x: 2, y: 2 },
        rotation: 0,
        opacity: 0.5,
      },
    });
    const entries = collectShapeItemRings(
      group,
      makeLayer(),
      SHAPE_IDENTITY_MATRIX,
      1,
      SOLID_STYLE,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].opacity).toBeCloseTo(0.5, 5);
    const ring = entries[0].rings[0];
    const maxX = Math.max(...ring.map((p) => p.x));
    const minX = Math.min(...ring.map((p) => p.x));
    expect(maxX).toBeCloseTo(110, 5);
    expect(minX).toBeCloseTo(90, 5);
  });

  it("skips visible:false items", () => {
    const item = pathItem({ visible: false });
    const entries = collectShapeItemRings(
      item,
      makeLayer(),
      SHAPE_IDENTITY_MATRIX,
      1,
      SOLID_STYLE,
    );
    expect(entries).toHaveLength(0);
  });

  it("inherits the group style when the child has none", () => {
    const inner = pathItem({});
    const overrideStyle: ShapeStyle = {
      fill: { type: "solid", color: "#00ff00", opacity: 1 },
      stroke: { color: "#000000", width: 1, opacity: 1 },
    };
    const group = groupItem([inner], { style: overrideStyle });
    const entries = collectShapeItemRings(
      group,
      makeLayer(),
      SHAPE_IDENTITY_MATRIX,
      1,
      SOLID_STYLE,
    );
    expect(entries[0].style).toBe(overrideStyle);
  });

  it("marks open path items as not closed", () => {
    const item = pathItem({ pathClosed: false });
    const entries = collectShapeItemRings(
      item,
      makeLayer(),
      SHAPE_IDENTITY_MATRIX,
      1,
      SOLID_STYLE,
    );
    expect(entries[0].closed).toBe(false);
  });

  it("reproduces source-layer world placement via the merge wrapper group", () => {
    const compCenter = { x: 960, y: 540 };
    const sourceTransform = {
      position: { x: 400, y: 260 },
      rotation: 45,
      scale: { x: 2, y: 1.5 },
      anchor: { x: 0, y: 0 },
      opacity: 1,
    };

    const localRing = collectShapeItemRings(
      pathItem({ width: 40, height: 40 }),
      makeLayer(),
      SHAPE_IDENTITY_MATRIX,
      1,
      SOLID_STYLE,
    )[0].rings[0];

    const rad = (sourceTransform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const sourceWorld = localRing.map((point) => {
      const ax = point.x - sourceTransform.anchor.x;
      const ay = point.y - sourceTransform.anchor.y;
      const sx = ax * sourceTransform.scale.x;
      const sy = ay * sourceTransform.scale.y;
      return {
        x: cos * sx - sin * sy + sourceTransform.position.x,
        y: sin * sx + cos * sy + sourceTransform.position.y,
      };
    });

    const wrapper = groupItem([pathItem({ width: 40, height: 40 })], {
      transform: {
        anchor: sourceTransform.anchor,
        position: {
          x: sourceTransform.position.x - compCenter.x,
          y: sourceTransform.position.y - compCenter.y,
        },
        scale: sourceTransform.scale,
        rotation: sourceTransform.rotation,
        opacity: sourceTransform.opacity,
      },
    });

    const mergedLayerMatrix = shapeGroupTransformToMatrix({
      anchor: { x: 0, y: 0 },
      position: compCenter,
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
    });

    const wrapperRing = collectShapeItemRings(
      wrapper,
      makeLayer(),
      mergedLayerMatrix,
      1,
      SOLID_STYLE,
    )[0].rings[0];

    expect(wrapperRing).toHaveLength(sourceWorld.length);
    for (let i = 0; i < wrapperRing.length; i += 1) {
      expect(wrapperRing[i].x).toBeCloseTo(sourceWorld[i].x, 4);
      expect(wrapperRing[i].y).toBeCloseTo(sourceWorld[i].y, 4);
    }
  });
});

describe("shapeGroupTransformToMatrix", () => {
  it("returns identity for a default transform", () => {
    const matrix = shapeGroupTransformToMatrix({
      anchor: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
    });
    expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe("MotionRenderer shape contents rendering", () => {
  it("renders a legacy layer with exactly one fill and one stroke", () => {
    const { recorder } = renderContents(makeLayer());
    expect(countMethod(recorder, "fill")).toBe(1);
    expect(countMethod(recorder, "stroke")).toBe(1);
    expect(countMethod(recorder, "transform")).toBe(0);
  });

  it("renders a plain group with two path items as two fills", () => {
    const group = groupItem([
      pathItem({ id: "p1", position: { x: -30, y: 0 } }),
      pathItem({ id: "p2", position: { x: 30, y: 0 } }),
    ]);
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(countMethod(recorder, "fill")).toBe(2);
    expect(countMethod(recorder, "stroke")).toBe(2);
  });

  it("merges a union group into a single evenodd fill", () => {
    const group = groupItem(
      [
        pathItem({ id: "p1", width: 40, height: 40, position: { x: -10, y: 0 } }),
        pathItem({ id: "p2", width: 40, height: 40, position: { x: 10, y: 0 } }),
      ],
      { mergeMode: "union" },
    );
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(countMethod(recorder, "fill")).toBe(1);
    const fillCall = recorder.calls.find((call) => call.method === "fill");
    expect(fillCall?.args[0]).toBe("evenodd");
  });

  it("fills a merged gradient group with a non-plain-white fill style", () => {
    const gradientStyle: ShapeStyle = {
      fill: {
        type: "gradient",
        opacity: 1,
        gradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#123456" },
            { offset: 1, color: "#abcdef" },
          ],
        },
      },
      stroke: { color: "#0000ff", width: 0, opacity: 0 },
    };
    const group = groupItem(
      [
        pathItem({ id: "p1", width: 40, height: 40, position: { x: -10, y: 0 } }),
        pathItem({ id: "p2", width: 40, height: 40, position: { x: 10, y: 0 } }),
      ],
      { mergeMode: "union", style: gradientStyle },
    );
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(recorder.fillStyleAtFill.length).toBeGreaterThan(0);
    const applied = recorder.fillStyleAtFill[0];
    expect(applied).not.toBe("#ffffff");
    expect(typeof applied).toBe("object");
    expect(applied).not.toBeNull();
  });

  it("falls back to the first gradient stop color for a merged shader fill", () => {
    const shaderStyle: ShapeStyle = {
      fill: {
        type: "shader",
        opacity: 1,
        shader: { shaderId: "nonexistent-shader", params: {} },
        gradient: {
          type: "linear",
          stops: [
            { offset: 0, color: "#00ff00" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      },
      stroke: { color: "#0000ff", width: 0, opacity: 0 },
    };
    const group = groupItem(
      [
        pathItem({ id: "p1", width: 40, height: 40, position: { x: -10, y: 0 } }),
        pathItem({ id: "p2", width: 40, height: 40, position: { x: 10, y: 0 } }),
      ],
      { mergeMode: "union", style: shaderStyle },
    );
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(recorder.fillStyleAtFill.length).toBeGreaterThan(0);
    expect(recorder.fillStyleAtFill[0]).not.toBe("#ffffff");
  });

  it("halves globalAlpha at leaf fill for a group opacity of 0.5", () => {
    const group = groupItem([pathItem({ id: "p1" })], {
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 0.5,
      },
    });
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(recorder.alphaAtFill.length).toBeGreaterThan(0);
    expect(recorder.alphaAtFill[0]).toBeCloseTo(0.5, 5);
  });

  it("skips a visible:false item inside a plain group", () => {
    const group = groupItem([
      pathItem({ id: "p1" }),
      pathItem({ id: "p2", visible: false }),
    ]);
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(countMethod(recorder, "fill")).toBe(1);
  });

  it("composes nested group transforms via ctx.transform calls", () => {
    const inner = groupItem([pathItem({ id: "p1" })], {
      id: "inner",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 20, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
    });
    const outer = groupItem([inner], {
      id: "outer",
      transform: {
        anchor: { x: 0, y: 0 },
        position: { x: 40, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 1,
      },
    });
    const { recorder } = renderContents(makeLayer({ contents: [outer] }));
    expect(countMethod(recorder, "transform")).toBe(2);
    expect(countMethod(recorder, "fill")).toBe(1);
  });

  it("falls back to unmerged children when merge throws", () => {
    const spy = vi
      .spyOn(shapeBoolean, "mergeMotionShapeRings")
      .mockImplementation(() => {
        throw new MotionShapeBooleanError("union", new Error("forced"));
      });
    try {
      const group = groupItem(
        [pathItem({ id: "a" }), pathItem({ id: "b" })],
        { mergeMode: "union" },
      );
      const { recorder } = renderContents(makeLayer({ contents: [group] }));
      expect(countMethod(recorder, "fill")).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("excludes open paths from merge but still strokes them", () => {
    const openLine = pathItem({
      id: "line",
      shapeType: "path",
      pathClosed: false,
      pathData: "M -20 0 L 20 0",
    });
    const closed = pathItem({ id: "sq", width: 30, height: 30 });
    const group = groupItem([closed, openLine], { mergeMode: "union" });
    const { recorder } = renderContents(makeLayer({ contents: [group] }));
    expect(countMethod(recorder, "fill")).toBe(1);
    expect(countMethod(recorder, "stroke")).toBeGreaterThanOrEqual(1);
  });
});
