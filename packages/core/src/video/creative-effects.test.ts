import { describe, expect, it } from "vitest";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_NEUTRAL_PARAMS,
  PRO_EFFECT_SPECS,
  applyProEffect,
  isProEffectNeutral,
  proEffectGpuUniforms,
  resolveProEffectParams,
} from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";
import {
  CREATIVE_PRO_EFFECT_TYPES,
  LENS_PROFILES,
  applySaturationToRgb,
  applyVibranceToRgb,
  distortPoint,
  getLensProfile,
  hueToRgb,
  lensCoefficients,
  rgbHueDegrees,
  skinHueWeight,
  tintPivot,
  tintWeights,
} from "./creative-effects";

function fill(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = rgb[0];
    d[i * 4 + 1] = rgb[1];
    d[i * 4 + 2] = rgb[2];
    d[i * 4 + 3] = 255;
  }
  return d;
}

const chroma = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);

describe("creative effects registry", () => {
  it("registers both effects with specs, shaders matching the uniforms, and a neutral that is an identity", () => {
    expect([...CREATIVE_PRO_EFFECT_TYPES]).toEqual(["lumetri-creative", "lens-correction"]);
    const src = fill(16, 8, [120, 90, 60]);
    for (const type of CREATIVE_PRO_EFFECT_TYPES) {
      expect(PRO_EFFECT_SHADER_DEFS[type].glsl).toContain("fragColor");
      const names = PRO_EFFECT_SHADER_DEFS[type].params.map((p) => p.name);
      expect(Object.keys(proEffectGpuUniforms(type, PRO_EFFECT_DEFAULTS[type], 8)).sort()).toEqual([...names].sort());
      expect(isProEffectNeutral(type, PRO_EFFECT_NEUTRAL_PARAMS[type]), `${type} neutral`).toBe(true);
      expect(isProEffectNeutral(type, PRO_EFFECT_DEFAULTS[type]), `${type} default acts`).toBe(false);
      const out = new Uint8ClampedArray(src);
      applyProEffect(type, PRO_EFFECT_NEUTRAL_PARAMS[type], out, 16, 8);
      expect(Array.from(out), type).toEqual(Array.from(src));
    }
    expect(PRO_EFFECT_SPECS["lumetri-creative"].category).toBe("Color");
    expect(PRO_EFFECT_SPECS["lens-correction"].category).toBe("Repair");
  });
});

describe("Faded Film", () => {
  it("lifts black, leaves white, and is monotonic", () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    applyProEffect("lumetri-creative", { fadedFilm: 100, vibrance: 0 }, d, 3, 1);
    expect(d[0]).toBe(64); // 0.25 * 255 = 63.75
    expect(d[8]).toBe(255);
    expect(d[0]).toBeLessThan(d[4]);
    expect(d[4]).toBeLessThan(d[8]);
  });
});

describe("Vibrance", () => {
  const skin: [number, number, number] = [0.8, 0.6, 0.48]; // hue ~ 22 deg
  const blue: [number, number, number] = [0.48, 0.6, 0.8]; // hue ~ 210 deg, same saturation and luma class

  it("recognises skin hues", () => {
    expect(skinHueWeight(rgbHueDegrees(...skin))).toBeCloseTo(1, 5);
    expect(skinHueWeight(rgbHueDegrees(...blue))).toBe(0);
    expect(skinHueWeight(120)).toBe(0);
  });

  it("boosts a non-skin hue far more than skin, where Saturation treats them the same", () => {
    const gain = (f: (r: number, g: number, b: number, a: number) => [number, number, number], c: [number, number, number]): number =>
      chroma(...f(...c, 0.5)) / chroma(...c);
    const vSkin = gain(applyVibranceToRgb, skin);
    const vBlue = gain(applyVibranceToRgb, blue);
    const sSkin = gain(applySaturationToRgb, skin);
    const sBlue = gain(applySaturationToRgb, blue);
    expect(sSkin).toBeCloseTo(sBlue, 6);
    expect(vBlue).toBeGreaterThan(1.2);
    expect(vSkin - 1).toBeLessThan((vBlue - 1) * 0.4);
    expect(vSkin).toBeLessThan(sSkin);
  });

  it("boosts muted colours more than already saturated ones", () => {
    const muted = applyVibranceToRgb(0.45, 0.5, 0.55, 0.6);
    const vivid = applyVibranceToRgb(0.1, 0.3, 0.9, 0.6);
    expect(chroma(...muted) / 0.1).toBeGreaterThan(chroma(...vivid) / 0.8);
  });

  it("runs through the pixel pass and keeps grays gray", () => {
    const d = new Uint8ClampedArray([128, 128, 128, 255, 100, 130, 200, 255]);
    applyProEffect("lumetri-creative", { fadedFilm: 0, vibrance: 80 }, d, 2, 1);
    expect([d[0], d[1], d[2]]).toEqual([128, 128, 128]);
    expect(chroma(d[4], d[5], d[6])).toBeGreaterThan(100);
  });
});

