import { describe, it, expect } from "vitest";
import {
  computeLumaWaveform,
  computeRgbParade,
  computeVectorscope,
  computeRgbHistogram,
  downsampleForScopes,
  vectorscopePoint,
  VECTORSCOPE_TARGETS,
  type ScopeImageLike,
} from "./scopes";

function solid(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): ScopeImageLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("scopes", () => {
  it("luma waveform puts white at level 255 for every column", () => {
    const wf = computeLumaWaveform(solid(4, 3, 255, 255, 255));
    for (let x = 0; x < 4; x++) expect(wf.bins[255 * 4 + x]).toBe(3);
    expect(wf.max).toBe(3);
  });

  it("luma waveform puts black at level 0", () => {
    const wf = computeLumaWaveform(solid(2, 2, 0, 0, 0));
    expect(wf.bins[0]).toBe(2);
    expect(wf.bins[255 * 2]).toBe(0);
  });

  it("parade separates channels", () => {
    const p = computeRgbParade(solid(2, 2, 255, 128, 0));
    expect(p.red.bins[255 * 2]).toBe(2);
    expect(p.green.bins[128 * 2]).toBe(2);
    expect(p.blue.bins[0]).toBe(2);
    expect(p.red.bins[0]).toBe(0);
  });

  it("vectorscope of grey sits at the centre", () => {
    const v = computeVectorscope(solid(8, 8, 100, 100, 100), 256);
    expect(v.bins[128 * 256 + 128]).toBe(64);
    expect(v.max).toBe(64);
  });

  it("red lands above and left of centre and is counted", () => {
    const v = computeVectorscope(solid(2, 2, 255, 0, 0), 256);
    const p = vectorscopePoint([255, 0, 0], 256);
    expect(p.y).toBeLessThan(128);
    expect(p.x).toBeLessThan(128);
    expect(v.bins[Math.round(p.y) * 256 + Math.round(p.x)]).toBe(4);
  });

  it("blue is right of centre and below", () => {
    const p = vectorscopePoint([0, 0, 255], 256);
    expect(p.x).toBeGreaterThan(128);
    expect(p.y).toBeGreaterThan(128);
  });

  it("keeps max-chroma pixels on the scope (pure blue, red, yellow)", () => {
    for (const rgb of [
      [0, 0, 255],
      [255, 0, 0],
      [255, 255, 0],
      [0, 255, 255],
    ] as const) {
      const v = computeVectorscope(solid(2, 2, rgb[0], rgb[1], rgb[2]), 256);
      expect(v.bins.reduce((a, b) => a + b, 0)).toBe(4);
      expect(v.max).toBe(4);
    }
  });

  it("75% target boxes all lie inside the scope", () => {
    for (const t of VECTORSCOPE_TARGETS) {
      const p = vectorscopePoint(t.rgb, 256);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(256);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(256);
    }
  });

  it("histogram counts every pixel per channel", () => {
    const h = computeRgbHistogram(solid(5, 4, 10, 20, 30));
    expect(h.red[10]).toBe(20);
    expect(h.green[20]).toBe(20);
    expect(h.blue[30]).toBe(20);
    expect(h.luma.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it("downsample bounds width and preserves content", () => {
    const d = downsampleForScopes(solid(1024, 512, 1, 2, 3), 256);
    expect(d.width).toBe(256);
    expect(d.height).toBe(128);
    expect(d.data.length).toBe(256 * 128 * 4);
    expect(d.data[0]).toBe(1);
    expect(d.data[2]).toBe(3);
  });

  it("downsample returns input when already small", () => {
    const s = solid(100, 50, 0, 0, 0);
    expect(downsampleForScopes(s, 256)).toBe(s);
  });
});
