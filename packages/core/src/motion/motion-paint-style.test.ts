import { describe, expect, it } from "vitest";
import {
  applyMotionStopOpacity,
  clampMotionCornerRadii,
  parseMotionColor,
  resolveMotionGradientStops,
} from "./motion-paint-style";

describe("parseMotionColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseMotionColor("#14b8a6")).toEqual({ r: 20, g: 184, b: 166, a: 1 });
  });

  it("parses rgba", () => {
    expect(parseMotionColor("rgba(10, 20, 30, 0.5)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
  });

});

describe("applyMotionStopOpacity", () => {
  it("multiplies stop opacity into the color alpha", () => {
    expect(applyMotionStopOpacity("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

});

describe("resolveMotionGradientStops", () => {
  it("sorts stops and bakes opacity", () => {
    const stops = resolveMotionGradientStops([
      { offset: 1, color: "#000000", opacity: 0.5 },
      { offset: 0, color: "#ffffff" },
    ]);
    expect(stops).toEqual([
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "rgba(0, 0, 0, 0.5)" },
    ]);
  });

});

describe("clampMotionCornerRadii", () => {
  it("clamps each corner to half the smallest dimension", () => {
    expect(
      clampMotionCornerRadii(
        { topLeft: 200, topRight: 10, bottomRight: -5, bottomLeft: 40 },
        100,
        80,
      ),
    ).toEqual({ topLeft: 40, topRight: 10, bottomRight: 0, bottomLeft: 40 });
  });

});
