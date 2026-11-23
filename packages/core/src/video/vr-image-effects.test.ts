import { describe, expect, it } from "vitest";
import { applyProEffect, isProEffectNeutral, isProEffectType, isTimeVaryingProEffect, PRO_EFFECT_DEFAULTS, proEffectGpuUniforms, validateProEffectParams, withProEffectTime } from "./pro-effects";
import { VR_IMAGE_EFFECT_TYPES, aberrateDir, glitchRow, vrGlitchFrame, vrHash, type VrImageEffectType } from "./vr-image-effects";
import { VR_IMAGE_GLSL } from "./vr-image-effect-shaders";
import { cameraRotation, dirFromEquirect, dirFromYawPitch, transpose3, yawPitchFromDir } from "../vr/vr-math";
import { smoothSphereImage } from "../vr/vr-test-images";

const W = 256;
const H = 128;

/** Params that make every effect clearly visible on the test images. */
const STRONG: Record<VrImageEffectType, Record<string, unknown>> = {
  "vr-sharpen": { amount: 100, radius: 2 },
  "vr-glow": { threshold: 40, radius: 6, brightness: 250 },
  "vr-chromatic-aberrations": { amount: 100, pan: 0, tilt: 0 },
  "vr-digital-glitch": { intensity: 90, seed: 7, time: 0.3, rate: 12 },
  "vr-de-noise": { amount: 80, radius: 1.5 },
};

const run = (type: VrImageEffectType, params: Record<string, unknown>, src: Uint8ClampedArray, w = W, h = H): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(src);
  applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type], ...params }, data, w, h);
  return data;
};

function shiftColumns(src: Uint8ClampedArray, w: number, h: number, dx: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (((x - dx) % w) + w) % w;
      for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = src[(y * w + from) * 4 + c];
    }
  }
  return out;
}

function maxDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function noisy(w: number, h: number, amp: number): Uint8ClampedArray {
  const base = smoothSphereImage(w, h);
  let s = 12345;
  const rnd = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < base.length; i++) if (i % 4 !== 3) base[i] = Math.max(0, Math.min(255, base[i] + (rnd() * 2 - 1) * amp));
  return base;
}

/** Colour is a function of latitude only: constant along every row. */
function latitudeOnly(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const lat = Math.sin((0.5 - (y + 0.5) / h) * Math.PI);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = 128 + 100 * lat;
      data[o + 1] = 128 - 60 * lat;
      data[o + 2] = 100 + 40 * lat * lat;
      data[o + 3] = 255;
    }
  }
  return data;
}

