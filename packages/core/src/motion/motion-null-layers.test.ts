import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { getMotionLayerVisualBounds } from "./motion-masks";
import { createMotionNullLayer } from "./motion-null-layers";
import {
  getMotionLayerDescendantIds,
  normalizeMotionLayerHierarchy,
  setMotionLayerParent,
} from "./motion-hierarchy";

const makeShape = (id: string, parentId?: string): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  parentId,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#14b8a6", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
});

const makeComposition = (layers: MotionLayer[] = []): MotionComposition => ({
  id: "motion-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers,
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("motion null layers", () => {
  it("creates a stage controller centered in the composition", () => {
    const composition = makeComposition();
    const layer = createMotionNullLayer(composition, {
      id: "null-1",
      guideSize: 64,
    });

    expect(layer).toMatchObject({
      id: "null-1",
      type: "null",
      name: "Null Controller",
      duration: 5,
      transform: {
        position: { x: 960, y: 540, z: 0 },
        anchor: { x: 0, y: 0 },
      },
      guideSize: 64,
    });
    expect(getMotionLayerVisualBounds(layer)).toEqual({
      x: -32,
      y: -32,
      width: 64,
      height: 64,
    });
  });

  it("parents layers under a null controller without group child bookkeeping", () => {
    const controller = createMotionNullLayer(makeComposition(), {
      id: "controller",
    });
    const composition = makeComposition([controller, makeShape("card")]);

    const parented = setMotionLayerParent(composition, "card", "controller");
    const normalized = normalizeMotionLayerHierarchy(parented);

    expect(normalized.layers.find((layer) => layer.id === "card")?.parentId).toBe(
      "controller",
    );
    expect(normalized.layers.find((layer) => layer.id === "controller")).toMatchObject(
      { type: "null" },
    );
    expect([...getMotionLayerDescendantIds(normalized, "controller")]).toEqual([
      "card",
    ]);
  });
});
