import { describe, expect, it } from "vitest";
import {
  computeSecondaryMatte,
  matteCoverage,
  qualifierFromSample,
  qualifyPixel,
  readQualifier,
  rgbToHsl01,
  sampleAverageRgb,
  secondaryUniforms,
  QUALIFIER_FULL,
} from "./hsl-secondary";
import {
  PRO_EFFECT_DEFAULTS,
  applyProEffect,
  isProEffectNeutral,
  proEffectGpuUniforms,
} from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";

const W = 64;
const H = 16;

/** Hue sweep 0..360 left to right at full saturation, mid luma. */
function hueGradient(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = (x / W) * 360;
      const c = 1 - Math.abs(((h / 60) % 2) - 1);
      const sector = Math.floor(h / 60);
      const rgb: [number, number, number][] = [
        [1, c, 0],
        [c, 1, 0],
        [0, 1, c],
        [0, c, 1],
        [c, 0, 1],
        [1, 0, c],
      ];
      const [r, g, b] = rgb[sector];
      d.set([r * 255, g * 255, b * 255, 255].map(Math.round), (y * W + x) * 4);
    }
  }
  return d;
}

const px = (d: Uint8ClampedArray, x: number, y = 0): number[] =>
  Array.from(d.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

const params = (extra: Record<string, unknown>) => ({
  ...PRO_EFFECT_DEFAULTS["hsl-secondary"],
  saturation: 0,
  ...extra,
});

describe("rgbToHsl01", () => {
  it("maps primaries and gray", () => {
    expect(rgbToHsl01(1, 0, 0)).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(rgbToHsl01(0, 1, 0).h).toBeCloseTo(120);
    expect(rgbToHsl01(0, 0, 1).h).toBeCloseTo(240);
    expect(rgbToHsl01(0.5, 0.5, 0.5)).toEqual({ h: 0, s: 0, l: 0.5 });
  });
});

describe("qualifier", () => {
  it("hue range selects only the keyed arc, with linear softness", () => {
    const u = secondaryUniforms(params({ hueMin: 100, hueMax: 140, hueSoft: 20 }));
    expect(qualifyPixel(u, 0, 1, 0)).toBe(1);
    expect(qualifyPixel(u, 1, 0, 0)).toBe(0);
    const edge = qualifyPixel(u, 0, 1, 0.34);
    expect(edge).toBeGreaterThan(0.5);
    expect(edge).toBeLessThan(1);
  });
  it("hue range may wrap through 0", () => {
    const u = secondaryUniforms(params({ hueMin: 330, hueMax: 30, hueSoft: 0 }));
    expect(qualifyPixel(u, 1, 0, 0)).toBe(1);
    expect(qualifyPixel(u, 0, 1, 0)).toBe(0);
  });
  it("saturation and luma ranges exclude grays and darks", () => {
    const u = secondaryUniforms(params({ satMin: 40, satSoft: 0, lumMin: 20, lumSoft: 0 }));
    expect(qualifyPixel(u, 0.5, 0.5, 0.5)).toBe(0);
    expect(qualifyPixel(u, 1, 0, 0)).toBe(1);
    expect(qualifyPixel(u, 0.1, 0, 0)).toBe(0);
  });
});

describe("matte", () => {
  it("covers the expected fraction of a hue sweep and inverts to its complement", () => {
    const d = hueGradient();
    const sel = secondaryUniforms(params({ hueMin: 90, hueMax: 150, hueSoft: 0 }));
    const cov = matteCoverage(computeSecondaryMatte(d, W, H, sel));
    expect(cov).toBeGreaterThan(60 / 360 - 0.04);
    expect(cov).toBeLessThan(60 / 360 + 0.04);
    const inv = secondaryUniforms(params({ hueMin: 90, hueMax: 150, hueSoft: 0, invert: true }));
    expect(matteCoverage(computeSecondaryMatte(d, W, H, inv)) + cov).toBeCloseTo(1, 5);
  });
  it("blur softens the matte edge and denoise removes isolated specks", () => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) d.set([128, 128, 128, 255], i * 4);
    d.set([255, 0, 0, 255], (8 * W + 30) * 4);
    const key = { hueMin: 0, hueMax: 20, hueSoft: 0, satMin: 50, satSoft: 0 };
    const sharp = computeSecondaryMatte(d, W, H, secondaryUniforms(params(key)));
    expect(sharp[8 * W + 30]).toBe(1);
    const clean = computeSecondaryMatte(d, W, H, secondaryUniforms(params({ ...key, denoise: 60 })));
    expect(clean[8 * W + 30]).toBe(0);
    const soft = computeSecondaryMatte(d, W, H, secondaryUniforms(params({ ...key, blur: 6 })));
    expect(soft[8 * W + 30]).toBeGreaterThan(0);
    expect(soft[8 * W + 30]).toBeLessThan(1);
    expect(soft[8 * W + 33]).toBeGreaterThan(0);
  });
  it("shape limit keeps the matte inside the ellipse / rectangle only", () => {
    const d = hueGradient();
    const full = { hueMin: 0, hueMax: 360 };
    const rect = computeSecondaryMatte(
      d,
      W,
      H,
      secondaryUniforms(
        params({ ...full, maskShape: "rectangle", maskX: 25, maskW: 50, maskY: 50, maskH: 100 }),
      ),
    );
    expect(rect[8 * W + 8]).toBe(1);
    expect(rect[8 * W + 50]).toBe(0);
    expect(matteCoverage(rect)).toBeCloseTo(0.5, 1);
    const inv = computeSecondaryMatte(
      d,
      W,
      H,
      secondaryUniforms(
        params({ ...full, maskShape: "ellipse", maskX: 50, maskY: 50, maskW: 50, maskH: 50, maskInvert: true }),
      ),
    );
    expect(inv[8 * W + 32]).toBe(0);
    expect(inv[0]).toBe(1);
  });
});

