import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  alignMotionLayers,
  distributeMotionLayers,
  getMotionLayerLayoutBounds,
  getMotionLayerSelectionBounds,
  resizeMotionLayerByHandle,
  resizeMotionLayerSelectionByHandle,
  rotateMotionLayerByPointer,
  rotateMotionLayerSelectionByPointer,
} from "./motion-layout";

const makeLayer = (
  id: string,
  position: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number } = {
    width: 100,
    height: 80,
  },
): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position,
  },
  keyframes: [],
  shapeType: "rectangle",
  width: size.width,
  height: size.height,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeTextLayer = (): MotionLayer => ({
  id: "text",
  type: "text",
  name: "Headline",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 400, y: 300 },
    scale: { x: 2, y: 0.5 },
  },
  keyframes: [],
  text: "Launch",
  style: {
    fontFamily: "Inter",
    fontSize: 40,
    color: "#ffffff",
    lineHeight: 1.1,
  },
});

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1000,
  height: 600,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [
    makeLayer("a", { x: 100, y: 100 }),
    makeLayer("b", { x: 260, y: 220 }),
    makeLayer("c", { x: 520, y: 400 }),
  ],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion layout", () => {
  it("calculates scale-aware layer bounds", () => {
    expect(getMotionLayerLayoutBounds(makeTextLayer())).toEqual({
      layerId: "text",
      left: 260.8,
      centerX: 400,
      right: 539.2,
      top: 289,
      centerY: 300,
      bottom: 311,
      width: 278.4,
      height: 22,
    });
  });

  it("combines selection bounds across layers", () => {
    expect(
      getMotionLayerSelectionBounds(makeComposition().layers, ["a", "b"]),
    ).toMatchObject({
      left: 50,
      right: 310,
      top: 60,
      bottom: 260,
      centerX: 180,
      centerY: 160,
    });
  });

  it("aligns selected layers against the composition", () => {
    const aligned = alignMotionLayers(makeComposition(), ["a", "b"], "center-x", {
      relativeTo: "composition",
    });

    expect(
      aligned.layers
        .filter((layer) => layer.id === "a" || layer.id === "b")
        .map((layer) => layer.transform.position.x),
    ).toEqual([500, 500]);
    expect(aligned.layers.find((layer) => layer.id === "c")?.transform.position.x).toBe(
      520,
    );
  });

  it("aligns selected layers against selection edges", () => {
    const aligned = alignMotionLayers(makeComposition(), ["a", "b"], "left");

    expect(aligned.layers.find((layer) => layer.id === "a")?.transform.position.x).toBe(
      100,
    );
    expect(aligned.layers.find((layer) => layer.id === "b")?.transform.position.x).toBe(
      100,
    );
  });

  it("distributes selected layers by horizontal centers", () => {
    const distributed = distributeMotionLayers(
      makeComposition(),
      ["a", "b", "c"],
      "horizontal",
    );

    expect(distributed.layers.map((layer) => layer.transform.position.x)).toEqual([
      100,
      310,
      520,
    ]);
  });

  it("keeps locked layers in place unless explicitly included", () => {
    const composition = {
      ...makeComposition(),
      layers: makeComposition().layers.map((layer) =>
        layer.id === "b" ? ({ ...layer, locked: true } as MotionLayer) : layer,
      ),
    };

    const skipped = alignMotionLayers(composition, ["a", "b"], "top", {
      relativeTo: "composition",
    });
    const included = alignMotionLayers(composition, ["b"], "top", {
      relativeTo: "composition",
      includeLocked: true,
    });

    expect(skipped.layers.find((layer) => layer.id === "b")?.transform.position.y).toBe(
      220,
    );
    expect(included.layers.find((layer) => layer.id === "b")?.transform.position.y).toBe(
      40,
    );
  });

  it("resizes a layer from an edge handle", () => {
    const resized = resizeMotionLayerByHandle(
      makeLayer("a", { x: 100, y: 100 }),
      "e",
      { x: 50, y: 0 },
    );

    expect(resized.transform.position).toEqual({ x: 125, y: 100 });
    expect(resized.transform.scale).toEqual({ x: 1.5, y: 1 });
  });

  it("resizes from center when requested", () => {
    const resized = resizeMotionLayerByHandle(
      makeLayer("a", { x: 100, y: 100 }),
      "e",
      { x: 25, y: 0 },
      { resizeFromCenter: true },
    );

    expect(resized.transform.position).toEqual({ x: 100, y: 100 });
    expect(resized.transform.scale).toEqual({ x: 1.5, y: 1 });
  });

  it("preserves aspect ratio from a corner handle", () => {
    const resized = resizeMotionLayerByHandle(
      makeLayer("a", { x: 100, y: 100 }),
      "se",
      { x: 100, y: 0 },
      { preserveAspect: true },
    );

    expect(resized.transform.position).toEqual({ x: 150, y: 140 });
    expect(resized.transform.scale).toEqual({ x: 2, y: 2 });
  });

  it("preserves negative scale direction while resizing", () => {
    const layer = {
      ...makeLayer("a", { x: 100, y: 100 }),
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: 100, y: 100 },
        scale: { x: -1, y: 1 },
      },
    } as MotionLayer;
    const resized = resizeMotionLayerByHandle(layer, "e", { x: 50, y: 0 });

    expect(resized.transform.scale.x).toBe(-1.5);
    expect(resized.transform.scale.y).toBe(1);
  });

  it("rotates a layer from pointer angle delta", () => {
    const rotated = rotateMotionLayerByPointer(
      makeLayer("a", { x: 100, y: 100 }),
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
    );

    expect(rotated.transform.rotation).toBe(90);
  });

  it("snaps pointer rotation to degree increments", () => {
    const rotated = rotateMotionLayerByPointer(
      makeLayer("a", { x: 100, y: 100 }),
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { snapDegrees: 15 },
    );

    expect(rotated.transform.rotation).toBe(45);
  });

  it("resizes a multi-layer selection while preserving relative layout", () => {
    const layers = [
      makeLayer("a", { x: 100, y: 100 }),
      makeLayer("b", { x: 300, y: 100 }),
    ];
    const resized = resizeMotionLayerSelectionByHandle(layers, "e", {
      x: 300,
      y: 0,
    });

    expect(resized.map((layer) => layer.transform.position)).toEqual([
      { x: 150, y: 100 },
      { x: 550, y: 100 },
    ]);
    expect(resized.map((layer) => layer.transform.scale)).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it("rotates a multi-layer selection around its shared center", () => {
    const layers = [
      makeLayer("a", { x: 100, y: 100 }),
      makeLayer("b", { x: 300, y: 100 }),
    ];
    const rotated = rotateMotionLayerSelectionByPointer(
      layers,
      { x: 200, y: 100 },
      { x: 200, y: 0 },
      { x: 300, y: 100 },
    );

    expect(rotated.map((layer) => layer.transform.position)).toEqual([
      { x: 200, y: 0 },
      { x: 200, y: 200 },
    ]);
    expect(rotated.map((layer) => layer.transform.rotation)).toEqual([90, 90]);
  });

  it("keeps locked layers unchanged during selection transforms", () => {
    const unlocked = makeLayer("a", { x: 100, y: 100 });
    const locked = { ...makeLayer("b", { x: 300, y: 100 }), locked: true };
    const resized = resizeMotionLayerSelectionByHandle(
      [unlocked, locked],
      "e",
      { x: 50, y: 0 },
    );

    expect(resized[1]).toBe(locked);
    expect(resized[0]?.transform.scale.x).toBe(1.5);
  });
});