function rowSpread(data: Uint8ClampedArray, y: number, w = W): number {
  let m = 0;
  for (let c = 0; c < 3; c++) {
    let lo = 255;
    let hi = 0;
    for (let x = 0; x < w; x++) {
      const v = data[(y * w + x) * 4 + c];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    m = Math.max(m, hi - lo);
  }
  return m;
}

function seamJump(data: Uint8ClampedArray, w = W, h = H): number {
  let seam = 0;
  let interior = 0;
  for (let y = 4; y < h - 4; y++) {
    for (let ch = 0; ch < 3; ch++) {
      seam = Math.max(seam, Math.abs(data[(y * w + w - 1) * 4 + ch] - data[y * w * 4 + ch]));
      for (let x = 20; x < w - 20; x += 7) interior = Math.max(interior, Math.abs(data[(y * w + x) * 4 + ch] - data[(y * w + x + 1) * 4 + ch]));
    }
  }
  return seam / Math.max(interior, 1);
}

describe("VR image effects registration", () => {
  it("are pro effects with specs, defaults, shaders and agent validation", () => {
    for (const type of VR_IMAGE_EFFECT_TYPES) {
      expect(isProEffectType(type)).toBe(true);
      expect(PRO_EFFECT_DEFAULTS[type]).toBeTruthy();
      expect(VR_IMAGE_GLSL[type]).toContain("#version 300 es");
      expect(validateProEffectParams(type, {})).toBeNull();
      expect(validateProEffectParams(type, { layout: "cube" })).toMatch(/one of/);
      expect(Object.keys(proEffectGpuUniforms(type, {}, 100)).length).toBeGreaterThan(1);
    }
    expect(validateProEffectParams("vr-sharpen", { amount: 500 })).toMatch(/within/);
  });

  it("are exact no-ops at their neutral parameters", () => {
    const src = noisy(64, 32, 20);
    const neutral: Record<VrImageEffectType, Record<string, unknown>> = {
      "vr-sharpen": { amount: 0 },
      "vr-glow": { brightness: 0 },
      "vr-chromatic-aberrations": { amount: 0 },
      "vr-digital-glitch": { intensity: 0 },
      "vr-de-noise": { amount: 0 },
    };
    for (const type of VR_IMAGE_EFFECT_TYPES) {
      expect(isProEffectNeutral(type, neutral[type])).toBe(true);
      expect(isProEffectNeutral(type, STRONG[type])).toBe(false);
      expect(Array.from(run(type, neutral[type], src, 64, 32))).toEqual(Array.from(src));
    }
  });

  it("only the glitch is time driven, and the renderer's clip time re-rolls it", () => {
    expect(isTimeVaryingProEffect({ type: "vr-digital-glitch", params: { intensity: 50 } })).toBe(true);
    expect(isTimeVaryingProEffect({ type: "vr-sharpen", params: { amount: 50 } })).toBe(false);
    const [timed] = withProEffectTime([{ type: "vr-digital-glitch", params: { time: 1 } }], 2.5);
    expect(timed.params.time).toBeCloseTo(3.5, 9);
  });
});

describe("each effect does what it says", () => {
  it("VR Sharpen steepens a soft edge and keeps flat areas", () => {
    const soft = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; soft[o] = soft[o + 1] = soft[o + 2] = Math.round(255 / (1 + Math.exp(-(x - 100) / 4))); soft[o + 3] = 255; }
    const out = run("vr-sharpen", { amount: 100, radius: 1.5 }, soft);
    const row = 64;
    expect(out[(row * W + 105) * 4]).toBeGreaterThan(soft[(row * W + 105) * 4]);
    expect(out[(row * W + 95) * 4]).toBeLessThan(soft[(row * W + 95) * 4]);
    expect(out[(row * W + 30) * 4]).toBe(soft[(row * W + 30) * 4]);
    expect(out[3]).toBe(255);
  });

  it("VR Glow bleeds light from a bright spot over the seam and not from dark areas", () => {
    const img = new Uint8ClampedArray(W * H * 4);
    for (let i = 3; i < img.length; i += 4) img[i] = 255;
    for (let y = 62; y < 66; y++) for (let x = 0; x < 3; x++) img[(y * W + x) * 4] = img[(y * W + x) * 4 + 1] = img[(y * W + x) * 4 + 2] = 255;
    const out = run("vr-glow", { threshold: 50, radius: 14, brightness: 300 }, img);
    // Light spreads to both sides of the seam symmetrically.
    const left = out[(64 * W + 5) * 4];
    const right = out[(64 * W + W - 4) * 4];
    expect(left).toBeGreaterThan(20);
    expect(right).toBeGreaterThan(20);
    // Far from the spot nothing changes (the glow is local) and the picture is never darkened.
    expect(out[(64 * W + 128) * 4]).toBe(0);
    for (let i = 0; i < img.length; i += 4) expect(out[i]).toBeGreaterThanOrEqual(img[i]);
    // Threshold above everything: nothing glows.
    expect(Array.from(run("vr-glow", { threshold: 100, brightness: 400 }, img))).toEqual(Array.from(img));
  });

  it("VR Glow tint colours the glow", () => {
    const img = new Uint8ClampedArray(W * H * 4);
    for (let i = 3; i < img.length; i += 4) img[i] = 255;
    for (let y = 60; y < 68; y++) for (let x = 120; x < 128; x++) img[(y * W + x) * 4] = img[(y * W + x) * 4 + 1] = img[(y * W + x) * 4 + 2] = 255;
    const out = run("vr-glow", { threshold: 50, radius: 12, brightness: 300, tintR: 255, tintG: 0, tintB: 0 }, img);
    const o = (64 * W + 130) * 4;
    expect(out[o]).toBeGreaterThan(10);
    expect(out[o + 1]).toBe(0);
    expect(out[o + 2]).toBe(0);
  });

  it("VR Chromatic Aberrations fringes grow with the angle from the centre and vanish on the axis", () => {
    const grid = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; grid[o] = grid[o + 1] = grid[o + 2] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 255 : 0; grid[o + 3] = 255; }
    const out = run("vr-chromatic-aberrations", { amount: 100, pan: 0, tilt: 0 }, grid);
    const misalign = (cx: number): number => {
      let s = 0;
      for (let y = 40; y < 90; y++) for (let x = cx - 12; x < cx + 12; x++) s += Math.abs(out[(y * W + x) * 4] - out[(y * W + x) * 4 + 2]);
      return s;
    };
    expect(misalign(128 + 1)).toBeLessThan(misalign(128 + 70));
    // The direction maths: a zero scale is the identity, and the angle from the axis is scaled.
    const rot = cameraRotation(0, 0, 0);
    const d = dirFromYawPitch(40, 10);
    const same = aberrateDir(d, rot, transpose3(rot), 0);
    expect(Math.hypot(same[0] - d[0], same[1] - d[1], same[2] - d[2])).toBeLessThan(1e-12);
    const wide = yawPitchFromDir(aberrateDir(dirFromYawPitch(30, 0), rot, transpose3(rot), 0.1));
    expect(wide.yaw).toBeCloseTo(33, 6);
  });

  it("VR De-Noise removes noise but keeps a hard edge", () => {
    const img = new Uint8ClampedArray(W * H * 4);
    let s = 99;
    const rnd = (): number => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; const base = x < 128 ? 60 : 190; const v = base + (rnd() - 0.5) * 30; img[o] = img[o + 1] = img[o + 2] = v; img[o + 3] = 255; }
    const out = run("vr-de-noise", { amount: 30, radius: 2 }, img);
    const variance = (a: Uint8ClampedArray): number => { let m = 0; let n = 0; for (let y = 50; y < 80; y++) for (let x = 20; x < 100; x++) { m += a[(y * W + x) * 4]; n++; } m /= n; let v = 0; for (let y = 50; y < 80; y++) for (let x = 20; x < 100; x++) v += (a[(y * W + x) * 4] - m) ** 2; return v / n; };
    expect(variance(out)).toBeLessThan(variance(img) * 0.5);
    expect(out[(64 * W + 120) * 4]).toBeLessThan(90);
    expect(out[(64 * W + 136) * 4]).toBeGreaterThan(160);
  });

  it("VR Digital Glitch moves bands in longitude only: rows keep their pixels, just rotated", () => {
    const src = noisy(W, H, 0);
    const out = run("vr-digital-glitch", STRONG["vr-digital-glitch"], src);
    expect(maxDiff(out, src)).toBeGreaterThan(20);
    let moved = 0;
    for (let y = 0; y < H; y++) {
      const row = glitchRow(y, W, H, 0.9, 7, vrGlitchFrame(0.3, 12));
      if (row.shift === 0) continue;
      moved++;
      // Green is the unsplit channel: exactly the row shifted by `shift` columns.
      for (const x of [0, 17, 200, W - 1]) expect(out[(y * W + x) * 4 + 1]).toBe(src[(y * W + (((x - row.shift) % W) + W) % W) * 4 + 1]);
    }
    expect(moved).toBeGreaterThan(5);
  });
});

