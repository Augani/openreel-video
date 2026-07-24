import { describe, expect, it } from "vitest";
import {
  applyMotionStopOpacity,
  clampMotionCornerRadii,
  getMotionConicAngleRadians,
  getMotionGradientCenter,
  motionRgbaToCss,
  parseMotionColor,
  resolveMotionGradientStops,
} from "./motion-paint-style";

describe("parseMotionColor", () => {
  it("parses 6-digit hex", () => {
    expect(parseMotionColor("#14b8a6")).toEqual({ r: 20, g: 184, b: 166, a: 1 });
  });

  it("parses 8-digit hex with alpha", () => {
    expect(parseMotionColor("#000000ff")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseMotionColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("parses short hex", () => {
    expect(parseMotionColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("parses rgba", () => {
    expect(parseMotionColor("rgba(10, 20, 30, 0.5)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
  });

  it("returns null for unknown formats", () => {
    expect(parseMotionColor("not-a-color")).toBeNull();
    expect(parseMotionColor(undefined)).toBeNull();
  });
});

describe("applyMotionStopOpacity", () => {
  it("multiplies stop opacity into the color alpha", () => {
    expect(applyMotionStopOpacity("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("compounds with an existing alpha", () => {
    expect(applyMotionStopOpacity("rgba(0, 0, 0, 0.5)", 0.5)).toBe(
      "rgba(0, 0, 0, 0.25)",
    );
  });

  it("returns the original color when opacity is undefined", () => {
    expect(applyMotionStopOpacity("#abcdef", undefined)).toBe("#abcdef");
  });

  it("returns the original color when it cannot be parsed", () => {
    expect(applyMotionStopOpacity("currentColor", 0.5)).toBe("currentColor");
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

  it("provides a sensible default for empty stops", () => {
    expect(resolveMotionGradientStops([])).toHaveLength(2);
  });

  it("duplicates a single stop", () => {
    const stops = resolveMotionGradientStops([{ offset: 0.5, color: "#123456" }]);
    expect(stops).toEqual([
      { offset: 0, color: "#123456" },
      { offset: 1, color: "#123456" },
    ]);
  });
});

describe("getMotionGradientCenter", () => {
  it("maps normalized center to shape-local pixels", () => {
    expect(getMotionGradientCenter(200, 100, { x: 0.5, y: 0.5 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(getMotionGradientCenter(200, 100, { x: 1, y: 0 })).toEqual({
      x: 100,
      y: -50,
    });
  });

  it("defaults to the shape center when no center is provided", () => {
    expect(getMotionGradientCenter(200, 100, undefined)).toEqual({ x: 0, y: 0 });
  });
});

describe("getMotionConicAngleRadians", () => {
  it("converts degrees to radians", () => {
    expect(getMotionConicAngleRadians(180)).toBeCloseTo(Math.PI);
    expect(getMotionConicAngleRadians(undefined)).toBe(0);
  });
});

describe("motionRgbaToCss", () => {
  it("formats and clamps channels", () => {
    expect(motionRgbaToCss({ r: 300, g: -5, b: 128, a: 2 })).toBe(
      "rgba(255, 0, 128, 1)",
    );
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

  it("treats non-finite radii as zero", () => {
    expect(
      clampMotionCornerRadii(
        {
          topLeft: Number.NaN,
          topRight: 5,
          bottomRight: 5,
          bottomLeft: 5,
        },
        100,
        100,
      ),
    ).toEqual({ topLeft: 0, topRight: 5, bottomRight: 5, bottomLeft: 5 });
  });
});
