import { describe, expect, it } from "vitest";
import { resolveMotionSupersample } from "./motion-renderer";

describe("resolveMotionSupersample", () => {
  it("defaults to 1 when no factor is requested", () => {
    expect(resolveMotionSupersample(undefined, 1920, 1080)).toBe(1);
  });

  it("ignores non-finite requests", () => {
    expect(resolveMotionSupersample(Number.NaN, 1920, 1080)).toBe(1);
    expect(resolveMotionSupersample(Number.POSITIVE_INFINITY, 1920, 1080)).toBe(1);
  });

  it("never scales below 1", () => {
    expect(resolveMotionSupersample(0.25, 1920, 1080)).toBe(1);
    expect(resolveMotionSupersample(-4, 1920, 1080)).toBe(1);
  });

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