describe("seam continuity: an image and the same image rotated half a turn give the same result after unshifting", () => {
  const img = noisy(W, H, 6);
  const shifted = shiftColumns(img, W, H, W / 2);
  for (const type of VR_IMAGE_EFFECT_TYPES) {
    it(type, () => {
      const params = STRONG[type];
      const a = run(type, params, img);
      if (type === "vr-chromatic-aberrations") {
        // The aberration centre is a place on the sphere: rotating the picture half a turn is the same as moving the centre half a turn.
        const b = shiftColumns(run(type, { ...params, pan: 0 }, shifted), W, H, -W / 2);
        const c = run(type, { ...params, pan: 180 }, img);
        expect(maxDiff(b, c)).toBeLessThanOrEqual(1);
        return;
      }
      const b = shiftColumns(run(type, params, shifted), W, H, -W / 2);
      expect(maxDiff(a, b)).toBeLessThanOrEqual(1);
    });
    it(`${type}: no discontinuity at 0/360 on a smooth sphere image`, () => {
      const smooth = smoothSphereImage(W, H);
      const out = run(type, type === "vr-digital-glitch" ? { ...STRONG[type], intensity: 0.5 } : STRONG[type], smooth);
      expect(seamJump(out)).toBeLessThan(type === "vr-digital-glitch" ? 3 : 1.6);
    });
  }
});

