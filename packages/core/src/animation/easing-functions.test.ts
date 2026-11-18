import { describe, expect, it } from "vitest";
import { EASING_FUNCTIONS, type EasingName } from "./easing-functions";

const ALL_EASING_NAMES = Object.keys(EASING_FUNCTIONS) as EasingName[];

describe("easing functions", () => {
  it("keeps named easings anchored at the endpoints", () => {
    for (const easingName of ALL_EASING_NAMES) {
      expect(EASING_FUNCTIONS[easingName](0)).toBeCloseTo(0, 6);
      expect(EASING_FUNCTIONS[easingName](1)).toBeCloseTo(1, 6);
    }
  });

  it("supports hold keyframes as stepped interpolation", () => {
    expect(EASING_FUNCTIONS.hold(0)).toBe(0);
    expect(EASING_FUNCTIONS.hold(0.999)).toBe(0);
    expect(EASING_FUNCTIONS.hold(1)).toBe(1);
  });
});
