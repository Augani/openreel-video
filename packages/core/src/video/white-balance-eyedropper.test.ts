import { describe, expect, it } from "vitest";
import {
  applyWhiteBalance,
  isFarFromNeutral,
  isUsableWhiteBalanceSample,
  needsWhiteBalanceInputFrame,
  whiteBalanceInputGrading,
  solveNeutralWhiteBalance,
  whiteBalanceOffset,
  whiteBalanceSampleRadius,
} from "./white-balance-eyedropper";
import { prepareHdrGrade } from "../color/hdr-working";
import { sampleAverageRgb } from "./hsl-secondary";
import { isNeutralColorGrading } from "./color-grading-defaults";

const spread = (rgb: readonly number[]) => Math.max(...rgb) - Math.min(...rgb);

describe("white balance eyedropper maths", () => {
  it("uses the same offsets as the HDR grade", () => {
    for (const [temperature, tint] of [[40, 10], [-30, 25], [0, -50], [100, 100], [-100, -100]]) {
      const hdr = prepareHdrGrade({ temperature, tint })?.whiteBalance;
      const mine = whiteBalanceOffset(temperature, tint);
      expect(hdr).toBeTruthy();
      mine.forEach((v, i) => expect(v).toBeCloseTo((hdr as unknown as number[])[i], 10));
    }
  });

  it("is a no-op at zero", () => {
    expect(whiteBalanceOffset(0, 0)).toEqual([0, 0, 0]);
  });

  it("neutralises a warm cast", () => {
    const sample: [number, number, number] = [0.62, 0.5, 0.38];
    const out = solveNeutralWhiteBalance(sample)!;
    expect(out.temperature).toBeLessThan(0);
    expect(spread(applyWhiteBalance(sample, out.temperature, out.tint))).toBeLessThan(1 / 255);
    expect(out.clamped).toBe(false);
  });

  it("neutralises a cool / green cast", () => {
    const sample: [number, number, number] = [0.4, 0.55, 0.6];
    const out = solveNeutralWhiteBalance(sample)!;
    expect(out.temperature).toBeGreaterThan(0);
    expect(spread(applyWhiteBalance(sample, out.temperature, out.tint))).toBeLessThan(1 / 255);
  });

  it("recovers the inverse of any slider pair that fits the range", () => {
    for (const temperature of [-80, -35, -1, 0, 1, 22, 60, 90]) {
      for (const tint of [-70, -10, 0, 15, 55]) {
        const grey = 0.5;
        const cast = applyWhiteBalance([grey, grey, grey], temperature, tint);
        const out = solveNeutralWhiteBalance(cast)!;
        // Recovering the cast means the sliders cancel it: the neutral colour comes back.
        expect(spread(out.neutral)).toBeLessThan(1 / 255);
        const back = applyWhiteBalance(cast, out.temperature, out.tint);
        expect(spread(back)).toBeLessThan(1 / 255);
      }
    }
  });

  it("does not compound when the clip already has a white balance", () => {
    const source: [number, number, number] = [0.55, 0.48, 0.4];
    const first = solveNeutralWhiteBalance(source)!;
    const shown = applyWhiteBalance(source, first.temperature, first.tint);
    const second = solveNeutralWhiteBalance(shown, first)!;
    expect(second.temperature).toBeCloseTo(first.temperature, 0);
    expect(second.tint).toBeCloseTo(first.tint, 0);
  });

  it("picking an already neutral grey keeps the sliders at zero", () => {
    const out = solveNeutralWhiteBalance([0.5, 0.5, 0.5])!;
    expect(out.temperature).toBe(0);
    expect(out.tint).toBe(0);
  });

  it("clamps impossible casts to the slider range and says so", () => {
    const out = solveNeutralWhiteBalance([0.95, 0.5, 0.05 + 0.01])!;
    expect(out.clamped).toBe(true);
    expect(Math.abs(out.temperature)).toBeLessThanOrEqual(100);
    expect(Math.abs(out.tint)).toBeLessThanOrEqual(100);
  });

  it("rejects black, white and rail-pinned samples", () => {
    expect(solveNeutralWhiteBalance([0, 0, 0])).toBeNull();
    expect(solveNeutralWhiteBalance([1, 1, 1])).toBeNull();
    expect(solveNeutralWhiteBalance([1, 0.5, 0.4])).toBeNull();
    expect(solveNeutralWhiteBalance([Number.NaN, 0.5, 0.4])).toBeNull();
    expect(isUsableWhiteBalanceSample([0.2, 0.3, 0.4])).toBe(true);
  });

  it("survives 8-bit quantisation of the sample", () => {
    const bytes: [number, number, number] = [158, 128, 97];
    const sample = bytes.map((v) => v / 255) as [number, number, number];
    const out = solveNeutralWhiteBalance(sample)!;
    const result = applyWhiteBalance(sample, out.temperature, out.tint).map((v) => v * 255);
    expect(spread(result)).toBeLessThan(0.6);
  });

  it("averages a 5x5 footprint and a single pixel differently", () => {
    const width = 8;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let i = 0; i < width * width; i++) {
      data[i * 4] = 100;
      data[i * 4 + 1] = 100;
      data[i * 4 + 2] = 100;
    }
    const centre = (4 * width + 4) * 4;
    data[centre] = 200;
    expect(whiteBalanceSampleRadius(1)).toBe(0);
    expect(whiteBalanceSampleRadius(5)).toBe(2);
    expect(sampleAverageRgb(data, width, width, 4, 4, whiteBalanceSampleRadius(1))[0] * 255).toBeCloseTo(200);
    expect(sampleAverageRgb(data, width, width, 4, 4, whiteBalanceSampleRadius(5))[0] * 255).toBeCloseTo(104);
  });
});

describe("white balance stage input", () => {
  const tone = { contrast: 60 } as never;

  it("keeps only the input LUT on a version 2 clip (white balance runs first)", () => {
    const lut = { name: "log", size: 2, data: new Float32Array(24) } as never;
    const input = whiteBalanceInputGrading({ pipelineVersion: 2, temperature: 30, tint: 5, tone, inputLut: lut });
    expect(input).toEqual({ pipelineVersion: 2, inputLut: lut });
  });

  it("only removes white balance on a version 1 clip (white balance runs last)", () => {
    const input = whiteBalanceInputGrading({ temperature: 30, tint: 5, tone });
    expect(input).toEqual({ temperature: 0, tint: 0, tone });
  });

  it("asks for the input frame only when the displayed pixel differs from it", () => {
    const need = (g: Parameters<typeof isNeutralColorGrading>[0] & { pipelineVersion?: number }) =>
      needsWhiteBalanceInputFrame(g, isNeutralColorGrading);
    expect(need({ pipelineVersion: 2 })).toBe(false);
    expect(need({ pipelineVersion: 2, tone: { contrast: 60 } as never })).toBe(true);
    expect(need({ pipelineVersion: 2, temperature: 10 })).toBe(true);
    expect(need({ tone: { contrast: 60 } as never })).toBe(false);
    expect(need({ temperature: 10 })).toBe(true);
  });

  it("rejects strongly coloured samples", () => {
    expect(isFarFromNeutral([31 / 255, 22 / 255, 14 / 255])).toBe(true);
    expect(isFarFromNeutral([0.55, 0.5, 0.45])).toBe(false);
  });
});
