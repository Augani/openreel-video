import { describe, expect, it } from "vitest";
import {
  computeColorMatch,
  computeColorStats,
  isIdentityColorMatch,
  labToRgb,
  rgbToLab,
  type ColorStats,
} from "./color-match";
import type { ScopeImageLike } from "./scopes";
import type { ColorWheelValues } from "./color-grading-engine";

/** A frame whose pixels sweep luminance, tinted by `tint` (0..255 per channel gain around the sweep). */
function tinted(rgb: [number, number, number], width = 32, height = 16): ScopeImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = 0.3 + (x / (width - 1)) * 0.6;
      const o = (y * width + x) * 4;
      data[o] = Math.min(255, rgb[0] * t);
      data[o + 1] = Math.min(255, rgb[1] * t);
      data[o + 2] = Math.min(255, rgb[2] * t);
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const stats = (image: ScopeImageLike): ColorStats => {
  const result = computeColorStats(image);
  if (!result) throw new Error("no stats");
  return result;
};

/** Mirrors the colour wheels shader (offsets, midtone gamma, highlight gain) for a mean colour check. */
function applyWheels(rgb: [number, number, number], wheels: ColorWheelValues): [number, number, number] {
  const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const shadowW = 1 - smooth(0, 0.5, luma);
  const highlightW = smooth(0.5, 1, luma);
  const midW = 1 - shadowW - highlightW;
  const keys = ["r", "g", "b"] as const;
  return keys.map((key, i) => {
    let v = rgb[i] / 255;
    v += wheels.shadows[key] * shadowW + wheels.midtones[key] * midW + wheels.highlights[key] * highlightW;
    v += wheels.shadowsLift * shadowW;
    v = Math.pow(Math.max(0, v), 1 / wheels.midtonesGamma);
    v *= 1 + (wheels.highlightsGain - 1) * highlightW;
    return Math.max(0, Math.min(1, v)) * 255;
  }) as [number, number, number];
}

describe("Lab conversion", () => {
  it("round-trips sRGB", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [200, 40, 90], [12, 180, 220]] as const) {
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      const back = labToRgb(lab.l, lab.a, lab.b);
      expect(back.r * 255).toBeCloseTo(rgb[0], 0);
      expect(back.g * 255).toBeCloseTo(rgb[1], 0);
      expect(back.b * 255).toBeCloseTo(rgb[2], 0);
    }
    expect(rgbToLab(255, 255, 255).l).toBeCloseTo(100, 1);
  });
});

describe("computeColorMatch", () => {
  it("matching a source to itself is an identity", () => {
    const s = stats(tinted([200, 150, 120]));
    expect(isIdentityColorMatch(computeColorMatch(s, s, 1))).toBe(true);
  });

  it("intensity 0 is an identity whatever the reference", () => {
    const warm = stats(tinted([240, 150, 80]));
    const cool = stats(tinted([90, 140, 230]));
    expect(isIdentityColorMatch(computeColorMatch(warm, cool, 0))).toBe(true);
    expect(isIdentityColorMatch(computeColorMatch(warm, cool, 0.5))).toBe(false);
  });

  it("makes a cool source warmer when matched to a warm reference", () => {
    const warm = stats(tinted([240, 150, 80]));
    const cool = stats(tinted([90, 140, 230]));
    const result = computeColorMatch(warm, cool, 1);
    expect(result.colorWheels.midtones.r).toBeGreaterThan(0);
    expect(result.colorWheels.midtones.b).toBeLessThan(0);
    const before: [number, number, number] = [90, 140, 230].map((v) => v * 0.6) as [number, number, number];
    const after = applyWheels(before, result.colorWheels);
    expect(after[0] - after[2]).toBeGreaterThan(before[0] - before[2] + 20);
  });

  it("moves the source mean colour toward the reference", () => {
    const reference = tinted([240, 150, 80]);
    const source = tinted([90, 140, 230]);
    const refStats = stats(reference);
    const srcStats = stats(source);
    const result = computeColorMatch(refStats, srcStats, 1);
    const graded = new Uint8ClampedArray(source.data);
    for (let i = 0; i < graded.length; i += 4) {
      const out = applyWheels([graded[i], graded[i + 1], graded[i + 2]], result.colorWheels);
      graded[i] = out[0];
      graded[i + 1] = out[1];
      graded[i + 2] = out[2];
    }
    const gradedStats = stats({ data: graded, width: source.width, height: source.height });
    const distance = (a: ColorStats, b: ColorStats): number => Math.hypot(a.a.mean - b.a.mean, a.b.mean - b.b.mean);
    expect(distance(gradedStats, refStats)).toBeLessThan(distance(srcStats, refStats) * 0.6);
  });

  it("scales deltas with intensity", () => {
    const warm = stats(tinted([240, 150, 80]));
    const cool = stats(tinted([90, 140, 230]));
    const half = computeColorMatch(warm, cool, 0.5);
    const full = computeColorMatch(warm, cool, 1);
    expect(Math.abs(half.colorWheels.midtones.r)).toBeLessThan(Math.abs(full.colorWheels.midtones.r));
    expect(half.colorWheels.midtones.r).toBeCloseTo(full.colorWheels.midtones.r / 2, 2);
  });

  it("matches brightness and contrast through gamma and tone", () => {
    const bright = stats(tinted([255, 255, 255]));
    const dark = stats({ ...tinted([120, 120, 120]) });
    const result = computeColorMatch(bright, dark, 1);
    expect(result.colorWheels.midtonesGamma).toBeGreaterThan(1);
    expect(result.tone.contrast).toBeGreaterThan(0);
  });

  it("returns null stats for an empty frame", () => {
    expect(computeColorStats({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
  });
});
