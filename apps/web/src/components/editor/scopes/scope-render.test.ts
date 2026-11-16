import { describe, it, expect } from "vitest";
import {
  frameHasContent,
  renderScope,
  scopeDimensions,
  SCOPE_ANALYSIS_WIDTH,
  type ScopeKind,
} from "./scope-render";

function frame(w: number, h: number, r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe("renderScope", () => {
  it("produces correctly sized rasters for each scope", () => {
    const expected: Record<ScopeKind, [number, number]> = {
      waveform: [64, 256],
      parade: [192, 256],
      yc: [64, 256],
      vectorscope: [320, 320],
      hls: [320, 320],
      histogram: [256, 128],
    };
    for (const kind of Object.keys(expected) as ScopeKind[]) {
      const r = renderScope(kind, frame(64, 36, 200, 100, 50));
      expect([r.width, r.height]).toEqual(expected[kind]);
      expect(r.pixels.length).toBe(r.width * r.height * 4);
    }
  });

  it("downsamples wide frames before analysis", () => {
    const r = renderScope("waveform", frame(1920, 1080, 255, 255, 255));
    expect(r.width).toBe(SCOPE_ANALYSIS_WIDTH);
    expect(SCOPE_ANALYSIS_WIDTH).toBeGreaterThanOrEqual(512);
  });

  it("renders YC with a chroma trace and HLS with a lit trace", () => {
    const yc = renderScope("yc", frame(16, 16, 255, 0, 0));
    let cyan = 0;
    for (let i = 0; i < yc.pixels.length; i += 4) {
      if (yc.pixels[i + 2] > 150 && yc.pixels[i] < 120) cyan++;
    }
    expect(cyan).toBeGreaterThan(0);
    const hls = renderScope("hls", frame(16, 16, 255, 0, 0));
    let lit = 0;
    for (let i = 0; i < hls.pixels.length; i += 4) if (hls.pixels[i] > 60) lit++;
    expect(lit).toBeGreaterThan(0);
  });

  it("paints a bright trace at the top for white", () => {
    const r = renderScope("waveform", frame(8, 8, 255, 255, 255));
    expect(r.pixels[1]).toBeGreaterThan(100); // green channel of pixel (0,0)
    const bottom = (255 * 8) * 4 + 1;
    expect(r.pixels[bottom]).toBe(0);
  });

  it("draws a luma overlay on the histogram", () => {
    const r = renderScope("histogram", frame(16, 16, 128, 128, 128));
    let white = 0;
    for (let i = 0; i < r.pixels.length; i += 4) {
      if (r.pixels[i] === 235 && r.pixels[i + 1] === 235 && r.pixels[i + 2] === 235) white++;
    }
    expect(white).toBeGreaterThan(0);
  });

  it("scopeDimensions matches the rasters renderScope produces for an analysis-width frame", () => {
    for (const kind of ["waveform", "parade", "yc", "vectorscope", "hls", "histogram"] as ScopeKind[]) {
      const r = renderScope(kind, frame(SCOPE_ANALYSIS_WIDTH, 288, 90, 120, 200));
      expect({ width: r.width, height: r.height }).toEqual(scopeDimensions(kind));
    }
  });

  it("frameHasContent detects transparent and sparse opaque frames", () => {
    expect(frameHasContent(new Uint8ClampedArray(256 * 144 * 4))).toBe(false);
    expect(frameHasContent(frame(256, 144, 0, 0, 0).data)).toBe(true);
    const sparse = new Uint8ClampedArray(256 * 144 * 4);
    sparse[3] = 255; // only the very first pixel is opaque
    expect(frameHasContent(sparse)).toBe(true);
  });
});
