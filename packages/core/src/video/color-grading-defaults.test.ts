import { describe, it, expect } from "vitest";
import {
  DEFAULT_COLOR_WHEELS,
  DEFAULT_CURVES,
  DEFAULT_HSL,
  type ColorWheelValues,
  type CurvesValues,
  type HSLValues,
  type LUTData,
} from "./color-grading-engine";
import {
  isNeutralColorWheels,
  isNeutralCurves,
  isNeutralLut,
  isNeutralHsl,
  isNeutralColorGrading,
  type NeutralColorGradingInput,
} from "./color-grading-defaults";

describe("isNeutralColorWheels", () => {
  it("treats undefined as neutral", () => {
    expect(isNeutralColorWheels(undefined)).toBe(true);
  });

  it("treats the seeded default as neutral", () => {
    expect(isNeutralColorWheels({ ...DEFAULT_COLOR_WHEELS })).toBe(true);
  });

  it("treats a deep-copied default as neutral", () => {
    const copy: ColorWheelValues = {
      shadows: { ...DEFAULT_COLOR_WHEELS.shadows },
      midtones: { ...DEFAULT_COLOR_WHEELS.midtones },
      highlights: { ...DEFAULT_COLOR_WHEELS.highlights },
      shadowsLift: 0,
      midtonesGamma: 1,
      highlightsGain: 1,
    };
    expect(isNeutralColorWheels(copy)).toBe(true);
  });

  it("is not neutral when a wheel channel is non-zero", () => {
    const value: ColorWheelValues = {
      ...DEFAULT_COLOR_WHEELS,
      shadows: { r: 0.1, g: 0, b: 0 },
    };
    expect(isNeutralColorWheels(value)).toBe(false);
  });

  it("is not neutral when gamma is non-default", () => {
    const value: ColorWheelValues = {
      ...DEFAULT_COLOR_WHEELS,
      midtonesGamma: 1.5,
    };
    expect(isNeutralColorWheels(value)).toBe(false);
  });

  it("is not neutral when gain is non-default", () => {
    const value: ColorWheelValues = {
      ...DEFAULT_COLOR_WHEELS,
      highlightsGain: 0.8,
    };
    expect(isNeutralColorWheels(value)).toBe(false);
  });

  it("is not neutral when lift is non-default", () => {
    const value: ColorWheelValues = {
      ...DEFAULT_COLOR_WHEELS,
      shadowsLift: 0.2,
    };
    expect(isNeutralColorWheels(value)).toBe(false);
  });
});

describe("isNeutralCurves", () => {
  it("treats undefined as neutral", () => {
    expect(isNeutralCurves(undefined)).toBe(true);
  });

  it("treats the identity default as neutral", () => {
    expect(isNeutralCurves({ ...DEFAULT_CURVES })).toBe(true);
  });

  it("is not neutral when a control point is added", () => {
    const value: CurvesValues = {
      ...DEFAULT_CURVES,
      rgb: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
    };
    expect(isNeutralCurves(value)).toBe(false);
  });

  it("is not neutral when an endpoint is moved", () => {
    const value: CurvesValues = {
      ...DEFAULT_CURVES,
      red: [
        { x: 0, y: 0.1 },
        { x: 1, y: 1 },
      ],
    };
    expect(isNeutralCurves(value)).toBe(false);
  });
});

describe("isNeutralLut", () => {
  it("treats undefined as neutral", () => {
    expect(isNeutralLut(undefined)).toBe(true);
  });

  it("treats zero intensity as neutral", () => {
    const value: LUTData = {
      data: new Uint8Array([255, 0, 0]),
      size: 1,
      intensity: 0,
    };
    expect(isNeutralLut(value)).toBe(true);
  });

  it("treats empty data as neutral", () => {
    const value: LUTData = {
      data: new Uint8Array(0),
      size: 0,
      intensity: 1,
    };
    expect(isNeutralLut(value)).toBe(true);
  });

  it("is not neutral with positive intensity and data", () => {
    const value: LUTData = {
      data: new Uint8Array([255, 0, 0, 0, 255, 0]),
      size: 2,
      intensity: 1,
    };
    expect(isNeutralLut(value)).toBe(false);
  });
});

describe("isNeutralHsl", () => {
  it("treats undefined as neutral", () => {
    expect(isNeutralHsl(undefined)).toBe(true);
  });

  it("treats the all-zero default as neutral", () => {
    expect(isNeutralHsl({ ...DEFAULT_HSL })).toBe(true);
  });

  it("is not neutral when a hue band is non-zero", () => {
    const value: HSLValues = {
      ...DEFAULT_HSL,
      hue: [0, 0, 10, 0, 0, 0, 0, 0],
    };
    expect(isNeutralHsl(value)).toBe(false);
  });

  it("is not neutral when a saturation band is non-zero", () => {
    const value: HSLValues = {
      ...DEFAULT_HSL,
      saturation: [0.2, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(isNeutralHsl(value)).toBe(false);
  });

  it("is not neutral when a luminance band is non-zero", () => {
    const value: HSLValues = {
      ...DEFAULT_HSL,
      luminance: [0, 0, 0, 0, 0, 0, 0, -0.3],
    };
    expect(isNeutralHsl(value)).toBe(false);
  });
});

describe("isNeutralColorGrading", () => {
  it("is neutral for empty settings", () => {
    expect(isNeutralColorGrading({})).toBe(true);
  });

  it("is neutral for reset/seeded-default settings", () => {
    const reset: NeutralColorGradingInput = {
      colorWheels: { ...DEFAULT_COLOR_WHEELS },
      curves: { ...DEFAULT_CURVES },
      hsl: { ...DEFAULT_HSL },
      temperature: 0,
      tint: 0,
    };
    expect(isNeutralColorGrading(reset)).toBe(true);
  });

  it("is not neutral when color wheels differ", () => {
    const settings: NeutralColorGradingInput = {
      colorWheels: { ...DEFAULT_COLOR_WHEELS, shadowsLift: 0.5 },
      curves: { ...DEFAULT_CURVES },
      hsl: { ...DEFAULT_HSL },
    };
    expect(isNeutralColorGrading(settings)).toBe(false);
  });

  it("is not neutral when curves differ", () => {
    const settings: NeutralColorGradingInput = {
      curves: {
        ...DEFAULT_CURVES,
        rgb: [
          { x: 0, y: 0 },
          { x: 0.3, y: 0.5 },
          { x: 1, y: 1 },
        ],
      },
    };
    expect(isNeutralColorGrading(settings)).toBe(false);
  });

  it("is not neutral when a LUT is active", () => {
    const settings: NeutralColorGradingInput = {
      lut: { data: new Uint8Array([1, 2, 3]), size: 1, intensity: 1 },
    };
    expect(isNeutralColorGrading(settings)).toBe(false);
  });

  it("is not neutral when HSL differs", () => {
    const settings: NeutralColorGradingInput = {
      hsl: { ...DEFAULT_HSL, hue: [5, 0, 0, 0, 0, 0, 0, 0] },
    };
    expect(isNeutralColorGrading(settings)).toBe(false);
  });

  it("is not neutral when temperature differs", () => {
    expect(isNeutralColorGrading({ temperature: 20 })).toBe(false);
  });

  it("is not neutral when tint differs", () => {
    expect(isNeutralColorGrading({ tint: -15 })).toBe(false);
  });
});
