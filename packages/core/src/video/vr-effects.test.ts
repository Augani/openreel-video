import { describe, expect, it } from "vitest";
import {
  applyProEffect,
  isProEffectNeutral,
  isProEffectType,
  PRO_EFFECT_DEFAULTS,
  proEffectGpuUniforms,
  withProEffectDefaults,
  validateProEffectParams,
} from "./pro-effects";
import { getAnimatedVideoEffects } from "./animated-video-effects";
import { effectInstanceKeyframeProperty } from "./effect-instance-keyframes";
import { VR_PRO_EFFECT_TYPES, vrEffectMatrix, planeUv } from "./vr-effects";
import {
  dirFromEquirect,
  dirFromYawPitch,
  equirectFromDir,
  yawPitchFromDir,
  type Vec3,
} from "../vr/vr-math";
import { smoothSphereImage } from "../vr/vr-test-images";
import type { Clip } from "../types/timeline";

const W = 256;
const H = 128;

function dotImage(yaw: number, pitch: number, w = W, h = H, radius = 3): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const target = dirFromYawPitch(yaw, pitch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = dirFromEquirect((x + 0.5) / w, (y + 0.5) / h);
      const dot = d[0] * target[0] + d[1] * target[1] + d[2] * target[2];
      const ang = Math.acos(Math.min(1, dot));
      const px = (ang / Math.PI) * h;
      if (px < radius) {
        const o = (y * w + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = Math.round(255 * (1 - px / radius));
      }
    }
  }
  return data;
}

/** Brightness-weighted mean direction of the image, as yaw / pitch (robust across the seam and poles). */
function centroid(data: Uint8ClampedArray, w = W, h = H): { yaw: number; pitch: number } {
  let sum: Vec3 = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[(y * w + x) * 4];
      if (v < 8) continue;
      const d = dirFromEquirect((x + 0.5) / w, (y + 0.5) / h);
      sum = [sum[0] + d[0] * v, sum[1] + d[1] * v, sum[2] + d[2] * v];
    }
  }
  const len = Math.hypot(sum[0], sum[1], sum[2]) || 1;
  return yawPitchFromDir([sum[0] / len, sum[1] / len, sum[2] / len]);
}

const rotate = (params: Record<string, unknown>, src: Uint8ClampedArray, w = W, h = H): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(src);
  applyProEffect("vr-rotate-sphere", { layout: "mono", pan: 0, tilt: 0, roll: 0, ...params }, data, w, h);
  return data;
};

describe("VR effects registration", () => {
  it("are pro effects with specs, defaults and agent validation", () => {
    for (const type of VR_PRO_EFFECT_TYPES) {
      expect(isProEffectType(type)).toBe(true);
      expect(PRO_EFFECT_DEFAULTS[type]).toBeTruthy();
      expect(validateProEffectParams(type, {})).toBeNull();
    }
    expect(validateProEffectParams("vr-rotate-sphere", { pan: 400 })).toMatch(/within/);
    expect(validateProEffectParams("vr-projection", { mode: "cube" })).toMatch(/one of/);
  });

  it("are exact no-ops at their neutral parameters", () => {
    const src = smoothSphereImage(64, 32);
    for (const type of VR_PRO_EFFECT_TYPES) {
      expect(isProEffectNeutral(type, {})).toBe(true);
      const data = new Uint8ClampedArray(src);
      applyProEffect(type, {}, data, 64, 32);
      expect(Array.from(data)).toEqual(Array.from(src));
    }
    expect(isProEffectNeutral("vr-rotate-sphere", { pan: 360 })).toBe(true);
    expect(isProEffectNeutral("vr-rotate-sphere", { pan: 0.5 })).toBe(false);
    expect(isProEffectNeutral("vr-projection", { mode: "rectilinear" })).toBe(false);
    expect(isProEffectNeutral("vr-blur", { radius: 2 })).toBe(false);
  });
});

