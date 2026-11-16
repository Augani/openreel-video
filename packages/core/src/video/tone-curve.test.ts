import { describe, expect, it } from "vitest";
import {
  applyToneToData,
  applyVignetteToData,
  buildToneCurve,
  buildToneCurve8,
  sampleToneCurve,
  vignetteWeight,
} from "./tone-curve";
import {
  DEFAULT_TONE,
  DEFAULT_VIGNETTE,
  isNeutralColorGrading,
  isNeutralTone,
  isNeutralVignette,
} from "./color-grading-defaults";
import type { ToneValues } from "./color-grading-engine";

const tone = (overrides: Partial<ToneValues>): ToneValues => ({
  ...DEFAULT_TONE,
  ...overrides,
});

const idx = (x: number): number => Math.round(x * 255);

describe("buildToneCurve", () => {
  it("is the identity for all zeros", () => {
    const curve = buildToneCurve(DEFAULT_TONE);
    expect(curve).toHaveLength(256);
    for (let i = 0; i < 256; i++) expect(curve[i]).toBeCloseTo(i / 255, 6);
  });

  it("highlights +1 leaves the lower half untouched and moves only the top", () => {
    const curve = buildToneCurve(tone({ highlights: 1 }));
    for (let i = 0; i < idx(0.5); i++) expect(curve[i]).toBeCloseTo(i / 255, 6);
    expect(curve[idx(0.75)]).toBeGreaterThan(0.75 + 0.05);
    // The top quartile carries the change: nothing at or below 0.5 differs.
    expect(curve[255]).toBeCloseTo(1, 6);
  });

  it("shadows +1 lifts the bottom and leaves the upper half untouched", () => {
    const curve = buildToneCurve(tone({ shadows: 1 }));
    expect(curve[idx(0.25)]).toBeGreaterThan(0.25 + 0.05);
    for (let i = idx(0.5); i < 256; i++) expect(curve[i]).toBeCloseTo(i / 255, 6);
    expect(curve[0]).toBe(0);
  });

  it("blacks -1 never goes below 0 and crushes the bottom", () => {
    const curve = buildToneCurve(tone({ blacks: -1 }));
    for (const value of curve) expect(value).toBeGreaterThanOrEqual(0);
    expect(curve[0]).toBe(0);
    expect(curve[idx(0.05)]).toBeLessThan(0.05);
    expect(curve[idx(0.6)]).toBeCloseTo(0.6, 3);
  });

  it("blacks +1 lifts the black point and whites -1 lowers the white point", () => {
    expect(buildToneCurve(tone({ blacks: 1 }))[0]).toBeGreaterThan(0.05);
    expect(buildToneCurve(tone({ whites: -1 }))[255]).toBeLessThan(0.95);
  });

  it("exposure and contrast move the mid and spread the curve", () => {
    expect(buildToneCurve(tone({ exposure: 0.5 }))[idx(0.3)]).toBeGreaterThan(0.4);
    const contrasty = buildToneCurve(tone({ contrast: 0.5 }));
    expect(contrasty[idx(0.5)]).toBeCloseTo(0.5, 2);
    expect(contrasty[idx(0.25)]).toBeLessThan(0.25);
    expect(contrasty[idx(0.75)]).toBeGreaterThan(0.75);
  });

  it("is monotonic and within 0..1 for every slider combination on a grid", () => {
    const values = [-1, -0.4, 0.4, 1];
    for (const exposure of values)
      for (const contrast of values)
        for (const highlights of values)
          for (const shadows of values)
            for (const whites of values)
              for (const blacks of values) {
                const curve = buildToneCurve({ exposure, contrast, highlights, shadows, whites, blacks });
                let ok = curve[0] >= 0 && curve[255] <= 1;
                for (let i = 1; i < 256 && ok; i++) ok = curve[i] >= curve[i - 1];
                if (!ok) throw new Error(`curve not monotonic for ${JSON.stringify({ exposure, contrast, highlights, shadows, whites, blacks })}`);
              }
  });

  it("clamps out-of-range and non-finite inputs", () => {
    const curve = buildToneCurve(tone({ exposure: 50, blacks: Number.NaN }));
    for (const value of curve) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("neutral checks", () => {
  it("treats zero tone and zero-amount vignette as neutral", () => {
    expect(isNeutralTone(undefined)).toBe(true);
    expect(isNeutralTone(DEFAULT_TONE)).toBe(true);
    expect(isNeutralTone(tone({ whites: 0.2 }))).toBe(false);
    expect(isNeutralVignette(undefined)).toBe(true);
    expect(isNeutralVignette({ ...DEFAULT_VIGNETTE, midpoint: 0.9 })).toBe(true);
    expect(isNeutralVignette({ ...DEFAULT_VIGNETTE, amount: -0.4 })).toBe(false);
  });

  it("makes a grade with only tone or vignette non-neutral", () => {
    expect(isNeutralColorGrading({ tone: DEFAULT_TONE, vignette: DEFAULT_VIGNETTE })).toBe(true);
    expect(isNeutralColorGrading({ tone: tone({ shadows: 0.1 }) })).toBe(false);
    expect(isNeutralColorGrading({ vignette: { ...DEFAULT_VIGNETTE, amount: 0.3 } })).toBe(false);
  });
});

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const level = Math.round((x / (width - 1)) * 255);
      const o = (y * width + x) * 4;
      data[o] = level;
      data[o + 1] = level;
      data[o + 2] = level;
      data[o + 3] = 255;
    }
  }
  return data;
}

describe("CPU grading path versus the float reference", () => {
  const points = [0, 0.25, 0.5, 0.75, 1];

  it("tracks the float tone curve within 2/255 at five sample points", () => {
    const width = 256;
    const settings = tone({ exposure: 0.2, contrast: 0.3, shadows: 0.5, highlights: -0.4, whites: 0.2, blacks: -0.3 });
    const data = gradient(width, 4);
    applyToneToData(data, settings);
    const reference = buildToneCurve(settings);
    for (const p of points) {
      const x = Math.round(p * (width - 1));
      const expected = sampleToneCurve(reference, x / (width - 1)) * 255;
      for (let c = 0; c < 3; c++) expect(Math.abs(data[x * 4 + c] - expected)).toBeLessThanOrEqual(2);
      expect(data[x * 4 + 3]).toBe(255);
    }
  });

  it("the 8-bit table is the rounded float curve", () => {
    const settings = tone({ shadows: 0.7, contrast: -0.2 });
    const curve = buildToneCurve(settings);
    const lut = buildToneCurve8(settings);
    for (let i = 0; i < 256; i++) expect(Math.abs(lut[i] - curve[i] * 255)).toBeLessThanOrEqual(0.5);
  });

  it("darkens vignette corners to the analytic value and leaves the centre alone", () => {
    const width = 64;
    const height = 36;
    const data = new Uint8ClampedArray(width * height * 4).fill(200);
    const vignette = { amount: -0.6, midpoint: 0.4, roundness: 0, feather: 0.5 };
    applyVignetteToData(data, width, height, vignette);
    const at = (x: number, y: number): number => data[(y * width + x) * 4];
    expect(at(width / 2, height / 2)).toBe(200);
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width / 2, 0]] as const) {
      const weight = vignetteWeight(((x + 0.5) / width) * 2 - 1, ((y + 0.5) / height) * 2 - 1, width / height, vignette);
      expect(Math.abs(at(x, y) - 200 * (1 - 0.6 * weight))).toBeLessThanOrEqual(1);
    }
    expect(at(0, 0)).toBeLessThan(120);
  });

  it("positive vignette lightens the edges and a zero amount changes nothing", () => {
    const width = 32;
    const height = 32;
    const data = new Uint8ClampedArray(width * height * 4).fill(100);
    applyVignetteToData(data, width, height, { ...DEFAULT_VIGNETTE, amount: 0 });
    expect(data.every((v) => v === 100)).toBe(true);
    applyVignetteToData(data, width, height, { ...DEFAULT_VIGNETTE, amount: 0.8 });
    expect(data[0]).toBeGreaterThan(100);
    expect(data[(16 * width + 16) * 4]).toBe(100);
  });

  it("roundness -1 is rectangular and 1 is a circle", () => {
    const base = { amount: -1, midpoint: 0.5, feather: 0.5 };
    // Mid-edge of a wide frame: rectangular reaches the edge distance 1 there, a circle does not.
    const aspect = 2;
    const rect = vignetteWeight(0.6, 0, aspect, { ...base, roundness: -1 });
    const circle = vignetteWeight(0.6, 0, aspect, { ...base, roundness: 1 });
    expect(rect).toBeGreaterThan(circle);
  });
});
