import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOR_WHEELS,
  DEFAULT_TONE,
  DEFAULT_VIGNETTE,
  isNeutralColorGrading,
} from "./color-grading-defaults";
import { createDefaultHueCurves } from "./hue-curves";
import {
  applyColorWheelsToRgb,
  applyFusedGradeToData,
  applyFusedGradeToRgb,
  planColorGrading,
  prepareFusedGrade,
  resolveColorPipelineVersion,
} from "./lumetri-pipeline";
import { buildToneCurve, sampleToneCurve } from "./tone-curve";
import type { ColorWheelValues, ToneValues } from "./color-grading-engine";

const tone = (overrides: Partial<ToneValues>): ToneValues => ({ ...DEFAULT_TONE, ...overrides });
const wheels = (overrides: Partial<ColorWheelValues>): ColorWheelValues => ({
  ...DEFAULT_COLOR_WHEELS,
  ...overrides,
});

describe("resolveColorPipelineVersion / migration", () => {
  it("treats a grade with no version as the classic pipeline", () => {
    expect(resolveColorPipelineVersion(undefined)).toBe(1);
    expect(resolveColorPipelineVersion({})).toBe(1);
    expect(resolveColorPipelineVersion({ pipelineVersion: 1 })).toBe(1);
    expect(resolveColorPipelineVersion({ pipelineVersion: 2 })).toBe(2);
  });

  it("keeps the classic order for existing grades: wheels first, then tone/vignette/curves/lut/hsl, white balance last", () => {
    const plan = planColorGrading({
      colorWheels: wheels({ shadowsLift: 0.1 }),
      tone: tone({ exposure: 0.3 }),
      vignette: { ...DEFAULT_VIGNETTE, amount: -0.4 },
      temperature: 10,
    });
    expect(plan.version).toBe(1);
    expect(plan.legacyWheels).not.toBeNull();
    expect(plan.fused).toBeNull();
    expect(plan.whiteBalanceFirst).toBe(false);
    expect(plan.cpu?.tone).toEqual(tone({ exposure: 0.3 }));
    expect(plan.cpu?.vignette?.amount).toBe(-0.4);
    expect(plan.cpu?.vignetteLast).toBeUndefined();
  });

  it("ignores hue curves on the classic pipeline so old projects cannot change", () => {
    const hueCurves = createDefaultHueCurves();
    hueCurves.hueVsSat = [{ x: 0, y: 1 }, { x: 1, y: 1 }];
    const plan = planColorGrading({ hueCurves });
    expect(plan.fused).toBeNull();
    expect(plan.cpu).toBeNull();
    expect(isNeutralColorGrading({ hueCurves })).toBe(true);
    expect(isNeutralColorGrading({ hueCurves, pipelineVersion: 2 })).toBe(false);
  });
});

describe("planColorGrading (Premiere order)", () => {
  it("runs white balance and Basic Correction before wheels and hue curves, in one float pass", () => {
    const hueCurves = createDefaultHueCurves();
    hueCurves.hueVsHue = [{ x: 0, y: 0.7 }, { x: 1, y: 0.7 }];
    const plan = planColorGrading({
      pipelineVersion: 2,
      colorWheels: wheels({ shadowsLift: 0.1 }),
      tone: tone({ contrast: 0.2 }),
      hueCurves,
      vignette: { ...DEFAULT_VIGNETTE, amount: 0.3 },
      temperature: -20,
    });
    expect(plan.version).toBe(2);
    expect(plan.whiteBalanceFirst).toBe(true);
    expect(plan.legacyWheels).toBeNull();
    expect(plan.fused?.tone?.contrast).toBe(0.2);
    expect(plan.fused?.wheels?.shadowsLift).toBe(0.1);
    expect(plan.fused?.hueCurves).toBe(hueCurves);
    expect(plan.cpu?.tone).toBeUndefined();
    expect(plan.cpu?.vignetteLast).toBe(true);
  });

  it("returns no stages for a neutral grade", () => {
    const plan = planColorGrading({ pipelineVersion: 2, tone: DEFAULT_TONE, colorWheels: DEFAULT_COLOR_WHEELS });
    expect(plan.fused).toBeNull();
    expect(plan.cpu).toBeNull();
  });
});

describe("float fused pass", () => {
  it("is the identity for neutral stages", () => {
    const data = prepareFusedGrade({ tone: DEFAULT_TONE, wheels: DEFAULT_COLOR_WHEELS });
    expect(data.toneCurve).toBeUndefined();
    expect(data.wheels).toBeUndefined();
    expect(applyColorWheelsToRgb(0.3, 0.5, 0.7, DEFAULT_COLOR_WHEELS)).toEqual([0.3, 0.5, 0.7].map((v) => expect.closeTo(v, 6)));
  });

  it("applies Basic Correction before the wheels (order matters)", () => {
    const t = tone({ exposure: 0.4 });
    const w = wheels({ midtones: { r: 0.1, g: 0, b: -0.05 }, shadowsLift: 0.05 });
    const prepared = prepareFusedGrade({ tone: t, wheels: w });
    const curve = buildToneCurve(t);
    const input: [number, number, number] = [0.25, 0.4, 0.55];

    const expected = applyColorWheelsToRgb(
      sampleToneCurve(curve, input[0]),
      sampleToneCurve(curve, input[1]),
      sampleToneCurve(curve, input[2]),
      w,
    );
    const actual = applyFusedGradeToRgb(...input, prepared);
    for (let c = 0; c < 3; c++) expect(actual[c]).toBeCloseTo(expected[c], 10);

    const reversed = applyColorWheelsToRgb(...input, w).map((v) => sampleToneCurve(curve, v));
    expect(Math.abs(actual[0] - reversed[0]) + Math.abs(actual[1] - reversed[1])).toBeGreaterThan(0.005);
  });

  it("rounds once at the end instead of quantising between stages", () => {
    const t = tone({ exposure: 0.3, shadows: 0.4 });
    const w = wheels({ midtonesGamma: 1.3 });
    const data = new Uint8ClampedArray([37, 120, 201, 255, 10, 10, 10, 128]);
    applyFusedGradeToData(data, { tone: t, wheels: w });

    const prepared = prepareFusedGrade({ tone: t, wheels: w });
    const [r, g, b] = applyFusedGradeToRgb(37 / 255, 120 / 255, 201 / 255, prepared);
    expect([data[0], data[1], data[2]]).toEqual([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]);
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(128);
  });

  it("does not collapse dark gradients to the same 8-bit step before the wheels run", () => {
    // Tone crushes 3 neighbouring input levels into one 8-bit level; the float pass
    // keeps the sub-level differences so the wheels lift can separate them again.
    const t = tone({ contrast: -0.9 });
    const w = wheels({ midtonesGamma: 2.4 });
    const prepared = prepareFusedGrade({ tone: t, wheels: w });
    const outputs = [100, 101, 102].map((v) => applyFusedGradeToRgb(v / 255, v / 255, v / 255, prepared)[0]);
    expect(outputs[1]).toBeGreaterThan(outputs[0]);
    expect(outputs[2]).toBeGreaterThan(outputs[1]);
  });

  it("clamps negative wheel offsets before the gamma instead of producing NaN", () => {
    const out = applyColorWheelsToRgb(0.05, 0.05, 0.05, wheels({ shadows: { r: -0.5, g: -0.5, b: -0.5 }, midtonesGamma: 1.5 }));
    for (const c of out) expect(Number.isFinite(c)).toBe(true);
    expect(out).toEqual([0, 0, 0]);
  });
});