describe("VR Rotate Sphere", () => {
  it("lands a point at a known yaw / pitch on the analytic position", () => {
    const src = dotImage(10, 0);
    const c0 = centroid(src);
    expect(c0.yaw).toBeCloseTo(10, 0);
    const panned = centroid(rotate({ pan: 40 }, src));
    expect(Math.abs(panned.yaw - 50)).toBeLessThan(0.6);
    expect(Math.abs(panned.pitch)).toBeLessThan(0.6);
    const tilted = centroid(rotate({ tilt: 25 }, dotImage(0, 0)));
    expect(Math.abs(tilted.pitch - 25)).toBeLessThan(0.6);
    expect(Math.abs(tilted.yaw)).toBeLessThan(0.6);
    const rolled = centroid(rotate({ roll: 90 }, dotImage(0, 30)));
    expect(Math.abs(rolled.yaw - 30)).toBeLessThan(0.8);
    expect(Math.abs(rolled.pitch)).toBeLessThan(0.8);
    // Combined: matches the matrix the GPU uses.
    const combo = centroid(rotate({ pan: -75, tilt: 20, roll: 33 }, dotImage(40, 15)));
    const m = vrEffectMatrix("vr-rotate-sphere", { tilt: 20, pan: -75, roll: 33 }); // R^T
    const forward = dirFromYawPitch(40, 15);
    // content rotation R = transpose(m): R d = m^T d
    const ex: Vec3 = [
      m[0] * forward[0] + m[3] * forward[1] + m[6] * forward[2],
      m[1] * forward[0] + m[4] * forward[1] + m[7] * forward[2],
      m[2] * forward[0] + m[5] * forward[1] + m[8] * forward[2],
    ];
    const yp = yawPitchFromDir(ex);
    expect(Math.abs(combo.yaw - yp.yaw)).toBeLessThan(1);
    expect(Math.abs(combo.pitch - yp.pitch)).toBeLessThan(1);
  });

  it("a full turn of pan returns the picture, and opposite pans cancel", () => {
    const src = smoothSphereImage(W, H);
    const a = rotate({ pan: 90 }, rotate({ pan: -90 }, src));
    let maxErr = 0;
    for (let i = 0; i < src.length; i++) if (i % 4 !== 3) maxErr = Math.max(maxErr, Math.abs(a[i] - src[i]));
    expect(maxErr).toBeLessThan(4);
    // A pan of exactly a quarter of the width is a lossless column shift.
    const shifted = rotate({ pan: 90 }, src);
    const row = 40;
    for (const x of [3, 77, 130, 200]) {
      const from = (((x - W / 4) % W) + W) % W;
      for (let ch = 0; ch < 3; ch++) {
        expect(Math.abs(shifted[(row * W + x) * 4 + ch] - src[(row * W + from) * 4 + ch])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("maps the poles: tilting 90 degrees puts the south pole straight ahead", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        data[o] = y < H / 2 ? 255 : 0; // north red
        data[o + 2] = y < H / 2 ? 0 : 255; // south blue
        data[o + 3] = 255;
      }
    }
    const out = rotate({ tilt: 90 }, data);
    const centre = ((H / 2) * W + W / 2) * 4;
    expect(out[centre]).toBeLessThan(20);
    expect(out[centre + 2]).toBeGreaterThan(235);
    // No hole or NaN: every pixel is opaque.
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it("has no discontinuity at the 0/360 seam after rotating", () => {
    const src = smoothSphereImage(W, H);
    for (const params of [{ pan: 17 }, { pan: 180, tilt: 10 }, { roll: 25, pan: -40 }]) {
      const out = rotate(params, src);
      expect(seamJump(out)).toBeLessThan(1.6);
    }
  });

  it("rotates the two eyes of a stereo frame independently without mixing them", () => {
    const w = 128;
    const h = 128; // over/under: two 128x64 eyes
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        data[o] = y < h / 2 ? 220 : 10;
        data[o + 1] = x < w / 2 ? 200 : 40;
        data[o + 3] = 255;
      }
    }
    const out = new Uint8ClampedArray(data);
    applyProEffect("vr-rotate-sphere", { layout: "over-under", pan: 90, tilt: 0, roll: 0 }, out, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        expect(Math.abs(out[o] - (y < h / 2 ? 220 : 10))).toBeLessThan(3);
      }
    }
    // Eye content moved a quarter turn inside each eye: column 10 now holds what was at column 10 - w/4.
    const top = (5 * w + 40) * 4;
    expect(Math.abs(out[top + 1] - data[(5 * w + 8) * 4 + 1])).toBeLessThan(3);
  });
});

/** Largest column difference across the seam relative to the typical neighbouring-column difference. */
function seamJump(data: Uint8ClampedArray, w = W, h = H): number {
  let seam = 0;
  let interior = 0;
  for (let y = 4; y < h - 4; y++) {
    for (let ch = 0; ch < 3; ch++) {
      seam = Math.max(seam, Math.abs(data[(y * w + w - 1) * 4 + ch] - data[(y * w) * 4 + ch]));
      for (let x = 20; x < w - 20; x += 7) {
        interior = Math.max(interior, Math.abs(data[(y * w + x) * 4 + ch] - data[(y * w + x + 1) * 4 + ch]));
      }
    }
  }
  return seam / Math.max(interior, 1);
}

describe("VR Blur", () => {
  it("is seam-aware: no visible discontinuity at 0/360 after blurring", () => {
    const src = smoothSphereImage(W, H);
    const data = new Uint8ClampedArray(src);
    applyProEffect("vr-blur", { layout: "mono", radius: 5 }, data, W, H);
    expect(seamJump(data)).toBeLessThan(1.6);
    // A thin bright line on the seam blurs symmetrically to both sides.
    const line = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (const x of [0, W - 1]) line[(y * W + x) * 4] = 255;
      for (let x = 0; x < W; x++) line[(y * W + x) * 4 + 3] = 255;
    }
    applyProEffect("vr-blur", { layout: "mono", radius: 6 }, line, W, H);
    const row = 64;
    let left = 0;
    let right = 0;
    for (let k = 0; k < 12; k++) {
      left += line[(row * W + k) * 4];
      right += line[(row * W + W - 1 - k) * 4];
    }
    expect(left).toBeGreaterThan(100);
    expect(Math.abs(left - right) / Math.max(left, right)).toBeLessThan(0.1);
    expect(line[(row * W + 2) * 4]).toBeGreaterThan(5);
    expect(line[(row * W + W - 3) * 4]).toBeGreaterThan(5);
  });

  it("blurs by angle: near the pole the pixel footprint widens, nothing is left unblurred", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; data[o] = x % 2 ? 255 : 0; data[o + 3] = 255; }
    applyProEffect("vr-blur", { layout: "mono", radius: 4 }, data, W, H);
    const equator = (64 * W + 100) * 4;
    const nearPole = (1 * W + 100) * 4;
    // The checker is averaged out at the equator and, even more so, near the pole where the kernel spans many columns.
    expect(Math.abs(data[equator] - 128)).toBeLessThan(30);
    expect(Math.abs(data[nearPole] - 128)).toBeLessThan(12);
  });
});

