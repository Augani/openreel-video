import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionScene3DLayer } from "@openreel/core";
import { createMotionLayerOfType } from "./motion-layer-factory";

const composition = {
  id: "comp-1",
  name: "Comp",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#000000",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
} as unknown as MotionComposition;

describe("createMotionLayerOfType shape", () => {
  it("uses drag bounds + shape type for ellipse", () => {
    const layer = createMotionLayerOfType(composition, "shape", {
      position: { x: 300, y: 400 },
      width: 120,
      height: 80,
      shapeType: "ellipse",
    });
    expect(layer.type).toBe("shape");
    if (layer.type !== "shape") throw new Error("expected shape layer");
    expect(layer.shapeType).toBe("ellipse");
    expect(layer.width).toBe(120);
    expect(layer.height).toBe(80);
    expect(layer.transform.position).toEqual({ x: 300, y: 400 });
    expect(layer.style.cornerRadius).toBe(0);
  });

  it("defaults to a rounded rectangle when no shape options given", () => {
    const layer = createMotionLayerOfType(composition, "shape");
    if (layer.type !== "shape") throw new Error("expected shape layer");
    expect(layer.shapeType).toBe("rectangle");
    expect(layer.width).toBe(420);
    expect(layer.style.cornerRadius).toBe(20);
  });
});

describe("createMotionLayerOfType scene3d", () => {
  it("creates a scene-mode 3D layer with one object and a camera", () => {
    const layer = createMotionLayerOfType(
      composition,
      "scene3d",
    ) as MotionScene3DLayer;
    expect(layer.type).toBe("scene3d");
    expect(layer.objects).toBeDefined();
    expect(layer.objects?.length).toBe(1);
    expect(layer.objects?.[0].object.kind).toBe("rounded-box");
    expect(layer.camera).toBeDefined();
    expect(layer.lighting?.environment).toBe("studio");
  });
});
