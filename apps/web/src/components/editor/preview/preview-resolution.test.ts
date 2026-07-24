import { describe, it, expect } from "vitest";
import {
  PREVIEW_MAX_DIMENSION,
  computePreviewResolution,
} from "./preview-resolution";

describe("computePreviewResolution", () => {
  it("exposes a 1920px default max dimension", () => {
    expect(PREVIEW_MAX_DIMENSION).toBe(1920);
  });

  it("never upscales: 1920x1080 stays unchanged with scale 1", () => {
    const result = computePreviewResolution(1920, 1080);
    expect(result).toEqual({ width: 1920, height: 1080, scale: 1 });
  });

  it("never upscales: 1280x720 stays unchanged with scale 1", () => {
    const result = computePreviewResolution(1280, 720);
    expect(result).toEqual({ width: 1280, height: 720, scale: 1 });
  });

  it("never upscales smaller-than-cap portrait input", () => {
    const result = computePreviewResolution(720, 1280);
    expect(result).toEqual({ width: 720, height: 1280, scale: 1 });
  });

  it("caps the longest edge: 3840x2160 (4K) -> 1920x1080", () => {
    const result = computePreviewResolution(3840, 2160);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.scale).toBeCloseTo(0.5, 10);
  });

  it("caps the longest edge for portrait: 2160x3840 -> 1080x1920", () => {
    const result = computePreviewResolution(2160, 3840);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.scale).toBeCloseTo(0.5, 10);
  });

  it("caps the longest edge: 7680x4320 (8K) -> 1920x1080", () => {
    const result = computePreviewResolution(7680, 4320);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.scale).toBeCloseTo(0.25, 10);
  });

  it("keeps scale <= 1 for any input", () => {
    const inputs: Array<[number, number]> = [
      [1920, 1080],
      [3840, 2160],
      [7680, 4320],
      [1080, 1920],
      [5000, 100],
      [100, 5000],
      [1921, 1080],
    ];
    for (const [w, h] of inputs) {
      const { scale } = computePreviewResolution(w, h);
      expect(scale).toBeLessThanOrEqual(1);
    }
  });

  it("preserves aspect ratio within rounding tolerance", () => {
    const sourceAspect = 3840 / 2160;
    const { width, height } = computePreviewResolution(3840, 2160);
    expect(width / height).toBeCloseTo(sourceAspect, 2);

    const oddAspect = 1921 / 803;
    const odd = computePreviewResolution(1921, 803);
    expect(odd.width / odd.height).toBeCloseTo(oddAspect, 2);
  });

  it("returns integer dimensions", () => {
    const { width, height } = computePreviewResolution(1921, 803);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it("respects a custom max dimension", () => {
    const result = computePreviewResolution(1920, 1080, 1280);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.scale).toBeCloseTo(1280 / 1920, 10);
  });

  it("returns dimensions >= 1 and scale 1 for zero input", () => {
    const result = computePreviewResolution(0, 0);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
    expect(result.scale).toBe(1);
  });

  it("handles negative input defensively without upscaling", () => {
    const result = computePreviewResolution(-100, -50);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
    expect(result.scale).toBe(1);
  });

  it("rounds tiny dimensions up to at least 1", () => {
    const result = computePreviewResolution(0.4, 0.4);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
