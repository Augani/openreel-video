import { describe, expect, it } from "vitest";
import { resolveMotionSupersample } from "./motion-renderer";

describe("resolveMotionSupersample", () => {
  it("honors a valid factor within the hard cap", () => {
    expect(resolveMotionSupersample(2, 1920, 1080)).toBe(2);
    expect(resolveMotionSupersample(8, 1280, 720)).toBe(4);
  });

  it("clamps the factor so the longest edge stays within the dimension budget", () => {
    const scale = resolveMotionSupersample(2, 5000, 2812);
    expect(scale).toBeCloseTo(8192 / 5000, 5);
    expect(scale * 5000).toBeLessThanOrEqual(8192);
  });

  it("keeps the full factor when the supersampled frame fits the budget", () => {
    expect(resolveMotionSupersample(2, 1920, 1080)).toBe(2);
    expect(resolveMotionSupersample(2, 1920, 1080) * 1920).toBeLessThanOrEqual(8192);
  });
});
