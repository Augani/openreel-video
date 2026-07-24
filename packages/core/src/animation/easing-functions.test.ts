import { describe, expect, it } from "vitest";
import { ALL_EASING_NAMES, EASING_FUNCTIONS } from "./easing-functions";

describe("easing functions", () => {
  it("exposes the full 50-name easing catalog", () => {
    expect(ALL_EASING_NAMES).toHaveLength(50);
    expect(new Set(ALL_EASING_NAMES).size).toBe(50);
  });

  it("keeps named easings anchored at the endpoints", () => {
    for (const easingName of ALL_EASING_NAMES) {
      expect(EASING_FUNCTIONS[easingName](0)).toBeCloseTo(0, 6);
      expect(EASING_FUNCTIONS[easingName](1)).toBeCloseTo(1, 6);
    }
  });

  it("supports legacy kebab-case aliases", () => {
    expect(EASING_FUNCTIONS["ease-in"](0.5)).toBeCloseTo(EASING_FUNCTIONS.easeInQuad(0.5), 6);
    expect(EASING_FUNCTIONS["ease-out"](0.5)).toBeCloseTo(EASING_FUNCTIONS.easeOutQuad(0.5), 6);
    expect(EASING_FUNCTIONS["ease-in-out"](0.5)).toBeCloseTo(EASING_FUNCTIONS.easeInOutQuad(0.5), 6);
  });

  it("supports hold keyframes as stepped interpolation", () => {
    expect(EASING_FUNCTIONS.hold(0)).toBe(0);
    expect(EASING_FUNCTIONS.hold(0.999)).toBe(0);
    expect(EASING_FUNCTIONS.hold(1)).toBe(1);
  });
});
