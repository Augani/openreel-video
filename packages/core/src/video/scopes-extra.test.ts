import { describe, expect, it } from "vitest";
import {
  applyFalseColor,
  computeHlsVectorscope,
  computeYcWaveform,
  falseColorFor,
  hlsVectorscopePoint,
  nitsToSignal,
  rgbToHls,
  signalToNits,
} from "./scopes-extra";

function solid(r: number, g: number, b: number, w = 4, h = 2) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("YC waveform", () => {
  it("puts luma and chroma on separate levels", () => {
    const { luma, chroma } = computeYcWaveform(solid(255, 0, 0));
    const lumaLevel = Math.round(0.2126 * 255);
    expect(luma.bins[lumaLevel * 4]).toBe(2);
    // saturated red has high chroma, grey has none
    const grey = computeYcWaveform(solid(128, 128, 128));
    expect(grey.chroma.bins[0]).toBe(2);
    let top = 0;
    for (let l = 0; l < 256; l++) if (chroma.bins[l * 4] > 0) top = l;
    expect(top).toBeGreaterThan(100);
  });
});

describe("HLS vectorscope", () => {
  it("maps hue to angle and saturation to radius", () => {
    expect(rgbToHls(255, 0, 0).h).toBe(0);
    expect(rgbToHls(0, 255, 0).h).toBe(120);
    expect(rgbToHls(0, 0, 255).h).toBe(240);
    const red = hlsVectorscopePoint([255, 0, 0], 256);
    expect(red.x).toBeGreaterThan(200);
    expect(red.y).toBeCloseTo(128, 0);
    const grey = hlsVectorscopePoint([100, 100, 100], 256);
    expect(grey.x).toBeCloseTo(128, 0);
  });

  it("accumulates lightness per bin", () => {
    const v = computeHlsVectorscope(solid(255, 0, 0), 64);
    expect(v.max).toBe(8);
    const idx = v.bins.findIndex((n) => n > 0);
    expect(v.lightnessSum[idx] / v.bins[idx]).toBeCloseTo(0.5, 3);
  });
});

describe("nit scale", () => {
  it("PQ hits the reference points", () => {
    expect(signalToNits(0, "pq")).toBeCloseTo(0, 3);
    expect(signalToNits(1, "pq")).toBeCloseTo(10000, 0);
    // ~58% PQ signal is 203 nit reference white
    expect(signalToNits(0.58, "pq")).toBeGreaterThan(180);
    expect(signalToNits(0.58, "pq")).toBeLessThan(230);
  });

  it("HLG peaks at 1000 nits and round trips", () => {
    expect(signalToNits(1, "hlg")).toBeCloseTo(1000, 0);
    for (const n of [5, 203, 800]) {
      expect(signalToNits(nitsToSignal(n, "hlg"), "hlg")).toBeCloseTo(n, 1);
      expect(signalToNits(nitsToSignal(n, "pq"), "pq")).toBeCloseTo(n, 1);
    }
  });
});

describe("false colour", () => {
  it("bands crushed, skin and clipped levels and greys the rest", () => {
    expect(falseColorFor(0)).toEqual([120, 0, 170]);
    expect(falseColorFor(Math.round(0.57 * 255))).toEqual([240, 140, 170]);
    expect(falseColorFor(255)).toEqual([235, 30, 30]);
    expect(falseColorFor(Math.round(0.75 * 255))).toBeNull();
    const out = applyFalseColor(solid(191, 191, 191, 2, 1));
    expect(Array.from(out.slice(0, 4))).toEqual([191, 191, 191, 255]);
    const hot = applyFalseColor(solid(255, 255, 255, 1, 1));
    expect(Array.from(hot.slice(0, 3))).toEqual([235, 30, 30]);
  });
});
