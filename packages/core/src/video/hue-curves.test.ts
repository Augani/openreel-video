import { describe, expect, it } from "vitest";
import {
  DEFAULT_HUE_CURVES,
  HUE_CURVES_GLSL,
  HUE_CURVE_KINDS,
  HUE_CURVE_LUT_SIZE,
  applyHueCurvesToRgb,
  buildHueCurveLut,
  buildHueCurveLuts,
  createDefaultHueCurves,
  isNeutralHueCurves,
  normalizeHueCurvePoints,
  packHueCurveLuts,
  rgbToHsl,
  sampleHueCurveLut,
  type HueCurvesValues,
} from "./hue-curves";

const curves = (overrides: Partial<HueCurvesValues>): HueCurvesValues => ({
  ...createDefaultHueCurves(),
  ...overrides,
});

const grade = (rgb: [number, number, number], values: HueCurvesValues): [number, number, number] =>
  applyHueCurvesToRgb(rgb[0], rgb[1], rgb[2], buildHueCurveLuts(values));

describe("buildHueCurveLut", () => {
  it("bakes a flat 0.5 line to a neutral LUT", () => {
    for (const periodic of [true, false]) {
      const lut = buildHueCurveLut(DEFAULT_HUE_CURVES.hueVsSat, periodic);
      expect(lut).toHaveLength(HUE_CURVE_LUT_SIZE);
      expect(Array.from(lut).every((v) => v === 0.5)).toBe(true);
    }
  });

  it("passes through its control points on the luma axis", () => {
    const lut = buildHueCurveLut(
      [
        { x: 0, y: 0.2 },
        { x: 0.5, y: 0.9 },
        { x: 1, y: 0.4 },
      ],
      false,
    );
    expect(lut[0]).toBeCloseTo(0.2, 5);
    expect(sampleHueCurveLut(lut, 0.5, false)).toBeCloseTo(0.9, 2);
    expect(lut[255]).toBeCloseTo(0.4, 5);
  });

  it("never overshoots the control values (monotone interpolation)", () => {
    const lut = buildHueCurveLut(
      [
        { x: 0, y: 0.5 },
        { x: 0.3, y: 1 },
        { x: 0.35, y: 0.1 },
        { x: 1, y: 0.5 },
      ],
      false,
    );
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("wraps hue curves so a bump near 1.0 also lifts hues just past 0", () => {
    const lut = buildHueCurveLut(
      [
        { x: 0, y: 0.5 },
        { x: 0.95, y: 1 },
        { x: 0.98, y: 0.5 },
      ],
      true,
    );
    // Continuity across the seam: the last and first entries are neighbours.
    expect(Math.abs(lut[255] - lut[0])).toBeLessThan(0.15);
    expect(sampleHueCurveLut(lut, 0.95, true)).toBeCloseTo(1, 1);
    expect(sampleHueCurveLut(lut, 1.95, true)).toBeCloseTo(sampleHueCurveLut(lut, 0.95, true), 6);
    expect(sampleHueCurveLut(lut, -0.05, true)).toBeCloseTo(sampleHueCurveLut(lut, 0.95, true), 6);
  });

  it("sorts, clamps and drops invalid points", () => {
    const points = normalizeHueCurvePoints([
      { x: 1.4, y: -1 },
      { x: Number.NaN, y: 0.5 },
      { x: 0.2, y: 0.7 },
    ]);
    expect(points).toEqual([
      { x: 0.2, y: 0.7 },
      { x: 1, y: 0 },
    ]);
  });
});

describe("hue curve neutrality", () => {
  it("treats absent, empty and flat 0.5 curves as neutral", () => {
    expect(isNeutralHueCurves(undefined)).toBe(true);
    expect(isNeutralHueCurves(DEFAULT_HUE_CURVES)).toBe(true);
    expect(isNeutralHueCurves(curves({ hueVsSat: [] }))).toBe(true);
    expect(
      isNeutralHueCurves(
        curves({
          hueVsSat: [
            { x: 0, y: 0.5 },
            { x: 0.4, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      isNeutralHueCurves(
        curves({
          lumaVsSat: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.6 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("leaves every colour untouched when all curves are flat", () => {
    const luts = buildHueCurveLuts(DEFAULT_HUE_CURVES);
    for (let i = 0; i < 200; i++) {
      const r = (i * 37 % 256) / 255;
      const g = (i * 91 % 256) / 255;
      const b = (i * 53 % 256) / 255;
      const out = applyHueCurvesToRgb(r, g, b, luts);
      expect(out[0]).toBeCloseTo(r, 5);
      expect(out[1]).toBeCloseTo(g, 5);
      expect(out[2]).toBeCloseTo(b, 5);
    }
  });
});

describe("applyHueCurvesToRgb", () => {
  const redOnly = [
    { x: 0, y: 0 },
    { x: 0.1, y: 0.5 },
    { x: 0.9, y: 0.5 },
    { x: 1, y: 0 },
  ];

  it("Hue vs Sat desaturates the keyed hue and leaves others alone", () => {
    const values = curves({ hueVsSat: redOnly });
    const red = grade([0.9, 0.1, 0.1], values);
    const green = grade([0.1, 0.9, 0.1], values);
    expect(rgbToHsl(...red)[1]).toBeLessThan(0.05);
    expect(green[0]).toBeCloseTo(0.1, 2);
    expect(green[1]).toBeCloseTo(0.9, 2);
    expect(green[2]).toBeCloseTo(0.1, 2);
  });

  it("Hue vs Sat boosts saturation to double at y = 1", () => {
    const values = curves({
      hueVsSat: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    });
    const base: [number, number, number] = [0.6, 0.4, 0.4];
    const out = grade(base, values);
    const [, s0] = rgbToHsl(...base);
    const [, s1] = rgbToHsl(...out);
    expect(s1).toBeCloseTo(Math.min(1, s0 * 2), 2);
  });

  it("Hue vs Hue rotates hue by up to 90 degrees", () => {
    const values = curves({
      hueVsHue: [
        { x: 0, y: 0.75 },
        { x: 1, y: 0.75 },
      ],
    });
    const out = grade([1, 0, 0], values);
    const [h, s, l] = rgbToHsl(...out);
    expect(h).toBeCloseTo(0.125, 3);
    expect(s).toBeCloseTo(1, 3);
    expect(l).toBeCloseTo(0.5, 3);
    const down = grade([1, 0, 0], curves({ hueVsHue: [{ x: 0, y: 0.25 }, { x: 1, y: 0.25 }] }));
    expect(rgbToHsl(...down)[0]).toBeCloseTo(1 - 0.125, 3);
  });

  it("Hue vs Luma lightens a saturated colour", () => {
    const values = curves({
      hueVsLuma: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    });
    const base: [number, number, number] = [0.8, 0.2, 0.2];
    const out = grade(base, values);
    expect(rgbToHsl(...out)[2]).toBeCloseTo(rgbToHsl(...base)[2] + 0.25, 3);
  });

  it("Luma vs Sat acts on brightness, not hue", () => {
    const values = curves({
      lumaVsSat: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    });
    const dark = grade([0.2, 0.05, 0.05], values);
    const bright = grade([0.9, 0.6, 0.6], values);
    expect(rgbToHsl(...dark)[1]).toBeLessThan(rgbToHsl(0.2, 0.05, 0.05)[1]);
    const [, sBright] = rgbToHsl(0.9, 0.6, 0.6);
    expect(rgbToHsl(...bright)[1]).toBeCloseTo(sBright, 2);
  });

  it("never touches neutral greys with hue-keyed curves", () => {
    const values = curves({
      hueVsHue: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
      hueVsLuma: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
      hueVsSat: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
    });
    const out = grade([0.4, 0.4, 0.4], values);
    expect(out).toEqual([0.4, 0.4, 0.4]);
  });

  it("clamps out-of-range input instead of producing NaN", () => {
    const values = curves({ hueVsSat: redOnly });
    const out = grade([1.4, -0.2, 0.3], values);
    for (const c of out) expect(Number.isFinite(c)).toBe(true);
  });
});

describe("GPU packing", () => {
  it("interleaves the four LUTs as RGBA texels", () => {
    const luts = buildHueCurveLuts(
      curves({
        hueVsSat: [{ x: 0, y: 0.1 }, { x: 1, y: 0.1 }],
        hueVsHue: [{ x: 0, y: 0.2 }, { x: 1, y: 0.2 }],
        hueVsLuma: [{ x: 0, y: 0.3 }, { x: 1, y: 0.3 }],
        lumaVsSat: [{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }],
      }),
    );
    const packed = packHueCurveLuts(luts);
    expect(packed).toHaveLength(HUE_CURVE_LUT_SIZE * 4);
    expect(packed[0]).toBeCloseTo(0.1, 6);
    expect(packed[1]).toBeCloseTo(0.2, 6);
    expect(packed[2]).toBeCloseTo(0.3, 6);
    expect(packed[3]).toBeCloseTo(0.4, 6);
    expect(packed[(HUE_CURVE_LUT_SIZE - 1) * 4 + 3]).toBeCloseTo(0.4, 6);
  });

  it("ships a GLSL port that uses the same constants and exposes applyHueCurves", () => {
    expect(HUE_CURVES_GLSL).toContain("vec3 applyHueCurves(vec3 rgb)");
    expect(HUE_CURVES_GLSL).toContain("smoothstep(0.0, 0.08, hsl.y)");
    expect(HUE_CURVES_GLSL).toContain("* 0.50 * weight");
    for (const kind of HUE_CURVE_KINDS) expect(typeof kind).toBe("string");
  });
});
