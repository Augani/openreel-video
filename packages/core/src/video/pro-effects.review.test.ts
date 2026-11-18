import { describe, expect, it } from "vitest";
import {
  applyCropFeather,
  applyGaussianBlurHV,
  applySkew,
  applyVibrance,
  validateProEffectParams,
  withProEffectDefaults,
} from "./pro-effects";
import { getAnimatedVideoEffects } from "./animated-video-effects";

const solid = (w: number, h: number, rgba: [number, number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4);
  return d;
};
const kfs = (property: string, a: number, b?: number) => [
  { id: `${property}-a`, property, time: 0, value: a, easing: "linear" },
  ...(b === undefined ? [] : [{ id: `${property}-b`, property, time: 2, value: b, easing: "linear" }]),
];

describe("pro effect review checks", () => {
  it("sub-pixel gaussian radius preserves a flat image exactly", () => {
    const d = solid(6, 5, [90, 120, 200, 255]);
    applyGaussianBlurHV(d, 6, 5, 0.5, 0.3);
    expect(Array.from(d.slice(0, 4))).toEqual([90, 120, 200, 255]);
    expect(new Set(d).size).toBe(4);
  });

  it("gaussian with only blurY does not mix horizontal neighbours", () => {
    const w = 5, h = 5;
    const d = solid(w, h, [0, 0, 0, 255]);
    d[(2 * w + 2) * 4] = 255;
    applyGaussianBlurHV(d, w, h, 0, 2);
    expect(d[(2 * w + 1) * 4]).toBe(0);
    expect(d[(1 * w + 2) * 4]).toBeGreaterThan(0);
  });

  it("crop whose opposite edges overlap makes everything transparent", () => {
    const d = solid(10, 10, [10, 20, 30, 255]);
    applyCropFeather(d, 10, 10, 60, 0, 60, 0, 0);
    for (let i = 3; i < d.length; i += 4) expect(d[i]).toBe(0);
  });

  it("crop keeps colour, keeps uncropped border opaque even with feather", () => {
    const d = solid(20, 20, [10, 20, 30, 255]);
    applyCropFeather(d, 20, 20, 0, 50, 0, 0, 6);
    expect(d[3]).toBe(0);
    expect(d[(19 * 20 + 0) * 4 + 3]).toBe(255);
    expect(d[(19 * 20 + 19) * 4 + 3]).toBe(255);
    expect(d[0]).toBe(10);
  });

  it("vibrance leaves grey unchanged and boosts muted colour more than vivid", () => {
    const grey = solid(1, 1, [128, 128, 128, 255]);
    applyVibrance(grey, 100, 0);
    expect(Array.from(grey.slice(0, 3))).toEqual([128, 128, 128]);
    const muted = solid(1, 1, [140, 120, 120, 255]);
    const vivid = solid(1, 1, [250, 20, 20, 255]);
    const spread = (a: Uint8ClampedArray) => Math.max(a[0], a[1], a[2]) - Math.min(a[0], a[1], a[2]);
    const m0 = spread(muted), v0 = spread(vivid);
    applyVibrance(muted, 80, 0);
    applyVibrance(vivid, 80, 0);
    expect(spread(muted) / m0).toBeGreaterThan(spread(vivid) / v0);
  });

  it("skew keeps the centre line pixel and shears symmetrically", () => {
    const w = 41, h = 41;
    const d = solid(w, h, [0, 0, 0, 255]);
    for (let y = 0; y < h; y++) d[(y * w + 20) * 4] = 255;
    applySkew(d, w, h, 30, 0);
    const lineX = (y: number) => {
      let best = -1, bx = -1;
      for (let x = 0; x < w; x++) {
        const v = d[(y * w + x) * 4 + 3] > 0 ? d[(y * w + x) * 4] : -1;
        if (v > best) { best = v; bx = x; }
      }
      return bx;
    };
    expect(lineX(20)).toBe(20);
    const below = lineX(30) - 20;
    const above = 20 - lineX(10);
    expect(Math.abs(below)).toBeGreaterThan(4);
    expect(below).toBe(above);
  });

  it("validateProEffectParams rejects prototype keys, NaN, out of range and bad enums", () => {
    expect(validateProEffectParams("skew", JSON.parse('{"__proto__": 1}'))).not.toBeNull();
    expect(validateProEffectParams("skew", { constructor: "x" })).not.toBeNull();
    expect(validateProEffectParams("skew", { skewX: Number.NaN })).not.toBeNull();
    expect(validateProEffectParams("skew", { skewX: 61 })).not.toBeNull();
    expect(validateProEffectParams("mirror", { mode: "diagonal" })).not.toBeNull();
    expect(validateProEffectParams("skew", { skewX: 60, skewY: -60 })).toBeNull();
  });

  it("withProEffectDefaults lets explicit params win and passes non-pro through", () => {
    expect(withProEffectDefaults("skew", { skewX: 0 })).toMatchObject({ skewX: 0, skewY: 0 });
    const p = { value: 1 };
    expect(withProEffectDefaults("brightness", p)).toBe(p);
  });

  it("keyframes on a DISABLED stored effect keep it disabled and keep its other params", () => {
    const out = getAnimatedVideoEffects(
      {
        id: "c",
        effects: [{ id: "e", type: "skew", enabled: false, params: { skewX: 5, skewY: 5 } }],
        keyframes: kfs("effect.skew.skewX", 10, 30),
      } as never,
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0].enabled).toBe(false);
    expect(out[0].params).toMatchObject({ skewX: 20, skewY: 5 });
  });

  it("keyframes on a clip without the effect start from defaults for unkeyframed params", () => {
    const out = getAnimatedVideoEffects(
      { id: "c", effects: [], keyframes: kfs("effect.crop.left", 40) } as never,
      0,
    );
    expect(out[0].params).toMatchObject({ left: 40, top: 10, feather: 12 });
  });
});