describe("pole handling: a picture that only varies with latitude stays constant along every row", () => {
  const lat = latitudeOnly(W, H);
  for (const type of ["vr-sharpen", "vr-glow", "vr-de-noise", "vr-digital-glitch"] as const) {
    it(type, () => {
      const out = run(type, STRONG[type], lat);
      for (const y of [0, 1, 2, H - 3, H - 2, H - 1, 64]) expect(rowSpread(out, y), `row ${y}`).toBeLessThanOrEqual(1);
    });
  }
  it("vr-chromatic-aberrations with the centre on a pole is constant per row; elsewhere nearly so", () => {
    const polar = run("vr-chromatic-aberrations", { amount: 100, pan: 0, tilt: 90 }, lat);
    for (const y of [0, 1, H - 1, 64]) expect(rowSpread(polar, y)).toBeLessThanOrEqual(1);
    const fwd = run("vr-chromatic-aberrations", { amount: 100, pan: 0, tilt: 0 }, lat);
    for (const y of [0, H - 1]) expect(rowSpread(fwd, y)).toBeLessThanOrEqual(4);
    for (let i = 3; i < fwd.length; i += 4) expect(fwd[i]).toBe(255);
  });
});

describe("stereo eyes are never mixed", () => {
  const eyes = (layout: "over-under" | "side-by-side"): Uint8ClampedArray => {
    const w = 128;
    const h = 128;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const first = layout === "over-under" ? y < h / 2 : x < w / 2;
        const o = (y * w + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = first ? 0 : 255;
        data[o + 3] = 255;
      }
    }
    return data;
  };
  for (const layout of ["over-under", "side-by-side"] as const) {
    for (const type of VR_IMAGE_EFFECT_TYPES) {
      it(`${type} (${layout}): one flat eye stays flat`, () => {
        const src = eyes(layout);
        // Flat eyes: any leak of the other eye through the shared edge or the poles would change them.
        const out = run(type, { ...STRONG[type], layout, ...(type === "vr-glow" ? { threshold: 10 } : {}) }, src, 128, 128);
        let worst = 0;
        for (let i = 0; i < src.length; i += 4) {
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[i + c] - src[i + c]));
        }
        // Glow adds light to the bright eye only if it is below white: it is white, so nothing changes at all.
        expect(worst).toBeLessThanOrEqual(1);
      });
    }
    it(`the dark eye of a glow frame never receives the bright eye's light (${layout})`, () => {
      const src = new Uint8ClampedArray(eyes(layout));
      // Bright dot at the edge of the second eye next to the first.
      const w = 128;
      for (let y = 0; y < 128; y++) for (let x = 0; x < w; x++) {
        const first = layout === "over-under" ? y < 64 : x < 64;
        const o = (y * w + x) * 4;
        const near = layout === "over-under" ? y >= 64 && y < 70 : x >= 64 && x < 70;
        src[o] = src[o + 1] = src[o + 2] = first ? 0 : near ? 255 : 0;
      }
      const out = run("vr-glow", { layout, threshold: 40, radius: 12, brightness: 400 }, src, 128, 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < w; x++) {
        const first = layout === "over-under" ? y < 64 : x < 64;
        if (first) expect(out[(y * w + x) * 4]).toBe(0);
      }
      expect(out[((layout === "over-under" ? 71 : 40) * w + (layout === "over-under" ? 40 : 71)) * 4]).toBeGreaterThan(0);
    });
  }
});

describe("VR Digital Glitch is deterministic", () => {
  const src = smoothSphereImage(W, H);
  const base = { intensity: 70, seed: 5, rate: 10, time: 1.23 };
  it("same seed and time give the same picture, any number of times", () => {
    const a = run("vr-digital-glitch", base, src);
    expect(Array.from(run("vr-digital-glitch", base, src))).toEqual(Array.from(a));
    expect(vrHash(5, 12, 3)).toBe(vrHash(5, 12, 3));
  });
  it("a different seed or a different frame gives a different picture; the same frame holds", () => {
    const a = run("vr-digital-glitch", base, src);
    expect(maxDiff(a, run("vr-digital-glitch", { ...base, seed: 6 }, src))).toBeGreaterThan(10);
    expect(maxDiff(a, run("vr-digital-glitch", { ...base, time: 1.23 + 0.5 }, src))).toBeGreaterThan(10);
    // 1.23 s and 1.29 s are both frame 12 at 10 changes per second.
    expect(Array.from(run("vr-digital-glitch", { ...base, time: 1.29 }, src))).toEqual(Array.from(a));
  });
  it("is hashed like the shader (bit-exact integer hash)", () => {
    expect(vrHash(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(vrHash(1, 2, 3)).toBeLessThan(1);
    expect(VR_IMAGE_GLSL["vr-digital-glitch"]).toContain("374761393u");
    expect(dirFromEquirect(0.5, 0.5)[2]).toBeCloseTo(1, 9);
  });
});