describe("Sharpen", () => {
  it("steepens an edge with overshoot and leaves flat areas alone", () => {
    const w = 8;
    const d = new Uint8ClampedArray(w * 3 * 4);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < w; x++) {
        const v = x < 4 ? 80 : 160;
        d.set([v, v, v, 255], (y * w + x) * 4);
      }
    applyProEffect("lumetri-creative", { fadedFilm: 0, vibrance: 0, sharpen: 100 }, d, w, 3);
    const row = (x: number): number => d[(1 * w + x) * 4];
    expect(row(0)).toBe(80);
    expect(row(7)).toBe(160);
    expect(row(3)).toBeLessThan(80);
    expect(row(4)).toBeGreaterThan(160);
  });
});

describe("Shadow and Highlight Tint", () => {
  it("tints darks toward the shadow hue and brights toward the highlight hue, midtones untouched, brightness kept", () => {
    const d = new Uint8ClampedArray([
      30, 30, 30, 255, //
      128, 128, 128, 255, //
      225, 225, 225, 255,
    ]);
    applyProEffect(
      "lumetri-creative",
      { fadedFilm: 0, vibrance: 0, shadowTintHue: 240, shadowTintAmount: 100, highlightTintHue: 30, highlightTintAmount: 100, tintBalance: 0 },
      d,
      3,
      1,
    );
    expect(d[2]).toBeGreaterThan(d[0]); // shadows go blue
    expect(d[8]).toBeGreaterThan(d[10]); // highlights go warm
    expect([d[4], d[5], d[6]]).toEqual([128, 128, 128]); // pivot: no tint
    const luma = (o: number): number => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    expect(Math.abs(luma(0) - 30)).toBeLessThan(4);
  });

  it("Tint Balance moves the pivot toward highlights or shadows", () => {
    expect(tintPivot(0)).toBe(0.5);
    expect(tintPivot(100)).toBeCloseTo(0.9);
    expect(tintPivot(-100)).toBeCloseTo(0.1);
    const [wsNeutral] = tintWeights(0.6, tintPivot(0));
    const [wsHigh] = tintWeights(0.6, tintPivot(100));
    expect(wsHigh).toBeGreaterThan(wsNeutral);
    expect(hueToRgb(0)).toEqual([1, 0, 0]);
    expect(hueToRgb(120)).toEqual([0, 1, 0]);
    expect(hueToRgb(240)).toEqual([0, 0, 1]);
  });
});

/* -------------------------------------------------------------------------- */
/* Lens correction on a synthetic grid with known coefficients                */
/* -------------------------------------------------------------------------- */

const W = 320;
const H = 180;
const HX = W / 2;
const HY = H / 2;
const NORM = Math.hypot(W, H) / 2;
const GOPRO = getLensProfile("gopro-wide")!;

/**
 * An image of an ideal vertical line at undistorted x = xu (normalised) as the lens would record it: every point of
 * the line mapped through the forward model. Dark line on white.
 */
