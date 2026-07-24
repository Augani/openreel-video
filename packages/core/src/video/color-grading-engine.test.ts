import { describe, expect, it } from "vitest";
import {
  ColorGradingEngine,
  DEFAULT_CURVES,
  DEFAULT_HSL,
} from "./color-grading-engine";
import type {
  CurvesValues,
  HSLValues,
  LUTData,
} from "./color-grading-engine";

type EngineInternals = {
  applyCurvesToData(data: Uint8ClampedArray, curves: CurvesValues): void;
  applyLutToData(data: Uint8ClampedArray, lut: LUTData): void;
  applyHslToData(data: Uint8ClampedArray, hsl: HSLValues): void;
  buildCurveLUT(points: { x: number; y: number }[]): Uint8Array;
};

const internals = (): EngineInternals =>
  new ColorGradingEngine(8, 8) as unknown as EngineInternals;

const pixel = (r: number, g: number, b: number, a = 255): Uint8ClampedArray =>
  new Uint8ClampedArray([r, g, b, a]);

const identityLut = (size: number, intensity: number): LUTData => {
  const data = new Uint8Array(size * size * size * 3);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const idx = (b * size * size + g * size + r) * 3;
        const denom = size - 1;
        data[idx] = Math.round((r / denom) * 255);
        data[idx + 1] = Math.round((g / denom) * 255);
        data[idx + 2] = Math.round((b / denom) * 255);
      }
    }
  }
  return { data, size, intensity };
};

describe("ColorGradingEngine CPU transforms", () => {
  it("buildCurveLUT produces an identity ramp for default curve points", () => {
    const engine = internals();
    const lut = engine.buildCurveLUT(DEFAULT_CURVES.rgb);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it("applyCurvesToData with identity curves leaves opaque pixels unchanged", () => {
    const engine = internals();
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 64, 128, 200, 255, 255, 255, 255, 255,
    ]);
    const before = Array.from(data);
    engine.applyCurvesToData(data, DEFAULT_CURVES);
    expect(Array.from(data)).toEqual(before);
  });

  it("applyCurvesToData maps a known pixel through a non-trivial master curve", () => {
    const engine = internals();
    const invertMaster: CurvesValues = {
      rgb: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      red: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      green: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      blue: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    const data = pixel(0, 128, 255);

    const masterLut = engine.buildCurveLUT(invertMaster.rgb);
    const expected = [masterLut[0], masterLut[128], masterLut[255], 255];

    engine.applyCurvesToData(data, invertMaster);
    expect(Array.from(data)).toEqual(expected);
  });

  it("applyCurvesToData composes channel then master curve like the engine body", () => {
    const engine = internals();
    const curves: CurvesValues = {
      rgb: [
        { x: 0, y: 0.1 },
        { x: 1, y: 0.9 },
      ],
      red: [
        { x: 0, y: 0.2 },
        { x: 1, y: 0.8 },
      ],
      green: DEFAULT_CURVES.green,
      blue: DEFAULT_CURVES.blue,
    };
    const rgbLut = engine.buildCurveLUT(curves.rgb);
    const redLut = engine.buildCurveLUT(curves.red);
    const greenLut = engine.buildCurveLUT(curves.green);
    const blueLut = engine.buildCurveLUT(curves.blue);

    const data = pixel(40, 90, 210);
    const expected = [
      rgbLut[redLut[40]],
      rgbLut[greenLut[90]],
      rgbLut[blueLut[210]],
      255,
    ];

    engine.applyCurvesToData(data, curves);
    expect(Array.from(data)).toEqual(expected);
  });

  it("applyHslToData with neutral params leaves opaque pixels unchanged", () => {
    const engine = internals();
    const data = new Uint8ClampedArray([
      10, 20, 30, 255, 200, 100, 50, 255, 255, 0, 0, 255,
    ]);
    const before = Array.from(data);
    engine.applyHslToData(data, DEFAULT_HSL);
    expect(Array.from(data)).toEqual(before);
  });

  it("applyHslToData shifts luminance for the matching hue band", () => {
    const engine = internals();
    const hsl: HSLValues = {
      hue: [0, 0, 0, 0, 0, 0, 0, 0],
      saturation: [0, 0, 0, 0, 0, 0, 0, 0],
      luminance: [0.25, 0, 0, 0, 0, 0, 0, 0],
    };
    const data = pixel(200, 40, 40);
    const before = Array.from(data);
    engine.applyHslToData(data, hsl);
    expect(Array.from(data)).not.toEqual(before);
    expect(data[3]).toBe(255);
  });

  it("applyLutToData with an identity LUT at full intensity is near a no-op", () => {
    const engine = internals();
    const lut = identityLut(17, 1);
    const data = pixel(64, 128, 192);
    engine.applyLutToData(data, lut);
    expect(data[0]).toBeGreaterThanOrEqual(63);
    expect(data[0]).toBeLessThanOrEqual(65);
    expect(data[1]).toBeGreaterThanOrEqual(127);
    expect(data[1]).toBeLessThanOrEqual(129);
    expect(data[2]).toBeGreaterThanOrEqual(191);
    expect(data[2]).toBeLessThanOrEqual(193);
    expect(data[3]).toBe(255);
  });

  it("applyLutToData at zero intensity preserves the original pixel", () => {
    const engine = internals();
    const lut = identityLut(8, 0);
    const data = pixel(33, 77, 211);
    engine.applyLutToData(data, lut);
    expect(Array.from(data)).toEqual([33, 77, 211, 255]);
  });
});
