import { describe, expect, it } from "vitest";
import type {
  MotionMask,
  MotionShapeItem,
  MotionShapeLayer,
} from "@openreel/core";
import {
  DEFAULT_MOTION_TRANSFORM,
  getMotionMaskKeyframeProperty,
  getMotionMaskPathKeyframeProperty,
} from "@openreel/core";
import { getGraphEditorAvailableProperties } from "./GraphEditorPanel";

const pathMask = (id: string): MotionMask => ({
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
  pathPoints: [
    { x: 0, y: -80 },
    { x: 80, y: 60 },
    { x: -80, y: 60 },
  ],
  pathKeyframes: [
    {
      id: "kf-1",
      time: 0,
      property: getMotionMaskPathKeyframeProperty("mask-path"),
      value: "M 0 -80 L 80 60 L -80 60 Z",
      easing: "linear",
    },
    {
      id: "kf-2",
      time: 1,
      property: getMotionMaskPathKeyframeProperty("mask-path"),
      value: "M 0 -60 L 60 40 L -60 40 Z",
      easing: "linear",
    },
  ],
});

const shapeLayerWithPathMask = (): MotionShapeLayer => ({
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
  masks: [pathMask("mask-path")],
});

describe("getGraphEditorAvailableProperties", () => {
  it("omits the non-numeric mask path property", () => {
    const layer = shapeLayerWithPathMask();
    const properties = getGraphEditorAvailableProperties(layer).map(
      (descriptor) => descriptor.property,
    );

    expect(properties).not.toContain(
      getMotionMaskPathKeyframeProperty("mask-path"),
    );
  });

  it("still exposes the numeric mask properties", () => {
    const layer = shapeLayerWithPathMask();
    const properties = getGraphEditorAvailableProperties(layer).map(
      (descriptor) => descriptor.property,
    );

    expect(properties).toContain(getMotionMaskKeyframeProperty("mask-path", "x"));
    expect(properties).toContain(
      getMotionMaskKeyframeProperty("mask-path", "opacity"),
    );
  });

  it("exposes group-transform and operator contents descriptors", () => {
    const contents: readonly MotionShapeItem[] = [
      {
        kind: "group",
        id: "grp-1",
        name: "Group 1",
        transform: {
          anchor: { x: 0, y: 0 },
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          opacity: 1,
        },
        items: [],
        operators: [
          {
            id: "op-1",
            type: "twist",
            name: "Twist",
            enabled: true,
            angle: 0,
            center: { x: 0, y: 0 },
          },
        ],
      },
    ];
    const base = shapeLayerWithPathMask();
    const layer: MotionShapeLayer = { ...base, contents };
    const properties = getGraphEditorAvailableProperties(layer).map(
      (descriptor) => descriptor.property,
    );

    expect(properties).toContain("contents.grp-1.transform.rotation");
    expect(properties).toContain("contents.grp-1.transform.positionX");
    expect(properties).toContain("contents.grp-1.operator.op-1.angle");
  });
});