function distortedLineImage(
  c: { k1: number; k2: number; p1: number; p2: number },
  line: { axis: "v" | "h"; at: number },
): Uint8ClampedArray {
  const d = fill(W, H, [255, 255, 255]);
  for (let t = -0.6; t <= 0.6; t += 0.0004) {
    const [xd, yd] = line.axis === "v" ? distortPoint(line.at, t, c) : distortPoint(t, line.at, c);
    const px = Math.floor(HX + xd * NORM);
    const py = Math.floor(HY + yd * NORM);
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    d.set([0, 0, 0, 255], (py * W + px) * 4);
  }
  return d;
}

/** Darkness-weighted centroid of a row (or column) in a window around `near`. */
function centroidInRow(d: Uint8ClampedArray, y: number, near: number): number | null {
  let sw = 0;
  let sx = 0;
  for (let x = Math.max(0, Math.round(near) - 6); x <= Math.min(W - 1, Math.round(near) + 6); x++) {
    const w = 255 - d[(y * W + x) * 4];
    sw += w;
    sx += w * x;
  }
  return sw > 40 ? sx / sw : null;
}

describe("Lens distortion correction (synthetic grid, known coefficients)", () => {
  const c = { k1: GOPRO.k1, k2: GOPRO.k2, p1: 0.004, p2: -0.003 };
  const params = {
    profile: "manual",
    distortion: (-c.k1 / 0.5) * 100,
    curvature: (-c.k2 / 0.25) * 100,
    tangentialX: (c.p1 / 0.05) * 100,
    tangentialY: (c.p2 / 0.05) * 100,
  };

  it("maps manual sliders to the Brown-Conrady terms exactly", () => {
    const k = lensCoefficients(resolveProEffectParams("lens-correction", params));
    expect(k.k1).toBeCloseTo(c.k1, 12);
    expect(k.k2).toBeCloseTo(c.k2, 12);
    expect(k.p1).toBeCloseTo(c.p1, 12);
    expect(k.p2).toBeCloseTo(c.p2, 12);
  });

  it("straightens a vertical grid line that the lens bowed", () => {
    const xu = 0.5;
    const src = distortedLineImage(c, { axis: "v", at: xu });
    const spread = (img: Uint8ClampedArray, expected: (y: number) => number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = 30; y < H - 30; y++) {
        const cx = centroidInRow(img, y, expected(y));
        if (cx === null) continue;
        lo = Math.min(lo, cx);
        hi = Math.max(hi, cx);
      }
      return hi - lo;
    };
    // The source line follows the forward model; find its column per row from the model itself.
    const bowed = (y: number): number => {
      const yu = (y + 0.5 - HY) / NORM;
      return HX + distortPoint(xu, yu, c)[0] * NORM - 0.5;
    };
    expect(spread(src, bowed)).toBeGreaterThan(3); // visibly curved before
    const out = new Uint8ClampedArray(src);
    applyProEffect("lens-correction", params, out, W, H);
    const straight = HX + xu * NORM - 0.5;
    let worst = 0;
    let rows = 0;
    for (let y = 30; y < H - 30; y++) {
      const cx = centroidInRow(out, y, straight);
      if (cx === null) continue;
      rows++;
      worst = Math.max(worst, Math.abs(cx - straight));
    }
    expect(rows).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.9);
  });

  it("straightens a horizontal grid line too (tangential terms included)", () => {
    const yu = -0.3;
    const src = distortedLineImage(c, { axis: "h", at: yu });
    const out = new Uint8ClampedArray(src);
    applyProEffect("lens-correction", params, out, W, H);
    const straightY = HY + yu * NORM - 0.5;
    let worst = 0;
    let cols = 0;
    for (let x = 40; x < W - 40; x++) {
      let sw = 0;
      let sy = 0;
      for (let y = Math.round(straightY) - 6; y <= Math.round(straightY) + 6; y++) {
        const w = 255 - out[(y * W + x) * 4];
        sw += w;
        sy += w * y;
      }
      if (sw < 40) continue;
      cols++;
      worst = Math.max(worst, Math.abs(sy / sw - straightY));
    }
    expect(cols).toBeGreaterThan(200);
    expect(worst).toBeLessThan(0.9);
  });

  it("recovers the sampling position of a coordinate ramp to well under a pixel", () => {
    // Red = x ramp, green = y ramp, so the output colour tells where each pixel sampled.
    const src = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) src.set([Math.round((x / (W - 1)) * 255), Math.round((y / (H - 1)) * 255), 0, 255], (y * W + x) * 4);
    const out = new Uint8ClampedArray(src);
    applyProEffect("lens-correction", { profile: "gopro-wide" }, out, W, H);
    for (const [px, py] of [[20, 15], [300, 160], [160, 90], [50, 150]] as const) {
      const qx = (px + 0.5 - HX) / NORM;
      const qy = (py + 0.5 - HY) / NORM;
      const [dx, dy] = distortPoint(qx, qy, GOPRO);
      const expX = HX + dx * NORM - 0.5;
      const expY = HY + dy * NORM - 0.5;
      const o = (py * W + px) * 4;
      expect(Math.abs((out[o] / 255) * (W - 1) - expX)).toBeLessThan(0.9);
      expect(Math.abs((out[o + 1] / 255) * (H - 1) - expY)).toBeLessThan(0.9);
    }
  });

  it("every built-in profile is a sane barrel model and neutral at zero strength", () => {
    const src = fill(32, 18, [90, 120, 150]);
    for (const p of LENS_PROFILES) {
      expect(p.k1, p.id).toBeLessThan(0);
      // The radial gain stays positive and monotonic out to the corners (r = 1 and beyond with scale).
      for (let r = 0; r < 1.2; r += 0.01) {
        const [x] = distortPoint(r, 0, p);
        const [x2] = distortPoint(r + 0.01, 0, p);
        expect(x2, `${p.id} monotonic at ${r}`).toBeGreaterThan(x);
      }
      const out = new Uint8ClampedArray(src);
      applyProEffect("lens-correction", { profile: p.id, strength: 0 }, out, 32, 18);
      expect(Array.from(out), p.id).toEqual(Array.from(src));
    }
  });
});

