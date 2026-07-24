import { describe, expect, it } from "vitest";
import {
  createDefaultMotionGradientFill,
  evaluateMotionShapeLayerStyleAtTime,
  getMotionLinearGradientLine,
  getMotionRadialGradientSpec,
  hasAdvancedMotionShapeStyle,
  normalizeMotionGradientStops,
  normalizeMotionStroke,
} from "./motion-shape-style";
import type { ShapeStyle } from "../graphics/types";
import type { MotionShapeLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

const makeShapeLayer = (): MotionShapeLayer => ({
  id: "shape-1",
  type: "shape",
  name: "Shape",
  startTime: 0,
  duration: 4,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  shapeType: "rectangle",
  width: 100,
  height: 60,
  keyframes: [
    {
      id: "stroke-start",
      time: 0,
      property: "shape.stroke.width",
      value: 4,
      easing: "linear",
    },
    {
      id: "stroke-end",
      time: 2,
      property: "shape.stroke.width",
      value: 12,
      easing: "linear",
    },
    {
      id: "gradient-start",
      time: 0,
      property: "shape.gradient.angle",
      value: 0,
      easing: "linear",
    },
    {
      id: "gradient-end",
      time: 2,
      property: "shape.gradient.angle",
      value: 90,
      easing: "linear",
    },
  ],
  style: {
    fill: createDefaultMotionGradientFill("#14b8a6", "#ffffff"),
    stroke: { color: "#ffffff", width: 4, opacity: 1 },
    cornerRadius: 0,
  },
});

describe("motion shape style", () => {
  it("normalizes gradient stops into a deterministic ordered range", () => {
    expect(
      normalizeMotionGradientStops([
        { offset: 1.4, color: "#ffffff" },
        { offset: -0.2, color: "#000000" },
      ]),
    ).toEqual([
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#ffffff" },
    ]);

    expect(normalizeMotionGradientStops([{ offset: 0.25, color: "#14b8a6" }]))
      .toEqual([
        { offset: 0, color: "#14b8a6" },
        { offset: 1, color: "#14b8a6" },
      ]);
  });

  it("builds gradient geometry from centered layer bounds", () => {
    expect(getMotionLinearGradientLine(100, 100, 0)).toEqual({
      x0: -70.711,
      y0: 0,
      x1: 70.711,
      y1: 0,
    });
    expect(getMotionRadialGradientSpec(100, 100)).toEqual({
      x0: 0,
      y0: 0,
      r0: 0,
      x1: 0,
      y1: 0,
      r1: 70.711,
    });
  });

  it("normalizes stroke dash and join options", () => {
    expect(
      normalizeMotionStroke({
        color: "#f59e0b",
        width: 4,
        opacity: 1.4,
        dashArray: [8, 0, -2, 4],
        dashOffset: 3,
        lineCap: "round",
        lineJoin: "bevel",
      }),
    ).toEqual({
      color: "#f59e0b",
      width: 4,
      opacity: 1,
      dashArray: [8, 4],
      dashOffset: 3,
      lineCap: "round",
      lineJoin: "bevel",
    });
  });

  it("detects advanced shape styles", () => {
    const baseStyle: ShapeStyle = {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#ffffff", width: 0, opacity: 0 },
      cornerRadius: 0,
    };

    expect(hasAdvancedMotionShapeStyle(baseStyle)).toBe(false);
    expect(
      hasAdvancedMotionShapeStyle({
        ...baseStyle,
        fill: createDefaultMotionGradientFill(),
      }),
    ).toBe(true);
    expect(
      hasAdvancedMotionShapeStyle({
        ...baseStyle,
        stroke: { ...baseStyle.stroke, dashArray: [8, 4] },
      }),
    ).toBe(true);
  });

  it("evaluates keyframed shape style values at a local time", () => {
    const evaluated = evaluateMotionShapeLayerStyleAtTime(makeShapeLayer(), 1);

    expect(evaluated.style.stroke.width).toBe(8);
    expect(evaluated.style.fill.gradient?.angle).toBe(45);
  });
});
