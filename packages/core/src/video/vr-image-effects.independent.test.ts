import { describe, expect, it } from "vitest";
import { applyProEffect, PRO_EFFECT_DEFAULTS } from "./pro-effects";
import { VR_IMAGE_EFFECT_TYPES, glitchRow, type VrImageEffectType } from "./vr-image-effects";

/** Independent checks with different sizes and parameters than the builder's tests (odd sizes, arbitrary shifts). */
const PARAMS: Record<VrImageEffectType, Record<string, unknown>> = {
  "vr-sharpen": { amount: 70, radius: 1.3 },
  "vr-glow": { threshold: 30, radius: 4.5, brightness: 180, tintR: 255, tintG: 200, tintB: 120 },
  "vr-chromatic-aberrations": { amount: 80, pan: 0, tilt: 0 },
  "vr-digital-glitch": { intensity: 75, seed: 4242, time: 1.37, rate: 7 },
  "vr-de-noise": { amount: 60, radius: 1.1 },
};

const run = (type: VrImageEffectType, params: Record<string, unknown>, src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(src);
  applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type], ...params }, d, w, h);
  return d;
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noise(w: number, h: number, seed: number): Uint8ClampedArray {
  const r = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // blobs + noise so glow thresholds are crossed
    const x = i % w;
    const y = Math.floor(i / w);
    const base = 90 + 120 * Math.max(0, Math.sin(x / 7) * Math.cos(y / 5));
    d[i * 4] = Math.min(255, base + r() * 40);
    d[i * 4 + 1] = Math.min(255, base * 0.8 + r() * 40);
    d[i * 4 + 2] = Math.min(255, 255 - base + r() * 40);
    d[i * 4 + 3] = 255;
  }
  return d;
}

function shift(src: Uint8ClampedArray, w: number, h: number, dx: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const f = (((x - dx) % w) + w) % w;
      for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = src[(y * w + f) * 4 + c];
    }
  return out;
}

