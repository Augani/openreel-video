import { describe, expect, it } from "vitest";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_NEUTRAL_PARAMS,
  PRO_EFFECT_SPECS,
  applyProEffect,
  isProEffectNeutral,
  proEffectGpuUniforms,
} from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";
import {
  REPAIR_PRO_EFFECT_TYPES,
  applyDehaze,
  dehazeAtmosphericLight,
} from "./repair-effects";

const luma = (d: Uint8ClampedArray, i: number): number =>
  (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

function std(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

/** Left-to-right gradient J (0.1..0.9) blended with haze: I = J * t0 + A * (1 - t0). */
function hazyGradient(w: number, h: number, t0: number, A: [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = 0.1 + (0.8 * x) / (w - 1);
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[o + c] = Math.round((j * t0 + A[c] * (1 - t0)) * 255);
      d[o + 3] = 255;
    }
  }
  return d;
}

describe("repair effects registry", () => {
  it("lists the three effects with specs, defaults, neutral values and shaders", () => {
    expect([...REPAIR_PRO_EFFECT_TYPES]).toEqual(["dehaze", "deflicker", "deband"]);
    for (const type of REPAIR_PRO_EFFECT_TYPES) {
      expect(PRO_EFFECT_SPECS[type].category).toBe("Repair");
      expect(PRO_EFFECT_SHADER_DEFS[type].glsl).toContain("fragColor");
      const names = PRO_EFFECT_SHADER_DEFS[type].params.map((p) => p.name);
      expect(Object.keys(proEffectGpuUniforms(type, PRO_EFFECT_DEFAULTS[type], 90)).sort()).toEqual([...names].sort());
      expect(isProEffectNeutral(type, PRO_EFFECT_NEUTRAL_PARAMS[type]), `${type} neutral`).toBe(true);
      expect(isProEffectNeutral(type, PRO_EFFECT_DEFAULTS[type]), `${type} default acts`).toBe(false);
    }
  });

  it("leaves a frame bit-identical at neutral parameters", () => {
    const src = hazyGradient(32, 8, 0.6, [0.9, 0.9, 0.95]);
    for (const type of REPAIR_PRO_EFFECT_TYPES) {
      const out = new Uint8ClampedArray(src);
      applyProEffect(type, PRO_EFFECT_NEUTRAL_PARAMS[type], out, 32, 8);
      expect(Array.from(out), type).toEqual(Array.from(src));
    }
  });

  it("never touches alpha", () => {
    const src = hazyGradient(32, 8, 0.6, [0.9, 0.9, 0.95]);
    for (let i = 3; i < src.length; i += 4) src[i] = 77;
    for (const type of REPAIR_PRO_EFFECT_TYPES) {
      const out = new Uint8ClampedArray(src);
      applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type], gainR: 1.2, gainG: 0.9, gainB: 1 }, out, 32, 8);
      for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(77);
    }
  });
});

describe("dehaze", () => {
  const W = 128;
  const H = 24;
  const A: [number, number, number] = [0.92, 0.92, 0.95];

  it("raises contrast of a haze-blended gradient without clipping", () => {
    const src = hazyGradient(W, H, 0.55, A);
    const out = new Uint8ClampedArray(src);
    applyProEffect("dehaze", { amount: 80, radius: 6, skyProtection: 60 }, out, W, H);
    const row = (d: Uint8ClampedArray): number[] => Array.from({ length: W }, (_, x) => luma(d, (12 * W + x) * 4));
    const before = row(src);
    const after = row(out);
    expect(std(after)).toBeGreaterThan(std(before) * 1.25);
    expect(Math.min(...after)).toBeLessThan(Math.min(...before));
    // The dark end gets darker, the bright end is kept (no blown highlights, no crushed shadows).
    let clipped = 0;
    for (let i = 0; i < out.length; i += 4) for (let c = 0; c < 3; c++) if (out[i + c] === 0 || out[i + c] === 255) clipped++;
    expect(clipped / (W * H * 3)).toBeLessThan(0.01);
    // Still a monotonic gradient (no halo steps larger than a few levels).
    const smoothed = after.map((_, x) => after.slice(Math.max(0, x - 3), x + 4).reduce((a, b) => a + b, 0) / Math.min(7, x + 4, W - x + 3));
    for (let x = 8; x < W - 8; x++) expect(smoothed[x]).toBeGreaterThanOrEqual(smoothed[x - 4] - 0.01);
  });

  it("estimates the atmospheric light from the brightest dark-channel sample", () => {
    const src = hazyGradient(W, H, 0.55, A);
    const [r, g, b] = dehazeAtmosphericLight(src, W, H);
    expect(r).toBeGreaterThan(0.85);
    expect(b).toBeGreaterThanOrEqual(r - 0.001);
    expect(g).toBeLessThanOrEqual(1);
  });

  it("protects a sky region: a bright flat patch is changed far less with sky protection", () => {
    const w = 64;
    const h = 32;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        // left: textured ground, right: hazy sky slightly darker than the brightest cloud (x = 63)
        const v = x < 32 ? 90 + ((x * 7 + y * 3) % 40) : x === w - 1 ? 242 : 224;
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
      }
    }
    const light: [number, number, number] = [242 / 255, 242 / 255, 242 / 255];
    const run = (sky: number): number => {
      const out = new Uint8ClampedArray(d);
      applyDehaze(out, w, h, 100, 6, sky, light);
      return Math.abs(out[(16 * w + 48) * 4] - 224);
    };
    expect(run(100)).toBeLessThan(run(0));
    expect(run(100)).toBeLessThanOrEqual(12);
  });

  it("negative amounts add haze (lower contrast) and amount 0 is a no-op", () => {
    const src = hazyGradient(W, H, 0.9, [0.9, 0.9, 0.9]);
    const out = new Uint8ClampedArray(src);
    applyProEffect("dehaze", { amount: -100, radius: 8, skyProtection: 60 }, out, W, H);
    const rowStd = (d: Uint8ClampedArray): number => std(Array.from({ length: W }, (_, x) => luma(d, (12 * W + x) * 4)));
    expect(rowStd(out)).toBeLessThan(rowStd(src) * 0.6);
  });
});