describe("VR Projection (Reframe to flat)", () => {
  it("renders a rectilinear view letterboxed to the chosen aspect, transparent outside", () => {
    const src = smoothSphereImage(W, H);
    const data = new Uint8ClampedArray(src);
    applyProEffect("vr-projection", { mode: "rectilinear", fov: 90, pan: 0, tilt: 0, roll: 0, aspect: 1 }, data, W, H);
    // 1:1 inside a 2:1 buffer: the picture occupies the middle half, the rest is clear.
    expect(data[(64 * W + 5) * 4 + 3]).toBe(0);
    expect(data[(64 * W + W - 5) * 4 + 3]).toBe(0);
    expect(data[(64 * W + 128) * 4 + 3]).toBe(255);
    // The centre sees the straight-ahead colour of the source.
    const mid = (64 * W + 128) * 4;
    expect(Math.abs(data[mid + 1] - src[((H / 2) * W + W / 2) * 4 + 1])).toBeLessThan(3);
  });

  it("keyframable pan / tilt / roll / fov aim the view", () => {
    const src = dotImage(30, 10, 512, 256, 4);
    const data = new Uint8ClampedArray(src);
    applyProEffect("vr-projection", { mode: "rectilinear", fov: 60, pan: 30, tilt: 10, roll: 0, aspect: 2 }, data, 512, 256);
    const c = ((256 / 2) * 512 + 256) * 4;
    expect(data[c]).toBeGreaterThan(200);
  });

  it("little planet puts straight down at the centre", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; data[o] = y < H / 2 ? 255 : 0; data[o + 2] = y < H / 2 ? 0 : 255; data[o + 3] = 255; }
    applyProEffect("vr-projection", { mode: "stereographic", fov: 300, pan: 0, tilt: -90, roll: 0, aspect: 2 }, data, W, H);
    // A camera tilted to look straight down sees the south pole (blue) in the middle.
    const c = ((H / 2) * W + W / 2) * 4;
    expect(data[c + 2]).toBeGreaterThan(235);
  });

  it("fisheye clears the corners outside the image circle", () => {
    const data = smoothSphereImage(W, H);
    applyProEffect("vr-projection", { mode: "fisheye", fov: 180, aspect: 1 }, data, W, H);
    expect(data[(2 * W + 66) * 4 + 3]).toBe(0);
    expect(data[(64 * W + 128) * 4 + 3]).toBe(255);
  });
});