describe("correction applies only through the matte", () => {
  it("desaturates the keyed arc and leaves everything else byte-identical", () => {
    const src = hueGradient();
    const d = new Uint8ClampedArray(src);
    const p = params({ hueMin: 100, hueMax: 140, hueSoft: 0, saturation: -100 });
    expect(applyProEffect("hsl-secondary", p, d, W, H)).toBe(true);
    for (let x = 0; x < W; x++) {
      const hue = (x / W) * 360;
      if (hue > 108 && hue < 132) {
        const [r, g, b] = px(d, x);
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
      } else if (hue < 95 || hue > 145) {
        expect(px(d, x)).toEqual(px(src, x));
      }
    }
  });
  it("temperature, tint, contrast, wheel and sharpen move the keyed pixels", () => {
    const src = hueGradient();
    const base = params({ hueMin: 100, hueMax: 140, hueSoft: 0 });
    const x = Math.round((120 / 360) * W);
    for (const extra of [
      { temperature: 80 },
      { tint: 80 },
      { contrast: 60 },
      { wheelX: 1, wheelY: 0 },
      { sharpen: 100 },
    ]) {
      const d = new Uint8ClampedArray(src);
      applyProEffect("hsl-secondary", { ...base, ...extra }, d, W, H);
      expect(px(d, x), JSON.stringify(extra)).not.toEqual(px(src, x));
      expect(px(d, 2)).toEqual(px(src, 2));
    }
  });
  it("alpha is never modified", () => {
    const d = hueGradient();
    for (let i = 3; i < d.length; i += 4) d[i] = 77;
    applyProEffect("hsl-secondary", params({ saturation: -100 }), d, W, H);
    for (let i = 3; i < d.length; i += 4) expect(d[i]).toBe(77);
  });
  it("neutral correction is an exact no-op", () => {
    const src = hueGradient();
    const d = new Uint8ClampedArray(src);
    applyProEffect("hsl-secondary", params({}), d, W, H);
    expect(Array.from(d)).toEqual(Array.from(src));
    expect(isProEffectNeutral("hsl-secondary", params({}))).toBe(true);
    expect(isProEffectNeutral("hsl-secondary", params({ saturation: 10 }))).toBe(false);
  });
});

