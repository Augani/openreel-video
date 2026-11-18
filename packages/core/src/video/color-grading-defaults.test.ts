import { describe, it, expect } from "vitest";
import {
  DEFAULT_COLOR_WHEELS,
  DEFAULT_CURVES,
  DEFAULT_HSL,
  type ColorWheelValues,
  type CurvesValues,
} from "./color-grading-engine";
import {
  isNeutralColorWheels,
  isNeutralCurves,
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

  it("is not neutral when temperature differs", () => {
    expect(isNeutralColorGrading({ temperature: 20 })).toBe(false);
  });

  it("is not neutral when tint differs", () => {
    expect(isNeutralColorGrading({ tint: -15 })).toBe(false);
  });
});