describe("Lateral chromatic aberration correction", () => {
  it("re-aligns a red stripe that the lens magnified by 1 % against green", () => {
    const base = 100; // px from the centre (red lands 1 px further out)
    const stripe = (d: Uint8ClampedArray, ch: number, centre: number): void => {
      for (let y = 0; y < H; y++)
        for (let x = Math.round(centre) - 1; x <= Math.round(centre) + 1; x++) d[(y * W + x) * 4 + ch] = 255;
    };
    const src = fill(W, H, [0, 0, 0]);
    stripe(src, 1, HX + base - 0.5);
    stripe(src, 0, HX + base * 1.01 - 0.5);
    const centroid = (d: Uint8ClampedArray, ch: number): number => {
      let sw = 0;
      let sx = 0;
      for (let x = HX + base - 8; x <= HX + base + 8; x++) {
        const w = d[(90 * W + x) * 4 + ch];
        sw += w;
        sx += w * x;
      }
      return sx / sw;
    };
    const before = centroid(src, 0) - centroid(src, 1);
    expect(before).toBeGreaterThan(0.9);
    const out = new Uint8ClampedArray(src);
    applyProEffect("lens-correction", { profile: "manual", distortion: 0, caRed: 100 }, out, W, H);
    expect(Math.abs(centroid(out, 0) - centroid(out, 1))).toBeLessThan(0.35);
  });
});

describe("Vignette compensation", () => {
  it("brightens the corners by the model gain and leaves the centre", () => {
    const src = fill(W, H, [100, 100, 100]);
    const out = new Uint8ClampedArray(src);
    applyProEffect("lens-correction", { profile: "manual", distortion: 0, vignette: 50 }, out, W, H);
    const centre = (90 * W + 160) * 4;
    expect(out[centre]).toBe(100);
    const corner = 0;
    const r2 = ((0.5 - HX) / NORM) ** 2 + ((0.5 - HY) / NORM) ** 2;
    expect(out[corner]).toBe(Math.round(100 * (1 + 0.5 * r2)));
    expect(out[corner]).toBeGreaterThan(145);
    const dark = new Uint8ClampedArray(src);
    applyProEffect("lens-correction", { profile: "manual", distortion: 0, vignette: -50 }, dark, W, H);
    expect(dark[corner]).toBeLessThan(60);
  });
});