describe("matte view (preview only)", () => {
  it("black/white view paints exactly the matte and bypass returns the input", () => {
    const src = hueGradient();
    const bw = new Uint8ClampedArray(src);
    const p = params({ hueMin: 100, hueMax: 140, hueSoft: 0 });
    expect(isProEffectNeutral("hsl-secondary", { ...p, matteView: 3 })).toBe(false);
    applyProEffect("hsl-secondary", { ...p, matteView: 3 }, bw, W, H);
    const matte = computeSecondaryMatte(src, W, H, secondaryUniforms(p));
    for (let i = 0; i < W * H; i++) expect(bw[i * 4]).toBe(matte[i] >= 0.5 ? 255 : 0);
    const bypass = new Uint8ClampedArray(src);
    applyProEffect("hsl-secondary", { ...p, saturation: -100, matteView: 4 }, bypass, W, H);
    expect(Array.from(bypass)).toEqual(Array.from(src));
    const gray = new Uint8ClampedArray(src);
    applyProEffect("hsl-secondary", { ...p, matteView: 2 }, gray, W, H);
    expect(gray[1]).toBe(gray[0]);
  });
});

describe("eyedropper", () => {
  const green: [number, number, number] = [0, 1, 0];
  it("set builds a range around the sample", () => {
    const q = qualifierFromSample(QUALIFIER_FULL, green, "set");
    expect(q.hueMin).toBeCloseTo(105);
    expect(q.hueMax).toBeCloseTo(135);
    const u = secondaryUniforms({ ...q, saturation: 0 });
    expect(qualifyPixel(u, 0, 1, 0)).toBe(1);
    expect(qualifyPixel(u, 1, 0, 0)).toBe(0);
  });
  it("add widens to include a second colour, subtract excludes it again", () => {
    let q = qualifierFromSample(QUALIFIER_FULL, green, "set");
    const red: [number, number, number] = [1, 0, 0];
    expect(qualifyPixel(secondaryUniforms({ ...q, hueSoft: 0 }), ...red)).toBe(0);
    q = qualifierFromSample(q, red, "add");
    expect(qualifyPixel(secondaryUniforms({ ...q, hueSoft: 0 }), ...red)).toBe(1);
    expect(qualifyPixel(secondaryUniforms({ ...q, hueSoft: 0 }), ...green)).toBe(1);
    q = qualifierFromSample(q, red, "subtract");
    const u = secondaryUniforms({ ...q, hueSoft: 0, satSoft: 0, lumSoft: 0 });
    expect(qualifyPixel(u, ...red)).toBe(0);
    expect(qualifyPixel(u, ...green)).toBe(1);
  });
  it("set around a hue near 0 wraps the range", () => {
    const q = qualifierFromSample(QUALIFIER_FULL, [1, 0, 0], "set");
    expect(q.hueMin).toBeCloseTo(345);
    expect(q.hueMax).toBeCloseTo(15);
    const u = secondaryUniforms({ ...q, hueSoft: 0 });
    expect(qualifyPixel(u, 1, 0.1, 0)).toBe(1);
    expect(qualifyPixel(u, 1, 0, 0.1)).toBe(1);
  });
  it("sampleAverageRgb averages a window and clamps at edges", () => {
    const d = hueGradient();
    const [r, g, b] = sampleAverageRgb(d, W, H, 0, 0, 1);
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeLessThan(0.2);
    expect(b).toBe(0);
  });
  it("readQualifier falls back to the open range", () => {
    expect(readQualifier({})).toEqual(QUALIFIER_FULL);
  });
});

describe("shader contract", () => {
  it("every GPU uniform is declared by the GLSL and mirrors the CPU struct", () => {
    const uniforms = proEffectGpuUniforms("hsl-secondary", params({ saturation: -20 }), H);
    const def = PRO_EFFECT_SHADER_DEFS["hsl-secondary"];
    expect(def.params.map((p) => p.name).sort()).toEqual(Object.keys(uniforms).sort());
    for (const key of Object.keys(uniforms)) expect(def.glsl).toContain(`uniform float u_${key};`);
    expect(Object.values(uniforms).every(Number.isFinite)).toBe(true);
  });
});
