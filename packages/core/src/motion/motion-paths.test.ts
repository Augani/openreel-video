import { describe, expect, it } from "vitest";
import type { MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  getMotionLayerPositionPath,
  setMotionLayerPositionPathPoint,
} from "./motion-paths";

const makeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Shape",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { x: 100, y: 120 },
  },
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

describe("motion paths", () => {
  it("pairs position x/y keyframes into stage points", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      keyframes: [
        {
          id: "x-0",
          property: "transform.position.x",
          time: 0,
          value: 100,
          easing: "linear",
        },
        {
          id: "y-0",
          property: "transform.position.y",
          time: 0,
          value: 120,
          easing: "linear",
        },
        {
          id: "x-1",
          property: "transform.position.x",
          time: 1,
          value: 260,
          easing: "ease",
        },
        {
          id: "y-1",
          property: "transform.position.y",
          time: 1,
          value: 300,
          easing: "ease",
        },
      ],
    } as MotionLayer;

    expect(getMotionLayerPositionPath(layer)).toEqual([
      {
        time: 0,
        x: 100,
        y: 120,
        xKeyframeId: "x-0",
        yKeyframeId: "y-0",
        easing: "linear",
      },
      {
        time: 1,
        x: 260,
        y: 300,
        xKeyframeId: "x-1",
        yKeyframeId: "y-1",
        easing: "ease",
      },
    ]);
  });

  it("evaluates missing axes for partial position keyframes", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      keyframes: [
        {
          id: "x-1",
          property: "transform.position.x",
          time: 1,
          value: 260,
          easing: "ease",
        },
      ],
    } as MotionLayer;

    expect(getMotionLayerPositionPath(layer)).toEqual([
      {
        time: 1,
        x: 260,
        y: 120,
        xKeyframeId: "x-1",
        yKeyframeId: undefined,
        easing: "ease",
      },
    ]);
  });

  it("updates both position keyframes at a path point", () => {
    const updated = setMotionLayerPositionPathPoint(
      makeLayer(),
      1.23456,
      { x: 240.12349, y: 320.98769 },
      "ease-in-out",
    );

    expect(updated.keyframes).toEqual([
      expect.objectContaining({
        property: "transform.position.x",
        time: 1.2346,
        value: 240.1235,
        easing: "ease-in-out",
      }),
      expect.objectContaining({
        property: "transform.position.y",
        time: 1.2346,
        value: 320.9877,
        easing: "ease-in-out",
      }),
    ]);
  });
});
