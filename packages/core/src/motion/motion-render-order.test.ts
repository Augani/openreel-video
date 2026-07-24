import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  getMotionLayerRenderDepth,
  orderMotionLayersForRender,
} from "./motion-render-order";

const makeLayer = (
  id: string,
  z: number,
  updates: Partial<MotionLayer> = {},
): MotionLayer =>
  ({
    id,
    type: "shape",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: 960, y: 540, z },
    },
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: {
      fill: { type: "solid", color: "#ffffff", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
    ...updates,
  }) as MotionLayer;

const makeAdjustmentLayer = (id: string): MotionLayer => ({
  id,
  type: "adjustment",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  width: 1920,
  height: 1080,
});

const makeComposition = (layers: readonly MotionLayer[]): MotionComposition => ({
  id: "scene",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [...layers],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("motion render order", () => {
  it("sorts 3D layers from farthest to nearest while preserving stable ties", () => {
    const near = makeLayer("near", 300);
    const far = makeLayer("far", -200);
    const flatA = makeLayer("flat-a", 0);
    const flatB = makeLayer("flat-b", 0);
    const composition = makeComposition([near, flatA, flatB, far]);

    expect(
      orderMotionLayersForRender(composition, composition.layers, 0).map(
        (layer) => layer.id,
      ),
    ).toEqual(["far", "flat-a", "flat-b", "near"]);
    expect(getMotionLayerRenderDepth(composition, near, 0)).toBe(300);
  });

  it("uses animated Z position at the current composition time", () => {
    const animated = makeLayer("animated", 0, {
      keyframes: [
        {
          id: "z-start",
          property: "transform.position.z",
          time: 0,
          value: 0,
          easing: "linear",
        },
        {
          id: "z-end",
          property: "transform.position.z",
          time: 2,
          value: 300,
          easing: "linear",
        },
      ],
    });
    const staticLayer = makeLayer("static", 100);
    const composition = makeComposition([animated, staticLayer]);

    expect(
      orderMotionLayersForRender(composition, composition.layers, 0).map(
        (layer) => layer.id,
      ),
    ).toEqual(["animated", "static"]);
    expect(
      orderMotionLayersForRender(composition, composition.layers, 2).map(
        (layer) => layer.id,
      ),
    ).toEqual(["static", "animated"]);
  });

  it("does not reorder 3D layers across adjustment-layer barriers", () => {
    const near = makeLayer("near", 300);
    const adjustment = makeAdjustmentLayer("adjust");
    const far = makeLayer("far", -200);
    const composition = makeComposition([near, adjustment, far]);

    expect(
      orderMotionLayersForRender(composition, composition.layers, 0).map(
        (layer) => layer.id,
      ),
    ).toEqual(["near", "adjust", "far"]);
  });
});