describe("VR Plane to Sphere", () => {
  it("places a flat picture at the given yaw / pitch without distortion", () => {
    // Flat source: a bright dot at the centre of the frame.
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const near = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) < 6;
      data[o] = data[o + 1] = data[o + 2] = near ? 255 : 30;
      data[o + 3] = 255;
    }
    applyProEffect("vr-plane-to-sphere", { enabled: true, width: 60, pan: 70, tilt: 20, roll: 0 }, data, W, H);
    // Outside the plane the frame is transparent; the dot sits at yaw 70 / pitch 20.
    expect(data[3]).toBe(0);
    const bright = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) bright[i] = data[i + 3] > 128 && data[i] > 200 ? 255 : 0;
    const c = centroid(bright);
    expect(Math.abs(c.yaw - 70)).toBeLessThan(1);
    expect(Math.abs(c.pitch - 20)).toBeLessThan(1);
  });

  it("covers the requested angular width on the equator", () => {
    const uv = planeUv(dirFromYawPitch(29.9, 0), 60, 2);
    expect(uv).not.toBeNull();
    expect(planeUv(dirFromYawPitch(30.2, 0), 60, 2)).toBeNull();
    expect(planeUv(dirFromYawPitch(180, 0), 60, 2)).toBeNull();
    const back = equirectFromDir(dirFromYawPitch(0, 0));
    expect(back.u).toBeCloseTo(0.5, 9);
  });
});

describe("GPU uniform mapping", () => {
  it("exposes layout flags and matrices", () => {
    const u = proEffectGpuUniforms("vr-rotate-sphere", { layout: "side-by-side", pan: 90, tilt: 0, roll: 0 }, 100);
    expect(u.layout).toBe(2);
    expect(Object.keys(u)).toContain("m8");
    const proj = proEffectGpuUniforms("vr-projection", { mode: "fisheye", fov: 200 }, 100);
    expect(proj.projection).toBe(2);
    expect(proj.fov).toBe(200);
    const rect = proEffectGpuUniforms("vr-projection", { mode: "rectilinear", fov: 360 }, 100);
    expect(rect.fov).toBe(170);
  });
});

describe("keyframed rotation takes the shortest path", () => {
  const clip = (keyframes: Clip["keyframes"], effects: Clip["effects"]): Clip =>
    ({ id: "c", mediaId: "m", trackId: "t", startTime: 0, duration: 2, inPoint: 0, outPoint: 2, effects, keyframes, transform: undefined }) as unknown as Clip;

  it("interpolates 350 to 10 through 360, not through 180 (instance keyframes)", () => {
    const fx = [{ id: "fx1", type: "vr-rotate-sphere", enabled: true, params: { ...PRO_EFFECT_DEFAULTS["vr-rotate-sphere"] } }] as Clip["effects"];
    const prop = effectInstanceKeyframeProperty("fx1", "pan");
    const kfs = [
      { id: "k1", time: 0, property: prop, value: 350, easing: "linear" },
      { id: "k2", time: 1, property: prop, value: 10, easing: "linear" },
    ] as unknown as Clip["keyframes"];
    const mid = getAnimatedVideoEffects(clip(kfs, fx), 0.5)[0].params.pan as number;
    // 360 is the same direction as 0 (the shortest path through the wrap); the long way would be 180.
    expect(Math.abs(((mid % 360) + 360) % 360)).toBeLessThan(0.001);
    const quarter = getAnimatedVideoEffects(clip(kfs, fx), 0.25)[0].params.pan as number;
    expect(quarter).toBeCloseTo(355, 6);
    // Non-angle parameters are untouched by the wrap: plain linear.
    const fx2 = [{ id: "fx2", type: "vr-blur", enabled: true, params: { radius: 0 } }] as Clip["effects"];
    const k2 = [
      { id: "a", time: 0, property: effectInstanceKeyframeProperty("fx2", "radius"), value: 1, easing: "linear" },
      { id: "b", time: 1, property: effectInstanceKeyframeProperty("fx2", "radius"), value: 9, easing: "linear" },
    ] as unknown as Clip["keyframes"];
    expect(getAnimatedVideoEffects(clip(k2, fx2), 0.5)[0].params.radius).toBeCloseTo(5, 6);
  });

  it("also takes the shortest path for type-keyed (legacy) keyframes", () => {
    const fx = [{ id: "fx1", type: "vr-rotate-sphere", enabled: true, params: { ...PRO_EFFECT_DEFAULTS["vr-rotate-sphere"] } }] as Clip["effects"];
    const kfs = [
      { id: "k1", time: 0, property: "effect.vr-rotate-sphere.pan", value: -170, easing: "linear" },
      { id: "k2", time: 1, property: "effect.vr-rotate-sphere.pan", value: 170, easing: "linear" },
    ] as unknown as Clip["keyframes"];
    const mid = getAnimatedVideoEffects(clip(kfs, fx), 0.5)[0].params.pan as number;
    expect(Math.abs(Math.abs(mid) - 180)).toBeLessThan(0.001);
  });
});

