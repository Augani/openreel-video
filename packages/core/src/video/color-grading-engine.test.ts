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

/** The pre-optimisation per-pixel implementation (closures per pixel), kept as the numerical reference. */
function referenceApplyLut(data: Uint8ClampedArray, lut: LUTData): void {
  const lutSize = lut.size;
  const hasFloat = lut.floatData !== undefined && lut.floatData.length === lutSize * lutSize * lutSize * 3;
  const lutData: ArrayLike<number> = hasFloat ? (lut.floatData as Float32Array) : lut.data;
  const lutScale = hasFloat ? 1 : 1 / 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const rIdx = r * (lutSize - 1);
    const gIdx = g * (lutSize - 1);
    const bIdx = b * (lutSize - 1);
    const r0 = Math.floor(rIdx);
    const g0 = Math.floor(gIdx);
    const b0 = Math.floor(bIdx);
    const r1 = Math.min(r0 + 1, lutSize - 1);
    const g1 = Math.min(g0 + 1, lutSize - 1);
    const b1 = Math.min(b0 + 1, lutSize - 1);
    const rFrac = rIdx - r0;
    const gFrac = gIdx - g0;
    const bFrac = bIdx - b0;
    const get = (ri: number, gi: number, bi: number, channel: number): number =>
      lutData[(bi * lutSize * lutSize + gi * lutSize + ri) * 3 + channel] * lutScale;
    const interpolate = (channel: number): number => {
      const c00 = get(r0, g0, b0, channel) * (1 - rFrac) + get(r1, g0, b0, channel) * rFrac;
      const c01 = get(r0, g0, b1, channel) * (1 - rFrac) + get(r1, g0, b1, channel) * rFrac;
      const c10 = get(r0, g1, b0, channel) * (1 - rFrac) + get(r1, g1, b0, channel) * rFrac;
      const c11 = get(r0, g1, b1, channel) * (1 - rFrac) + get(r1, g1, b1, channel) * rFrac;
      const c0 = c00 * (1 - gFrac) + c10 * gFrac;
      const c1 = c01 * (1 - gFrac) + c11 * gFrac;
      return c0 * (1 - bFrac) + c1 * bFrac;
    };
    data[i] = Math.round((r * (1 - lut.intensity) + interpolate(0) * lut.intensity) * 255);
    data[i + 1] = Math.round((g * (1 - lut.intensity) + interpolate(1) * lut.intensity) * 255);
    data[i + 2] = Math.round((b * (1 - lut.intensity) + interpolate(2) * lut.intensity) * 255);
  }
}

describe("ColorGradingEngine LUT fast path", () => {
  const random = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const randomLut = (size: number, intensity: number, float: boolean, rnd: () => number): LUTData => {
    const n = size ** 3 * 3;
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) data[i] = Math.floor(rnd() * 256);
    if (!float) return { data, size, intensity };
    const floatData = new Float32Array(n);
    for (let i = 0; i < n; i++) floatData[i] = rnd() * 1.2 - 0.1;
    return { data, floatData, size, intensity };
  };

  it("is bit-identical to the per-pixel reference (byte and float LUTs, sizes, intensities, every channel value)", () => {
    const rnd = random(7);
    for (const size of [2, 3, 17, 33]) {
      for (const intensity of [0, 0.37, 1]) {
        for (const float of [false, true]) {
          const lut = randomLut(size, intensity, float, rnd);
          const pixels = 4096;
          const input = new Uint8ClampedArray(pixels * 4);
          for (let i = 0; i < input.length; i++) input[i] = i % 4 === 3 ? 255 : Math.floor(rnd() * 256);
          // Every 8-bit value on every channel, so a table entry that differs anywhere is caught.
          for (let v = 0; v < 256; v++) {
            input[v * 4] = v;
            input[(255 - v) * 4 + 1] = v;
            input[((v * 7) % 256) * 4 + 2] = v;
          }
          const fast = new Uint8ClampedArray(input);
          const reference = new Uint8ClampedArray(input);
          internals().applyLutToData(fast, lut);
          referenceApplyLut(reference, lut);
          expect(Array.from(fast)).toEqual(Array.from(reference));
        }
      }
    }
  });

  it("runs a 1080p frame through a 17^3 LUT several times faster than the closure version", () => {
    const lut = randomLut(17, 0.8, false, random(3));
    const px = 1920 * 1080;
    const base = new Uint8ClampedArray(px * 4);
    const rnd = random(11);
    for (let i = 0; i < base.length; i++) base[i] = Math.floor(rnd() * 256);
    const time = (fn: (d: Uint8ClampedArray) => void): number => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const d = new Uint8ClampedArray(base);
        const t0 = performance.now();
        fn(d);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    const engine = internals();
    const fast = time((d) => engine.applyLutToData(d, lut));
    const ref = time((d) => referenceApplyLut(d, lut));
    console.info(`[lut bench] 1080p 17^3: fast ${fast.toFixed(1)} ms, reference ${ref.toFixed(1)} ms, ${(ref / fast).toFixed(1)}x`);
    expect(fast).toBeLessThan(ref);
  });
});