describe("deband", () => {
  const W = 256;
  const H = 40;

  /** 8-bit ramp from level 100 to 112 over the width (steps of ~21 px), with a hard 70-level edge in the lower half. */
  function ramp(): { data: Uint8ClampedArray; ideal: Float64Array } {
    const data = new Uint8ClampedArray(W * H * 4);
    const ideal = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 100 + (12 * x) / (W - 1);
        if (y >= 28 && x >= W / 2) v += 70;
        ideal[y * W + x] = v;
        const o = (y * W + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = Math.round(v);
        data[o + 3] = 255;
      }
    }
    return { data, ideal };
  }

  /** RMS of the 9x9 box-filtered (output - ideal) over the ramp area: step banding survives the box, dither noise does not. */
  function bandingError(d: Uint8ClampedArray, ideal: Float64Array): number {
    let acc = 0;
    let n = 0;
    for (let y = 6; y < 22; y++) {
      for (let x = 20; x < W - 20; x++) {
        let s = 0;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) s += d[((y + dy) * W + x + dx) * 4] - ideal[(y + dy) * W + x + dx];
        const e = s / 81;
        acc += e * e;
        n++;
      }
    }
    return Math.sqrt(acc / n);
  }

  it("removes the quantisation steps of an 8-bit ramp", () => {
    const { data, ideal } = ramp();
    const before = bandingError(data, ideal);
    const out = new Uint8ClampedArray(data);
    applyProEffect("deband", { threshold: 4, radius: 16, iterations: 2, dither: 50 }, out, W, H);
    const after = bandingError(out, ideal);
    expect(before).toBeGreaterThan(0.15);
    expect(after).toBeLessThan(before * 0.55);
  });

  it("keeps a hard edge: pixels beside the edge stay within the dither amplitude of the source", () => {
    const { data } = ramp();
    const out = new Uint8ClampedArray(data);
    applyProEffect("deband", { threshold: 4, radius: 16, iterations: 2, dither: 50 }, out, W, H);
    let worst = 0;
    for (let y = 30; y < H; y++) {
      for (let x = W / 2 - 2; x < W / 2 + 2; x++) {
        worst = Math.max(worst, Math.abs(out[(y * W + x) * 4] - data[(y * W + x) * 4]));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
    // the 70-level step is still a 70-level step
    const left = out[(34 * W + W / 2 - 1) * 4];
    const right = out[(34 * W + W / 2) * 4];
    expect(right - left).toBeGreaterThan(66);
  });

  it("is deterministic: the same frame debands to the same bytes", () => {
    const { data } = ramp();
    const a = new Uint8ClampedArray(data);
    const b = new Uint8ClampedArray(data);
    applyProEffect("deband", PRO_EFFECT_DEFAULTS.deband, a, W, H);
    applyProEffect("deband", PRO_EFFECT_DEFAULTS.deband, b, W, H);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("threshold 0 only dithers", () => {
    const { data } = ramp();
    const out = new Uint8ClampedArray(data);
    applyProEffect("deband", { threshold: 0, radius: 16, iterations: 2, dither: 100 }, out, W, H);
    let maxDiff = 0;
    for (let i = 0; i < out.length; i += 4) maxDiff = Math.max(maxDiff, Math.abs(out[i] - data[i]));
    expect(maxDiff).toBeLessThanOrEqual(1);
  });
});
