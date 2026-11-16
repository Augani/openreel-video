import { describe, expect, it } from "vitest";
import {
  EXTRA_PRO_EFFECT_SPECS,
  EXTRA_PRO_EFFECT_TYPES,
  cornerPinInverse,
  discSampleCount,
  ripplePhase,
  strobeOn,
} from "./pro-effects-extra";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_KEYFRAME_PROPERTIES,
  PRO_EFFECT_NEUTRAL_PARAMS,
  PRO_EFFECT_SPECS,
  applyProEffect,
  isTimeVaryingProEffect,
  proEffectGpuUniforms,
  validateProEffectParams,
  withProEffectTime,
} from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";

const W = 24;
const H = 16;

function solid(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([r, g, b, a], i * 4);
  return d;
}

function card(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      d.set([(x * 10) % 256, (y * 16) % 256, (x * y * 3) % 256, 255], (y * W + x) * 4);
    }
  }
  return d;
}

const at = (d: Uint8ClampedArray, x: number, y: number): number[] =>
  Array.from(d.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

describe("wave 7 effect catalogue", () => {
  it("adds at least 25 effects, each with a shader, defaults and neutral params", () => {
    expect(EXTRA_PRO_EFFECT_TYPES.length).toBeGreaterThanOrEqual(25);
    for (const type of EXTRA_PRO_EFFECT_TYPES) {
      expect(PRO_EFFECT_SPECS[type]).toBe(EXTRA_PRO_EFFECT_SPECS[type]);
      expect(PRO_EFFECT_SHADER_DEFS[type].glsl).toContain("#version 300 es");
      expect(Object.keys(PRO_EFFECT_DEFAULTS[type]).length).toBeGreaterThan(0);
      expect(Object.keys(PRO_EFFECT_NEUTRAL_PARAMS[type])).toEqual(Object.keys(PRO_EFFECT_DEFAULTS[type]));
    }
  });

  it("every numeric parameter is range-checked and default and neutral sit inside the range", () => {
    for (const type of EXTRA_PRO_EFFECT_TYPES) {
      for (const p of EXTRA_PRO_EFFECT_SPECS[type].params) {
        if (p.kind !== "number") continue;
        expect(p.default as number, `${type}.${p.key}`).toBeGreaterThanOrEqual(p.min as number);
        expect(p.default as number, `${type}.${p.key}`).toBeLessThanOrEqual(p.max as number);
        expect(p.neutral as number, `${type}.${p.key}`).toBeGreaterThanOrEqual(p.min as number);
        expect(p.neutral as number, `${type}.${p.key}`).toBeLessThanOrEqual(p.max as number);
      }
      expect(validateProEffectParams(type, PRO_EFFECT_DEFAULTS[type])).toBeNull();
    }
    expect(validateProEffectParams("camera-blur", { radius: 999 })).toMatch(/within/);
    expect(validateProEffectParams("luma-key", { mode: "sideways" })).toMatch(/one of/);
  });

  it("keyframes every numeric parameter except time and seed", () => {
    const ids = PRO_EFFECT_KEYFRAME_PROPERTIES.map((p) => p.id);
    expect(ids).toContain("effect.camera-blur.radius");
    expect(ids).toContain("effect.corner-pin.x2");
    expect(ids).toContain("effect.twirl.angle");
    expect(ids).not.toContain("effect.noise.seed");
    expect(ids).not.toContain("effect.ripple.time");
    expect(ids).not.toContain("effect.luma-key.mode");
  });

  it("offers the new effects across Blur, Keying, Color, Distort, Stylize and Generate", () => {
    const categories = new Set(EXTRA_PRO_EFFECT_TYPES.map((t) => EXTRA_PRO_EFFECT_SPECS[t].category));
    expect([...categories].sort()).toEqual(["Blur", "Color", "Distort", "Generate", "Keying", "Stylize"]);
  });
});

describe("wave 7 effect behaviour", () => {
  it("camera blur leaves a flat image alone and softens an edge", () => {
    const flat = solid(90, 120, 200);
    applyProEffect("camera-blur", { radius: 6 }, flat, W, H);
    expect(at(flat, 5, 5)).toEqual([90, 120, 200, 255]);
    const edge = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) edge.set(x < W / 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * W + x) * 4);
    applyProEffect("camera-blur", { radius: 5 }, edge, W, H);
    const mid = at(edge, W / 2, 8)[0];
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(235);
    expect(discSampleCount(60)).toBeLessThanOrEqual(96);
  });

  it("camera blur and tilt shift keep colour straight at transparent edges (no dark halo)", () => {
    for (const [type, params] of [
      ["camera-blur", { radius: 5 }],
      ["tilt-shift", { blur: 6, center: 50, focus: 0, falloff: 1 }],
    ] as const) {
      const img = new Uint8ClampedArray(W * H * 4);
      // white opaque left half, fully transparent right half stored as rgb 0
      for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) img.set([255, 255, 255, 255], (y * W + x) * 4);
      applyProEffect(type, params, img, W, H);
      const edge = at(img, W / 2 - 1, 8);
      expect(edge[3]).toBeGreaterThan(0);
      expect(edge[0]).toBeGreaterThanOrEqual(225);
      expect(at(img, W / 2 + 1, 8)[0]).toBeGreaterThanOrEqual(225);
    }
  });

  it("channel blur only touches the channels with a radius", () => {
    const img = card();
    const before = new Uint8ClampedArray(img);
    applyProEffect("channel-blur", { red: 4, green: 0, blue: 0, alpha: 0 }, img, W, H);
    let redChanged = false;
    for (let i = 0; i < W * H; i++) {
      expect(img[i * 4 + 1]).toBe(before[i * 4 + 1]);
      expect(img[i * 4 + 2]).toBe(before[i * 4 + 2]);
      if (img[i * 4] !== before[i * 4]) redChanged = true;
    }
    expect(redChanged).toBe(true);
  });

  it("tilt-shift keeps the focus band sharp and blurs the far rows", () => {
    const img = card();
    const before = new Uint8ClampedArray(img);
    applyProEffect("tilt-shift", { blur: 6, angle: 0, center: 50, focus: 30, falloff: 20 }, img, W, H);
    expect(at(img, 7, 8)).toEqual(at(before, 7, 8));
    expect(at(img, 7, 0)).not.toEqual(at(before, 7, 0));
  });

  it("luma key removes dark pixels (key out darker) and keeps bright ones", () => {
    const img = new Uint8ClampedArray([5, 5, 5, 255, 240, 240, 240, 255]);
    applyProEffect("luma-key", { mode: "darker", threshold: 20, softness: 0 }, img, 2, 1);
    expect(img[3]).toBe(0);
    expect(img[7]).toBe(255);
    const bright = new Uint8ClampedArray([5, 5, 5, 255, 240, 240, 240, 255]);
    applyProEffect("luma-key", { mode: "brighter", threshold: 80, softness: 0 }, bright, 2, 1);
    expect(bright[3]).toBe(255);
    expect(bright[7]).toBe(0);
  });

  it("color key clears the key colour, keeps others, and invert flips that", () => {
    const px = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255]);
    const keyed = new Uint8ClampedArray(px);
    applyProEffect("color-key", { keyR: 0, keyG: 255, keyB: 0, tolerance: 20, softness: 0 }, keyed, 2, 1);
    expect([keyed[3], keyed[7]]).toEqual([0, 255]);
    const inv = new Uint8ClampedArray(px);
    applyProEffect("color-key", { keyR: 0, keyG: 255, keyB: 0, tolerance: 20, softness: 0, invert: true }, inv, 2, 1);
    expect([inv[3], inv[7]]).toEqual([255, 0]);
  });

  it("alpha adjust inverts, ignores and shows the matte", () => {
    const img = new Uint8ClampedArray([10, 20, 30, 64]);
    applyProEffect("alpha-adjust", { opacity: 100, invert: true }, img, 1, 1);
    expect(img[3]).toBe(191);
    const matte = new Uint8ClampedArray([10, 20, 30, 128]);
    applyProEffect("alpha-adjust", { opacity: 100, matte: true }, matte, 1, 1);
    expect(Array.from(matte)).toEqual([128, 128, 128, 255]);
    const ign = new Uint8ClampedArray([10, 20, 30, 0]);
    applyProEffect("alpha-adjust", { opacity: 100, ignore: true, matte: false, invert: false }, ign, 1, 1);
    expect(ign[3]).toBe(255);
  });

  it("leave color keeps the chosen colour and greys the rest", () => {
    const img = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    applyProEffect("leave-color", { keyR: 255, keyG: 0, keyB: 0, amount: 100, tolerance: 20, softness: 10 }, img, 2, 1);
    expect(Array.from(img.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(img[4]).toBe(img[5]);
    expect(img[5]).toBe(img[6]);
  });

  it("change to color shifts the matched range by the colour delta", () => {
    const img = new Uint8ClampedArray([0, 200, 0, 255, 200, 0, 0, 255]);
    applyProEffect(
      "change-to-color",
      { fromR: 0, fromG: 200, fromB: 0, toR: 0, toG: 0, toB: 200, tolerance: 10, softness: 0 },
      img,
      2,
      1,
    );
    expect(Array.from(img.slice(0, 3))).toEqual([0, 0, 200]);
    expect(Array.from(img.slice(4, 7))).toEqual([200, 0, 0]);
  });

  it("solarize inverts only the values above the threshold", () => {
    const img = new Uint8ClampedArray([200, 50, 120, 255]);
    applyProEffect("solarize", { threshold: 50 }, img, 1, 1);
    expect(Array.from(img)).toEqual([55, 50, 120, 255]);
  });

  it("levels maps the input range onto the output range", () => {
    const img = new Uint8ClampedArray([64, 128, 192, 255]);
    applyProEffect("levels", { inBlack: 64, inWhite: 192, gamma: 1, outBlack: 0, outWhite: 255 }, img, 1, 1);
    expect(Array.from(img.slice(0, 3))).toEqual([0, 128, 255]);
  });

  it("channel mixer swaps red and blue and can go monochrome", () => {
    const swap = new Uint8ClampedArray([10, 20, 30, 255]);
    applyProEffect("channel-mixer", { rr: 0, rg: 0, rb: 100, gr: 0, gg: 100, gb: 0, br: 100, bg: 0, bb: 0 }, swap, 1, 1);
    expect(Array.from(swap)).toEqual([30, 20, 10, 255]);
    const mono = new Uint8ClampedArray([200, 100, 50, 255]);
    applyProEffect("channel-mixer", { rr: 100, gg: 100, bb: 100, rg: 0, rb: 0, gr: 0, gb: 0, br: 0, bg: 0, mono: true }, mono, 1, 1);
    expect(mono[0]).toBe(mono[1]);
    expect(mono[1]).toBe(mono[2]);
  });

  it("tint maps black and white to the two colours", () => {
    const img = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    applyProEffect("tint-map", { blackR: 10, blackG: 20, blackB: 60, whiteR: 250, whiteG: 230, whiteB: 190, amount: 100 }, img, 2, 1);
    expect(Array.from(img.slice(0, 3))).toEqual([10, 20, 60]);
    expect(Array.from(img.slice(4, 7))).toEqual([250, 230, 190]);
  });

  it("spherize and twirl keep the area outside their radius and move the inside", () => {
    for (const [type, params] of [
      ["spherize", { amount: 80, radius: 60 }],
      ["twirl", { angle: 200, radius: 60 }],
    ] as const) {
      const img = card();
      const before = new Uint8ClampedArray(img);
      applyProEffect(type, params, img, W, H);
      expect(at(img, 0, 0), type).toEqual(at(before, 0, 0));
      expect(at(img, W - 1, H - 1), type).toEqual(at(before, W - 1, H - 1));
      expect(at(img, 14, 6), type).not.toEqual(at(before, 14, 6));
    }
  });

  it("ripple is static at speed 0 and its phase advances with time", () => {
    expect(ripplePhase(0, 0, 5)).toBe(0);
    expect(ripplePhase(90, 1, 0.25)).toBeCloseTo(Math.PI, 6);
    const a = card();
    const b = card();
    applyProEffect("ripple", { amplitude: 3, wavelength: 12, speed: 1, time: 0 }, a, W, H);
    applyProEffect("ripple", { amplitude: 3, wavelength: 12, speed: 1, time: 0.25 }, b, W, H);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(isTimeVaryingProEffect({ type: "ripple", enabled: true, params: { amplitude: 3, speed: 0 } })).toBe(false);
    expect(isTimeVaryingProEffect({ type: "ripple", enabled: true, params: { amplitude: 3, speed: 1 } })).toBe(true);
  });

  it("turbulent displace is deterministic per seed and differs between seeds", () => {
    const run = (seed: number): number[] => {
      const img = card();
      applyProEffect("turbulent-displace", { amount: 6, size: 8, complexity: 2, seed }, img, W, H);
      return Array.from(img);
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  it("offset wraps around by whole pixels, repeats the edge or leaves a gap", () => {
    const img = card();
    const before = new Uint8ClampedArray(img);
    applyProEffect("offset", { shiftX: 25, shiftY: 0, edge: "wrap" }, img, W, H);
    expect(at(img, 6, 3)).toEqual(at(before, 0, 3));
    expect(at(img, 0, 3)).toEqual(at(before, W - 6, 3));
    const gap = new Uint8ClampedArray(before);
    applyProEffect("offset", { shiftX: 25, edge: "transparent" }, gap, W, H);
    expect(at(gap, 2, 3)[3]).toBe(0);
    const clamped = new Uint8ClampedArray(before);
    applyProEffect("offset", { shiftX: 25, edge: "clamp" }, clamped, W, H);
    expect(at(clamped, 2, 3)).toEqual(at(before, 0, 3));
  });

  it("corner pin homography maps the pinned corners back onto the unit square", () => {
    const neutral = cornerPinInverse({ x0: 0, y0: 0, x1: 100, y1: 0, x2: 100, y2: 100, x3: 0, y3: 100 });
    expect(neutral?.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const quad = { x0: 10, y0: 8, x1: 92, y1: 0, x2: 100, y2: 100, x3: 0, y3: 92 };
    const h = cornerPinInverse(quad)!;
    const project = (x: number, y: number): [number, number] => {
      const w = h[6] * x + h[7] * y + h[8];
      return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
    };
    const corners: [number, number][] = [[0.1, 0.08], [0.92, 0], [1, 1], [0, 0.92]];
    const expected: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach(([x, y], i) => {
      const [u, v] = project(x, y);
      expect(u).toBeCloseTo(expected[i][0], 6);
      expect(v).toBeCloseTo(expected[i][1], 6);
    });
  });

  it("corner pin leaves transparent area outside the pinned quad", () => {
    const img = card();
    applyProEffect("corner-pin", { ...PRO_EFFECT_DEFAULTS["corner-pin"], x0: 40, y0: 40 }, img, W, H);
    expect(at(img, 0, 0)[3]).toBe(0);
    expect(at(img, 18, 10)[3]).toBe(255);
  });

  it("replicate tiles the picture count x count times", () => {
    const img = card();
    const before = new Uint8ClampedArray(img);
    applyProEffect("replicate", { count: 2 }, img, W, H);
    expect(at(img, 3, 2)).toEqual(at(before, 6, 4));
    expect(at(img, 3 + W / 2, 2 + H / 2)).toEqual(at(before, 6, 4));
  });

  it("polar coordinates at 0% is the identity and changes the picture at 100%", () => {
    const img = card();
    const before = new Uint8ClampedArray(img);
    applyProEffect("polar-coordinates", { amount: 0 }, img, W, H);
    expect(Array.from(img)).toEqual(Array.from(before));
    applyProEffect("polar-coordinates", { amount: 100 }, img, W, H);
    expect(Array.from(img)).not.toEqual(Array.from(before));
  });

  it("noise is deterministic for a time and animates between frames", () => {
    const run = (time: number): number[] => {
      const img = solid(128, 128, 128);
      applyProEffect("noise", { amount: 30, time }, img, W, H);
      return Array.from(img);
    };
    expect(run(0.5)).toEqual(run(0.5));
    expect(run(0.5)).not.toEqual(run(1.5));
    const mono = solid(128, 128, 128);
    applyProEffect("noise", { amount: 30, mono: true, time: 0 }, mono, W, H);
    expect(mono[0]).toBe(mono[1]);
    expect(mono[1]).toBe(mono[2]);
  });

  it("bevel alpha shades the frame border of an opaque image and leaves the centre", () => {
    const img = solid(120, 120, 120);
    applyProEffect("bevel-alpha", { thickness: 4, angle: 135, intensity: 100 }, img, W, H);
    expect(at(img, 12, 8)).toEqual([120, 120, 120, 255]);
    expect(at(img, 0, 8)[0]).not.toBe(120);
  });

  it("gradient, flare and grid add colour while strobe only flashes inside its window", () => {
    const base = solid(60, 60, 60);
    for (const type of ["four-color-gradient", "lens-flare", "grid"] as const) {
      const img = new Uint8ClampedArray(base);
      applyProEffect(type, { ...PRO_EFFECT_DEFAULTS[type] }, img, W, H);
      expect(Array.from(img), type).not.toEqual(Array.from(base));
    }
    expect(strobeOn(0, 0.5, 0.1, 0.05)).toBe(1);
    expect(strobeOn(0.25, 0.5, 0.1, 0.05)).toBe(0);
    expect(strobeOn(0.45, 0.5, 0.1, 0.05)).toBe(1);
    const off = new Uint8ClampedArray(base);
    applyProEffect("strobe-light", { ...PRO_EFFECT_DEFAULTS["strobe-light"], time: 0.25 }, off, W, H);
    expect(Array.from(off)).toEqual(Array.from(base));
    const on = new Uint8ClampedArray(base);
    applyProEffect("strobe-light", { ...PRO_EFFECT_DEFAULTS["strobe-light"], time: 0.45 }, on, W, H);
    expect(on[0]).toBeGreaterThan(60);
  });

  it("adds the clip-local time to the time-driven wave 7 effects", () => {
    const fx = [
      { type: "noise", params: { amount: 20, time: 1 } },
      { type: "strobe-light", params: { opacity: 50 } },
      { type: "camera-blur", params: { radius: 3 } },
    ];
    const out = withProEffectTime(fx, 2);
    expect(out[0].params.time).toBe(3);
    expect(out[1].params.time).toBe(2);
    expect(out[2]).toBe(fx[2]);
    expect(proEffectGpuUniforms("noise", { amount: 20, time: 3 }, 100).frame).toBe(72);
  });
});
