import { describe, expect, it } from "vitest";
import { computeAutoTone } from "./auto-tone";
import { buildToneCurve, sampleToneCurve } from "./tone-curve";
import { computeScopeStats } from "./scope-stats";
import type { ScopeImageLike } from "./scopes";
import type { ToneValues } from "./color-grading-engine";

/** Horizontal gray ramp from `low` to `high` (0..255), `width` distinct columns. */
function ramp(low: number, high: number, width = 256, height = 8): ScopeImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const level = Math.round(low + (x / (width - 1)) * (high - low));
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = level;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

function applyTone(image: ScopeImageLike, tone: ToneValues): ScopeImageLike {
  const curve = buildToneCurve(tone);
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(sampleToneCurve(curve, data[i + c] / 255) * 255);
  }
  return { data, width: image.width, height: image.height };
}

const maxAbs = (tone: ToneValues): number => Math.max(...Object.values(tone).map(Math.abs));

describe("computeAutoTone", () => {
  it("raises an underexposed ramp into a higher-key image", () => {
    const dark = ramp(0, 90);
    const result = computeAutoTone(dark);
    expect(result.tone.exposure).toBeGreaterThan(0.1);
    const before = computeScopeStats(dark)!;
    const after = computeScopeStats(applyTone(dark, result.tone))!;
    expect(after.luma.median).toBeGreaterThan(before.luma.median + 10);
    expect(after.luma.p99).toBeGreaterThan(before.luma.p99 + 20);
    expect(after.luma.median).toBeGreaterThan(38);
    expect(after.luma.median).toBeLessThan(52);
  });

  it("widens a flat, low-contrast ramp", () => {
    const flat = ramp(90, 170);
    const result = computeAutoTone(flat);
    expect(result.tone.contrast).toBeGreaterThan(0.1);
    const before = computeScopeStats(flat)!;
    const after = computeScopeStats(applyTone(flat, result.tone))!;
    expect(after.luma.max - after.luma.min).toBeGreaterThan((before.luma.max - before.luma.min) * 1.5);
  });

  it("backs off a clipped ramp", () => {
    const width = 256;
    // 25% of the frame is blown to pure white.
    const clipped = ramp(0, 255, width);
    for (let y = 0; y < clipped.height; y++) {
      for (let x = Math.floor(width * 0.75); x < width; x++) {
        const o = (y * width + x) * 4;
        clipped.data[o] = clipped.data[o + 1] = clipped.data[o + 2] = 255;
      }
    }
    const result = computeAutoTone(clipped);
    expect(result.measured.whiteClipShare).toBeGreaterThan(0.2);
    const curve = buildToneCurve(result.tone);
    expect(curve[255]).toBeLessThan(0.985);
    expect(result.tone.whites).toBeLessThan(0);
  });

  it("leaves a neutral chart within epsilon of identity", () => {
    const chart = ramp(8, 246);
    const result = computeAutoTone(chart);
    expect(maxAbs(result.tone)).toBeLessThan(0.1);
    expect(result.temperature).toBe(0);
    expect(result.tint).toBe(0);
  });

  it("is stable when applied twice", () => {
    for (const source of [ramp(0, 90), ramp(90, 170), ramp(40, 255)]) {
      const first = computeAutoTone(source);
      const corrected = applyTone(source, first.tone);
      const second = computeAutoTone(corrected);
      expect(maxAbs(second.tone), JSON.stringify({ first: first.tone, second: second.tone })).toBeLessThan(0.08);
    }
  });

  it("is deterministic", () => {
    const image = ramp(10, 120);
    expect(computeAutoTone(image)).toEqual(computeAutoTone(image));
  });

  it("estimates a white balance correction only when asked", () => {
    const width = 64;
    const warm = { data: new Uint8ClampedArray(width * 4 * 4), width, height: 4 };
    for (let i = 0; i < width * 4; i++) {
      warm.data[i * 4] = 180;
      warm.data[i * 4 + 1] = 120;
      warm.data[i * 4 + 2] = 70;
      warm.data[i * 4 + 3] = 255;
    }
    expect(computeAutoTone(warm).temperature).toBe(0);
    const balanced = computeAutoTone(warm, { whiteBalance: true });
    expect(balanced.temperature).toBeLessThan(0);
    expect(Math.abs(balanced.temperature)).toBeLessThanOrEqual(40);
  });

  it("returns identity for an empty histogram", () => {
    const result = computeAutoTone({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(maxAbs(result.tone)).toBe(0);
  });
});
