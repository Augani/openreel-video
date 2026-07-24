import { describe, it, expect } from "vitest";
import { encodePng } from "../geometry";
import {
  bakeProceduralTexture,
  bakeProceduralTexturePng,
  proceduralField,
} from "./procedural";

describe("png encoder", () => {
  it("writes a valid PNG signature and IHDR dimensions", () => {
    const size = 4;
    const rgba = new Uint8Array(size * size * 4).fill(128);
    const png = encodePng(rgba, size, size);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16, false)).toBe(size);
    expect(view.getUint32(20, false)).toBe(size);
  });

  it("rejects mismatched rgba length", () => {
    expect(() => encodePng(new Uint8Array(3), 2, 2)).toThrow();
  });
});

describe("procedural texture field", () => {
  it("keeps the field within the unit range for every pattern", () => {
    const patterns = [
      "noise",
      "voronoi",
      "fbm",
      "marble",
      "circuit",
      "fabric-weave",
      "lunar-dust",
      "hex-grid",
      "gradient",
      "brushed",
      "checker",
    ];
    for (const pattern of patterns) {
      for (let i = 0; i <= 8; i += 1) {
        const value = proceduralField(pattern, i / 8, (8 - i) / 8, 4, 7);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("procedural texture bake", () => {
  it("bakes a deterministic RGBA buffer with an average color", () => {
    const a = bakeProceduralTexture({ pattern: "voronoi", size: 16, seed: 3 });
    const b = bakeProceduralTexture({ pattern: "voronoi", size: 16, seed: 3 });
    expect(a.size).toBe(16);
    expect(a.rgba.length).toBe(16 * 16 * 4);
    expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
    expect(a.averageColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("bakes a procedural texture to a PNG data URI", () => {
    const baked = bakeProceduralTexturePng({
      pattern: "circuit",
      size: 32,
      colorA: "#064e3b",
      colorB: "#22c55e",
      seed: 9,
    });
    expect(baked.dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(baked.pngBase64.length).toBeGreaterThan(0);
    expect(baked.averageColor).toMatch(/^#[0-9a-f]{6}$/);
  });
});
