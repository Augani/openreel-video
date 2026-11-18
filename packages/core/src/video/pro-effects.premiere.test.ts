import { describe, expect, it } from "vitest";
import {
  PRO_EFFECT_DEFAULTS,
  applyCropFeather,
  applyGaussianBlurHV,
  applyProEffect,
  applySkew,
  applyVibrance,
  isProEffectNeutral,
  proEffectGpuUniforms,
  skewInverse,
} from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";

function solid(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([...rgb, 255], i * 4);
  return d;
}

/** Left half black, right half white. */
function verticalEdge(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) d.set(x < w / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * w + x) * 4);
  return d;
}

describe("gaussian-blur H/V", () => {
  const W = 20;
  const H = 12;
  it("horizontal-only blur softens a vertical edge and keeps rows identical", () => {
    const d = verticalEdge(W, H);
    applyGaussianBlurHV(d, W, H, 6, 0);
    const mid = (5 * W + W / 2) * 4;
    expect(d[mid]).toBeGreaterThan(0);
    expect(d[mid]).toBeLessThan(255);
    for (let x = 0; x < W; x++) expect(d[(0 * W + x) * 4]).toBe(d[(7 * W + x) * 4]);
  });
  it("vertical-only blur leaves a vertical edge untouched", () => {
    const original = verticalEdge(W, H);
    const d = new Uint8ClampedArray(original);
    applyGaussianBlurHV(d, W, H, 0, 8);
    expect(Array.from(d)).toEqual(Array.from(original));
  });
  it("keeps a flat image flat and zero/zero is neutral", () => {
    const d = solid(W, H, [90, 120, 200]);
    applyGaussianBlurHV(d, W, H, 9, 9);
    expect(Array.from(d)).toEqual(Array.from(solid(W, H, [90, 120, 200])));
    expect(isProEffectNeutral("gaussian-blur", { blurX: 0, blurY: 0 })).toBe(true);
    expect(isProEffectNeutral("gaussian-blur", { blurX: 0, blurY: 1 })).toBe(false);
  });
  it("maps radii straight to GPU uniforms", () => {
    expect(proEffectGpuUniforms("gaussian-blur", { blurX: 4, blurY: 500 }, 10)).toEqual({ rx: 4, ry: 100 });
  });
});

describe("crop with feather", () => {
  const W = 40;
  const H = 20;
  it("hard crop zeroes alpha outside the rectangle and keeps colour", () => {
    const d = solid(W, H, [10, 20, 30]);
    applyCropFeather(d, W, H, 25, 0, 0, 0, 0);
    expect(d[3]).toBe(0);
    expect(d[(0 * W + 9) * 4 + 3]).toBe(0);
    expect(d[(0 * W + 10) * 4 + 3]).toBe(255);
    expect(d[0]).toBe(10);
  });
  it("feather ramps alpha monotonically and never fades the uncropped frame border", () => {
    const d = solid(W, H, [10, 20, 30]);
    applyCropFeather(d, W, H, 25, 0, 0, 0, 8);
    const row = Array.from({ length: W }, (_, x) => d[(5 * W + x) * 4 + 3]);
    for (let x = 1; x < W; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(row[10]).toBeGreaterThan(100);
    expect(row[10]).toBeLessThan(155);
    expect(row[W - 1]).toBe(255);
    expect(d[(0 * W + W - 1) * 4 + 3]).toBe(255);
  });
  it("zero crop is neutral regardless of feather; uniforms are frame fractions", () => {
    expect(isProEffectNeutral("crop", { left: 0, top: 0, right: 0, bottom: 0, feather: 50 })).toBe(true);
    expect(proEffectGpuUniforms("crop", { left: 10, top: 20, right: 0, bottom: 50, feather: 4 }, 100)).toEqual({
      l: 0.1,
      t: 0.2,
      r: 0,
      b: 0.5,
      feather: 4,
    });
  });
});

describe("vibrance", () => {
  const px = (rgb: [number, number, number]): Uint8ClampedArray => new Uint8ClampedArray([...rgb, 255]);
  const chroma = (p: Uint8ClampedArray) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  it("boosts a muted colour proportionally more than a saturated one and keeps greys", () => {
    const muted = px([150, 130, 120]);
    const vivid = px([250, 40, 30]);
    const grey = px([128, 128, 128]);
    const mutedBefore = chroma(muted);
    const vividBefore = chroma(vivid);
    for (const p of [muted, vivid, grey]) applyVibrance(p, 80, 0);
    expect(chroma(muted) / mutedBefore).toBeGreaterThan(chroma(vivid) / vividBefore);
    expect(Array.from(grey.slice(0, 3))).toEqual([128, 128, 128]);
  });
  it("saturation -100 yields grey and neutral params are the identity", () => {
    const p = px([200, 50, 10]);
    applyVibrance(p, 0, -100);
    expect(p[0]).toBe(p[1]);
    expect(p[1]).toBe(p[2]);
    expect(isProEffectNeutral("vibrance", { vibrance: 0, saturation: 0 })).toBe(true);
  });
});

describe("skew", () => {
  const W = 24;
  const H = 16;
  it("exposes transparent wedges and keeps the centre anchored", () => {
    const d = solid(W, H, [200, 100, 50]);
    applySkew(d, W, H, 30, 0);
    expect(d[(W - 1) * 4 + 3]).toBe(0);
    const centreRow = Math.floor(H / 2);
    expect(d[(centreRow * W + W / 2) * 4 + 3]).toBe(255);
    expect(d[(centreRow * W + W / 2) * 4]).toBe(200);
  });
  it("is neutral at 0/0 and degenerate shears are fully transparent on both paths", () => {
    expect(isProEffectNeutral("skew", { skewX: 0, skewY: 0 })).toBe(true);
    expect(skewInverse(45, 45).valid).toBe(false);
    const d = solid(W, H, [1, 2, 3]);
    applyProEffect("skew", { skewX: 45, skewY: 45 }, d, W, H);
    expect(Array.from(d).every((v) => v === 0)).toBe(true);
    expect(proEffectGpuUniforms("skew", { skewX: 45, skewY: 45 }, H).valid).toBe(0);
  });
  it("inverse matrix times forward shear is the identity", () => {
    const m = skewInverse(20, -10);
    const tx = Math.tan((20 * Math.PI) / 180);
    const ty = Math.tan((-10 * Math.PI) / 180);
    expect(m.a + m.b * ty).toBeCloseTo(1, 10);
    expect(m.a * tx + m.b).toBeCloseTo(0, 10);
    expect(m.c + m.d * ty).toBeCloseTo(0, 10);
    expect(m.c * tx + m.d).toBeCloseTo(1, 10);
  });
});

describe("new pro effect shaders", () => {
  it("declare every uniform the GPU mapping supplies", () => {
    for (const type of ["gaussian-blur", "crop", "vibrance", "skew"] as const) {
      const uniforms = Object.keys(proEffectGpuUniforms(type, PRO_EFFECT_DEFAULTS[type], 100)).sort();
      const names = PRO_EFFECT_SHADER_DEFS[type].params.map((p) => p.name).sort();
      expect(names).toEqual(uniforms);
      for (const name of names) expect(PRO_EFFECT_SHADER_DEFS[type].glsl).toContain(`u_${name}`);
    }
  });
});
