import { describe, expect, it } from "vitest";
import {
  ColorGradingEngine,
  DEFAULT_CURVES,
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

describe("ColorGradingEngine LUT precision", () => {
  it("samples floatData instead of the 8-bit table when present", () => {
    // 2^3 LUT whose float outputs differ from the (deliberately wrong) bytes.
    const size = 2;
    const floatData = new Float32Array(size ** 3 * 3).fill(0.5);
    const data = new Uint8Array(size ** 3 * 3).fill(255);
    const withFloat = pixel(10, 10, 10);
    internals().applyLutToData(withFloat, { data, floatData, size, intensity: 1 });
    expect(withFloat[0]).toBe(128);
    const bytesOnly = pixel(10, 10, 10);
    internals().applyLutToData(bytesOnly, { data, size, intensity: 1 });
    expect(bytesOnly[0]).toBe(255);
  });

  it("applies an exact 1D curve with a non-default domain", () => {
    const data = Float32Array.from([0, 0, 0, 1, 1, 1, 0, 0, 0]); // peak at middle
    const px = pixel(128, 0, 255);
    internals().applyLutToData(px, {
      data: new Uint8Array(24),
      size: 2,
      intensity: 1,
      curve1d: { size: 3, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data },
    });
    expect(px[0]).toBeGreaterThan(250);
    expect(px[1]).toBe(0);
    expect(px[2]).toBe(0);
  });
});

describe("ColorGradingEngine CPU transforms", () => {
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

});
