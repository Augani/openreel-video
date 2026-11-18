import { describe, expect, it } from "vitest";
import { computeScopeStats, hueName } from "./scope-stats";

function frame(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number?],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  return { data, width, height };
}

describe("computeScopeStats", () => {
  it("measures a full-range black/white split frame", () => {
    const stats = computeScopeStats(frame(40, 20, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255])))!;
    expect(stats.luma).toMatchObject({ min: 0, max: 100, blackClipPct: 50, whiteClipPct: 50 });
    expect(stats.luma.average).toBeCloseTo(50, 1);
    expect(stats.luma.p1).toBe(0);
    expect(stats.luma.p99).toBe(100);
    expect(stats.saturation).toEqual({ average: 0, max: 0 });
    expect(stats.dominantHue).toBeNull();
    expect(stats.red.whiteClipPct).toBe(50);
    expect(stats.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a clean mid-grey frame with no clipping and a low-contrast note", () => {
    const stats = computeScopeStats(frame(16, 16, () => [128, 128, 128]))!;
    expect(stats.luma.min).toBeCloseTo(50.2, 1);
    expect(stats.luma.max).toBeCloseTo(50.2, 1);
    expect(stats.luma.blackClipPct).toBe(0);
    expect(stats.luma.whiteClipPct).toBe(0);
    expect(stats.cast.cb).toBeCloseTo(0, 3);
    expect(stats.cast.cr).toBeCloseTo(0, 3);
    expect(stats.warnings.join(" ")).toMatch(/low contrast/i);
    expect(stats.warnings.join(" ")).not.toMatch(/clipped|crushed/i);
  });

  it("finds the dominant hue and share, ignoring neutral pixels", () => {
    const stats = computeScopeStats(
      frame(30, 10, (x) => (x < 20 ? [30, 60, 220] : [128, 128, 128])),
    )!;
    expect(stats.dominantHue?.name).toBe("blue");
    expect(stats.dominantHue!.degrees).toBeGreaterThan(215);
    expect(stats.dominantHue!.degrees).toBeLessThan(245);
    expect(stats.dominantHue!.share).toBeGreaterThan(0.95);
    expect(stats.cast.cb).toBeGreaterThan(0);
  });

  it("measures distance from the skin-tone line", () => {
    const skin = computeScopeStats(frame(8, 8, () => [224, 172, 140]))!;
    expect(skin.dominantHue?.name).toBe("orange");
    expect(skin.skinToneOffsetDegrees).toBeLessThan(15);
    const green = computeScopeStats(frame(8, 8, () => [20, 200, 40]))!;
    expect(green.skinToneOffsetDegrees).toBeGreaterThan(60);
  });

  it("flags a single clipping channel", () => {
    const stats = computeScopeStats(frame(10, 10, () => [255, 90, 90]))!;
    expect(stats.red.whiteClipPct).toBe(100);
    expect(stats.luma.whiteClipPct).toBe(0);
    expect(stats.warnings.join(" ")).toMatch(/red channel clips/i);
  });

  it("skips transparent pixels and returns null for empty input", () => {
    const half = computeScopeStats(
      frame(10, 10, (x) => (x < 5 ? [255, 255, 255, 0] : [100, 100, 100])),
    )!;
    expect(half.pixels).toBe(50);
    expect(half.luma.whiteClipPct).toBe(0);
    expect(computeScopeStats(frame(4, 4, () => [1, 2, 3, 0]))).toBeNull();
    expect(computeScopeStats({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
  });

  it("downsamples large frames so the cost stays bounded", () => {
    const stats = computeScopeStats(frame(1024, 512, () => [200, 200, 200]))!;
    expect(stats.width).toBeLessThanOrEqual(256);
    expect(stats.luma.average).toBeCloseTo(78.4, 1);
  });

  it("names hues around the wheel", () => {
    expect(hueName(0)).toBe("red");
    expect(hueName(30)).toBe("orange");
    expect(hueName(60)).toBe("yellow");
    expect(hueName(120)).toBe("green");
    expect(hueName(180)).toBe("cyan");
    expect(hueName(240)).toBe("blue");
    expect(hueName(270)).toBe("violet");
    expect(hueName(300)).toBe("magenta");
    expect(hueName(350)).toBe("red");
    expect(hueName(-120)).toBe("blue");
  });
});
