import { describe, expect, it } from "vitest";
import { rasterizeRegionMask, maskWeight, pointInPolygon, type MaskGrid } from "./spectral-mask";
import { regionFeather, regionUsesMask, type SpectralRegion } from "./spectral-regions";
import { sanitizeSpectralRegions } from "./spectral-regions";

const SR = 48000;
const GRID: MaskGrid = { sampleRate: SR, size: 2048, hop: 512, firstFrame: -3, lastFrame: 400 };
const binHz = SR / 2048;
const frameSeconds = 512 / SR;

const base = { id: "m", mode: "remove", gainDb: -120, enabled: true, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;
const lasso = (points: Array<[number, number]>, feather = 0): SpectralRegion => sanitizeSpectralRegions([{ ...base, shape: "lasso", feather, points: points.map(([t, hz]) => ({ t, hz })) }])[0];
const brush = (points: Array<[number, number]>, seconds: number, octaves: number, feather = 0): SpectralRegion =>
  sanitizeSpectralRegions([{ ...base, shape: "brush", feather, brushSeconds: seconds, brushOctaves: octaves, points: points.map(([t, hz]) => ({ t, hz })) }])[0];

const total = (mask: NonNullable<ReturnType<typeof rasterizeRegionMask>>): number => mask.weights.reduce((a, b) => a + b, 0);

describe("point in polygon", () => {
  it("handles convex and concave shapes", () => {
    const xs = Float64Array.from([0, 4, 4, 2, 0]);
    const ys = Float64Array.from([0, 0, 4, 2, 4]); // a notch at the top
    expect(pointInPolygon(1, 1, xs, ys)).toBe(true);
    expect(pointInPolygon(2, 3, xs, ys)).toBe(false);
    expect(pointInPolygon(5, 1, xs, ys)).toBe(false);
  });
});

describe("lasso mask", () => {
  it("covers a polygon with weight 1 inside, 0 outside, and an area close to the polygon's", () => {
    // 0.4 s x (1 kHz .. 2 kHz) in time / log-frequency space: log2 height 1 octave.
    const region = lasso([[0.5, 1000], [0.9, 1000], [0.9, 2000], [0.5, 2000]]);
    const mask = rasterizeRegionMask(region, GRID)!;
    expect(mask).not.toBeNull();
    expect(maskWeight(mask, Math.round((0.7 * SR - 1024) / 512), Math.round(1400 / binHz))).toBe(1);
    expect(maskWeight(mask, Math.round((0.3 * SR - 1024) / 512), Math.round(1400 / binHz))).toBe(0);
    expect(maskWeight(mask, Math.round((0.7 * SR - 1024) / 512), Math.round(3000 / binHz))).toBe(0);
    // Cell area: the polygon is a rectangle in the time / linear-frequency view too (edges are straight in log space,
    // vertical edges are exact), so the covered bin count matches the frequency span.
    const cells = total(mask);
    const expected = (0.4 / frameSeconds) * (1000 / binHz);
    expect(cells / expected).toBeGreaterThan(0.95);
    expect(cells / expected).toBeLessThan(1.05);
  });

  it("is straight on the log-frequency plane: a triangle's hypotenuse does not bow", () => {
    const region = lasso([[0.2, 100], [1.0, 100], [1.0, 6400]]);
    const mask = rasterizeRegionMask(region, GRID)!;
    // At the half-way time the hypotenuse sits at 100 * 2^3 = 800 Hz (log-linear), so 500 Hz is inside and 1500 Hz is outside.
    const m = Math.round((0.6 * SR - 1024) / 512);
    expect(maskWeight(mask, m, Math.round(500 / binHz))).toBeGreaterThan(0.9);
    expect(maskWeight(mask, m, Math.round(1500 / binHz))).toBe(0);
  });

  it("returns null for a shape that covers no cell, and ignores degenerate polygons at sanitize time", () => {
    expect(sanitizeSpectralRegions([{ ...base, shape: "lasso", points: [{ t: 1, hz: 100 }, { t: 2, hz: 100 }] }])).toEqual([]);
    expect(rasterizeRegionMask(lasso([[0.5, 1000], [0.502, 1000], [0.502, 1001]]), GRID)).toBeNull();
  });

  it("softens the edge with the feather and keeps weights in [0, 1]", () => {
    const hard = rasterizeRegionMask(lasso([[0.5, 1000], [0.9, 1000], [0.9, 2000], [0.5, 2000]], 0), GRID)!;
    const soft = rasterizeRegionMask(lasso([[0.5, 1000], [0.9, 1000], [0.9, 2000], [0.5, 2000]], 3), GRID)!;
    expect(soft.frames).toBeGreaterThan(hard.frames);
    expect(Math.max(...soft.weights)).toBeLessThanOrEqual(1);
    expect(Math.min(...soft.weights)).toBeGreaterThanOrEqual(0);
    const m = Math.round((0.7 * SR - 1024) / 512);
    const row = (mask: typeof soft) => Array.from({ length: mask.bins }, (_, b) => mask.weights[(m - mask.mFirst) * mask.bins + b]);
    const hardRow = row(hard).filter((w) => w > 0 && w < 1).length;
    const softRow = row(soft).filter((w) => w > 0 && w < 1).length;
    expect(hardRow).toBeLessThanOrEqual(2);
    expect(softRow).toBeGreaterThan(hardRow + 4);
    // Feathering redistributes weight, it does not create it.
    expect(total(soft) / total(hard)).toBeGreaterThan(0.9);
    expect(total(soft) / total(hard)).toBeLessThan(1.1);
  });

  it("is deterministic", () => {
    const region = lasso([[0.5, 700], [1.2, 2500], [0.8, 4000]], 2);
    expect(Array.from(rasterizeRegionMask(region, GRID)!.weights)).toEqual(Array.from(rasterizeRegionMask(region, GRID)!.weights));
  });
});

describe("brush mask", () => {
  it("paints an ellipse of the stored radii around a single dab", () => {
    const region = brush([[1.0, 1000]], 0.1, 0.5, 0);
    const mask = rasterizeRegionMask(region, GRID)!;
    const mAt = (t: number) => Math.round((t * SR - 1024) / 512);
    expect(maskWeight(mask, mAt(1.0), Math.round(1000 / binHz))).toBe(1);
    expect(maskWeight(mask, mAt(1.08), Math.round(1000 / binHz))).toBe(1);
    expect(maskWeight(mask, mAt(1.14), Math.round(1000 / binHz))).toBe(0);
    // 0.5 octave up = 1414 Hz is the edge; 1300 Hz in, 1600 Hz out.
    expect(maskWeight(mask, mAt(1.0), Math.round(1300 / binHz))).toBe(1);
    expect(maskWeight(mask, mAt(1.0), Math.round(1600 / binHz))).toBe(0);
    expect(region.lowHz).toBeCloseTo(1000 / Math.SQRT2, 0);
    expect(region.highHz).toBeCloseTo(1000 * Math.SQRT2, 0);
    expect(region.startTime).toBeCloseTo(0.9, 6);
    expect(region.endTime).toBeCloseTo(1.1, 6);
  });

  it("joins dabs into a continuous stroke", () => {
    const stroke = brush([[0.4, 500], [0.8, 500], [1.2, 2000]], 0.03, 0.15, 0);
    const mask = rasterizeRegionMask(stroke, GRID)!;
    const mAt = (t: number) => Math.round((t * SR - 1024) / 512);
    for (let t = 0.4; t <= 0.8; t += 0.02) expect(maskWeight(mask, mAt(t), Math.round(500 / binHz))).toBeGreaterThan(0.5);
    // Half-way along the rising segment: 0.8 -> 1.2 s is 500 -> 2000 Hz, i.e. 1000 Hz at 1.0 s.
    expect(maskWeight(mask, mAt(1.0), Math.round(1000 / binHz))).toBeGreaterThan(0.5);
    expect(maskWeight(mask, mAt(1.0), Math.round(3000 / binHz))).toBe(0);
  });
});

describe("rectangle heal mask", () => {
  it("rasterises a rectangle (heal is the only mode that routes a rectangle through the mask path)", () => {
    const rect: SpectralRegion = { ...base, mode: "heal", startTime: 0.5, endTime: 0.7, lowHz: 1000, highHz: 2000 };
    expect(regionUsesMask(rect)).toBe(true);
    expect(regionUsesMask({ ...rect, mode: "remove" })).toBe(false);
    expect(regionFeather(rect)).toBe(1);
    const mask = rasterizeRegionMask(rect, GRID)!;
    const m = Math.round((0.6 * SR - 1024) / 512);
    expect(maskWeight(mask, m, Math.round(1500 / binHz))).toBe(1);
    expect(maskWeight(mask, m, Math.round(4000 / binHz))).toBe(0);
  });
});