describe("VR effects are added neutral, and projects saved with the earlier defaults render as saved", () => {
  it("every VR effect is added neutral", () => {
    for (const type of VR_PRO_EFFECT_TYPES) {
      expect(isProEffectNeutral(type, PRO_EFFECT_DEFAULTS[type]), type).toBe(true);
    }
    expect(PRO_EFFECT_DEFAULTS["vr-rotate-sphere"]).toMatchObject({ layout: "mono", pan: 0, tilt: 0, roll: 0 });
    expect(PRO_EFFECT_DEFAULTS["vr-projection"]).toMatchObject({ mode: "none" });
    expect(PRO_EFFECT_DEFAULTS["vr-blur"]).toMatchObject({ radius: 0 });
    expect(PRO_EFFECT_DEFAULTS["vr-plane-to-sphere"]).toMatchObject({ enabled: false });
  });

  // Effects store their parameters in the project (every add path writes the defaults), so a project saved when
  // Rotate Sphere was added at pan 30 (and VR Projection at "Reframe to flat", VR Blur at 2 degrees, VR Plane to Sphere
  // placed) still holds those values: a saved project is a JSON round trip of them.
  const saved = (params: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(params)) as Record<string, unknown>;

  it("a Rotate Sphere saved at pan 30 still renders pan 30 (not neutral, not the new default)", () => {
    const stored = saved({ layout: "mono", tilt: 0, pan: 30, roll: 0 });
    expect(withProEffectDefaults("vr-rotate-sphere", stored)).toEqual(stored);
    expect(isProEffectNeutral("vr-rotate-sphere", stored)).toBe(false);
    const src = dotImage(10, 0);
    const data = new Uint8ClampedArray(src);
    applyProEffect("vr-rotate-sphere", stored, data, W, H);
    expect(Math.abs(centroid(data).yaw - 40)).toBeLessThan(0.6);
    expect(Array.from(data)).toEqual(Array.from(rotate({ pan: 30 }, src)));
  });

  it("legacy VR Projection, VR Blur and VR Plane to Sphere params are kept as saved", () => {
    const projection = saved({ mode: "rectilinear", layout: "mono", fov: 90, pan: 0, tilt: 0, roll: 0, aspect: 16 / 9 });
    expect(withProEffectDefaults("vr-projection", projection)).toEqual(projection);
    expect(isProEffectNeutral("vr-projection", projection)).toBe(false);
    const blur = saved({ layout: "mono", radius: 2 });
    expect(withProEffectDefaults("vr-blur", blur)).toEqual(blur);
    expect(isProEffectNeutral("vr-blur", blur)).toBe(false);
    const plane = saved({ width: 60, pan: 0, tilt: 0, roll: 0, enabled: true });
    expect(withProEffectDefaults("vr-plane-to-sphere", plane)).toEqual(plane);
    expect(isProEffectNeutral("vr-plane-to-sphere", plane)).toBe(false);
  });
});
