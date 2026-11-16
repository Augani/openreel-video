import { describe, expect, it } from "vitest";
import { SVG_RASTER_PAD, planSvgRaster, svgRasterBucket } from "./svg-raster";

describe("svg raster plan (shared by preview and export)", () => {
  it("quantises to eighths and never rasterises far below the on-screen size", () => {
    expect(svgRasterBucket(1)).toBe(1);
    expect(svgRasterBucket(0.32)).toBeCloseTo(0.375, 6);
    expect(svgRasterBucket(1.01)).toBeCloseTo(1.125, 6);
    expect(svgRasterBucket(0)).toBe(1);
    expect(svgRasterBucket(0.01)).toBe(0.125);
    // drawn at most ~1.17x smaller than rasterised, instead of the old 3x for a 0.32 clip
    expect(svgRasterBucket(0.32) / 0.32).toBeLessThan(1.2);
  });

  it("sizes the bitmap by the landscape width or portrait height, with a margin", () => {
    const wide = planSvgRaster({ width: 400, height: 240 }, 640, 360, 0.32, 0.32);
    expect(wide.renderWidth).toBe(240);
    expect(wide.renderHeight).toBe(144);
    expect(wide.paddedWidth).toBe(240 + SVG_RASTER_PAD * 2);
    expect(wide.drawWidth).toBeCloseTo(640, 6);
    expect(wide.padDraw).toBeCloseTo(SVG_RASTER_PAD / 0.375, 6);
    const tall = planSvgRaster({ width: 100, height: 200 }, 640, 360, 1, 1);
    expect(tall.renderHeight).toBe(360);
    expect(tall.renderWidth).toBe(180);
  });
});