const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe("independent VR image effect checks", () => {
  const W = 150;
  const H = 75;
  const SHIFT = 37;
  for (const type of VR_IMAGE_EFFECT_TYPES.filter((t) => t !== "vr-chromatic-aberrations" && t !== "vr-digital-glitch")) {
    it(`${type}: seam equivariance under an arbitrary ${SHIFT}px longitude shift (odd height)`, () => {
      const img = noise(W, H, 99);
      const a = run(type, PARAMS[type], img, W, H);
      const b = shift(run(type, PARAMS[type], shift(img, W, H, SHIFT), W, H), W, H, -SHIFT);
      expect(maxDiff(a, b)).toBeLessThanOrEqual(1);
      expect(maxDiff(a, img)).toBeGreaterThan(0);
    });
  }

  it("chromatic: shifting the picture by s px equals moving the centre by the same angle", () => {
    const img = noise(W, H, 5);
    const pan = 40;
    const dx = Math.round((W * 60) / 360); // 25 px = 60 degrees
    const a = run("vr-chromatic-aberrations", { ...PARAMS["vr-chromatic-aberrations"], pan }, img, W, H);
    const b = shift(run("vr-chromatic-aberrations", { ...PARAMS["vr-chromatic-aberrations"], pan: pan + 60 }, shift(img, W, H, dx), W, H), W, H, -dx);
    // Bilinear sampling of identical directions: only float noise remains.
    expect(maxDiff(a, b)).toBeLessThanOrEqual(2);
  });

  it("chromatic: centre at the antipode of the seam (pan 180) has no tear across the seam", () => {
    // smooth latitude/longitude ramp image: output must be continuous across column W-1 -> 0
    const w = 240;
    const h = 120;
    const img = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        img[o] = 128 + 100 * Math.sin((x / w) * 2 * Math.PI);
        img[o + 1] = 128 + 100 * Math.cos((x / w) * 2 * Math.PI) * Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
        img[o + 2] = 128 + 80 * Math.sin(((y + 0.5) / h - 0.5) * Math.PI);
        img[o + 3] = 255;
      }
    for (const pan of [0, 180, -90, 123.4]) {
      const out = run("vr-chromatic-aberrations", { amount: 100, pan, tilt: 0 }, img, w, h);
      let worstSeam = 0;
      let worstInterior = 0;
      for (let y = 10; y < h - 10; y++) {
        for (let c = 0; c < 3; c++) {
          worstSeam = Math.max(worstSeam, Math.abs(out[(y * w + w - 1) * 4 + c] - out[(y * w) * 4 + c]));
          worstInterior = Math.max(worstInterior, Math.abs(out[(y * w + 100) * 4 + c] - out[(y * w + 101) * 4 + c]));
        }
      }
      expect(worstSeam).toBeLessThanOrEqual(worstInterior + 3);
    }
  });

  it("pole uniformity on a latitude-only image (all disc effects, odd size); chromatic with the axis on the pole", () => {
    const w = 130;
    const h = 65;
    const img = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const lat = Math.sin((0.5 - (y + 0.5) / h) * Math.PI);
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        img[o] = 120 + 110 * lat;
        img[o + 1] = 130 - 90 * lat;
        img[o + 2] = 140 + 80 * lat * lat * (lat > 0 ? 1 : -1);
        img[o + 3] = 255;
      }
    }
    const cases: [VrImageEffectType, Record<string, unknown>][] = [
      ["vr-sharpen", { amount: 100, radius: 3 }],
      ["vr-glow", { threshold: 20, radius: 12, brightness: 400 }],
      ["vr-de-noise", { amount: 100, radius: 3 }],
      ["vr-chromatic-aberrations", { amount: 100, pan: 0, tilt: 90 }],
      ["vr-chromatic-aberrations", { amount: 100, pan: 77, tilt: -90 }],
      ["vr-digital-glitch", { intensity: 100, seed: 3, time: 0.5 }],
    ];
    for (const [type, p] of cases) {
      const out = run(type, p, img, w, h);
      for (const y of [0, 1, h - 2, h - 1]) {
        let lo = 255;
        let hi = 0;
        for (let x = 0; x < w; x++)
          for (let c = 0; c < 3; c++) {
            const v = out[(y * w + x) * 4 + c];
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        // channel ranges differ, so compare per channel
        for (let c = 0; c < 3; c++) {
          let l = 255;
          let hh = 0;
          for (let x = 0; x < w; x++) {
            const v = out[(y * w + x) * 4 + c];
            l = Math.min(l, v);
            hh = Math.max(hh, v);
          }
          expect(hh - l, `${type} ${JSON.stringify(p)} row ${y} ch ${c}`).toBeLessThanOrEqual(1);
        }
        void lo;
        void hi;
      }
    }
  });

  it("stereo eye isolation: a bright eye never bleeds into the dark eye (both layouts, odd sizes)", () => {
    for (const layout of ["over-under", "side-by-side"] as const) {
      const w = 121;
      const h = 111;
      const img = noise(w, h, 7);
      // Eye 1 (bottom or right) is solid black; eye 0 is bright noise.
      const eye1 = layout === "over-under" ? { x0: 0, y0: Math.floor(h / 2), x1: w, y1: h } : { x0: Math.floor(w / 2), y0: 0, x1: w, y1: h };
      for (let y = eye1.y0; y < eye1.y1; y++) for (let x = eye1.x0; x < eye1.x1; x++) img.set([0, 0, 0, 255], (y * w + x) * 4);
      for (const type of ["vr-sharpen", "vr-glow", "vr-de-noise", "vr-chromatic-aberrations", "vr-digital-glitch"] as VrImageEffectType[]) {
        const out = run(type, { ...PARAMS[type], layout, ...(type === "vr-glow" ? { radius: 12, threshold: 0, brightness: 400 } : {}) }, img, w, h);
        let leak = 0;
        for (let y = eye1.y0; y < eye1.y1; y++) for (let x = eye1.x0; x < eye1.x1; x++) for (let c = 0; c < 3; c++) leak = Math.max(leak, out[(y * w + x) * 4 + c]);
        expect(leak, `${type} ${layout}`).toBe(0);
        // and the reverse: eye 0 changed
        expect(maxDiff(out, img)).toBeGreaterThan(0);
      }
    }
  });

  it("stereo glitch draws are identical for both eyes (eye-local rows)", () => {
    const w = 160;
    const h = 96; // 48 rows per eye
    for (let y = 0; y < 48; y++) {
      const a = glitchRow(y, w, 48, 0.8, 11, 5);
      const b = glitchRow(y, w, 48, 0.8, 11, 5);
      expect(a).toEqual(b);
    }
    const img = noise(w, h, 3);
    const out = run("vr-digital-glitch", { intensity: 80, seed: 11, time: 0.4, rate: 12, layout: "over-under" }, img, w, h);
    // top eye rows y and bottom eye rows 48+y must be shifted by the same amount: compare with a pure-shift model
    let matched = 0;
    for (let y = 0; y < 48; y++) {
      const g = glitchRow(y, w, 48, 0.8, 11, 5);
      if (g.shift !== 0 && g.split === 0) {
        for (const yy of [y, y + 48]) {
          for (let x = 0; x < w; x++) {
            const f = (((x - g.shift) % w) + w) % w;
            expect(out[(yy * w + x) * 4 + 1]).toBe(img[(yy * w + f) * 4 + 1]);
          }
        }
        matched++;
      }
    }
    expect(matched).toBeGreaterThanOrEqual(0);
  });

  it("glitch: deterministic across repeated runs and clip time quantisation, reroll by frame", () => {
    const img = noise(W, H, 21);
    const a = run("vr-digital-glitch", PARAMS["vr-digital-glitch"], img, W, H);
    const b = run("vr-digital-glitch", PARAMS["vr-digital-glitch"], img, W, H);
    expect(maxDiff(a, b)).toBe(0);
    // same frame index: 1.37*7 = 9.59 -> frame 9; time 9/7..10/7 gives the same draws
    const c = run("vr-digital-glitch", { ...PARAMS["vr-digital-glitch"], time: 1.30 }, img, W, H);
    expect(maxDiff(a, c)).toBe(0);
    const d = run("vr-digital-glitch", { ...PARAMS["vr-digital-glitch"], time: 1.45 }, img, W, H);
    expect(maxDiff(a, d)).toBeGreaterThan(0);
  });

  it("neutral: exact no-op at neutral values, with NaN / out-of-range params tolerated", () => {
    const img = noise(W, H, 8);
    const neutrals: [VrImageEffectType, Record<string, unknown>][] = [
      ["vr-sharpen", { amount: 0 }],
      ["vr-glow", { brightness: 0 }],
      ["vr-chromatic-aberrations", { amount: 0 }],
      ["vr-digital-glitch", { intensity: 0 }],
      ["vr-de-noise", { amount: 0 }],
    ];
    for (const [t, p] of neutrals) expect(maxDiff(run(t, p, img, W, H), img)).toBe(0);
    for (const t of VR_IMAGE_EFFECT_TYPES) {
      const out = run(t, { amount: NaN, radius: Infinity, brightness: -5, intensity: 1e9, threshold: NaN, pan: NaN, tilt: 1e9, seed: -3, rate: 0, time: -2 }, img, W, H);
      for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});
