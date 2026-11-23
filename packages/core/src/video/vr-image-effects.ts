/**
 * Premiere's remaining immersive-video image effects for equirectangular footage: VR Sharpen, VR Glow, VR Chromatic
 * Aberrations, VR Digital Glitch and VR De-Noise. They follow the pattern of vr-effects.ts (specs, neutral values,
 * the pure CPU reference, the single stored-params -> shader-uniforms mapping) and plug into the pro effects library
 * next to it, so the Effects panel (Immersive Video), the inspector, keyframes and the agent's generic effect tools
 * come for free. The GLSL ports are in vr-image-effect-shaders.ts and mirror the code below line for line.
 *
 * What makes them 360 aware (all of it shared by the CPU reference and the shaders):
 *  - Kernels are discs of an ANGULAR radius sampled with `sampleSpherePixel`: the horizontal footprint widens by
 *    1 / cos(latitude) so the effect looks the same at every latitude, samples wrap across the 0/360 seam and fold
 *    over the poles onto the opposite meridian. A picture that only varies with latitude therefore stays constant
 *    along every row (pole uniformity).
 *  - Chromatic aberration is an angular scaling about an axis ON the sphere (a great-circle radial offset), not a
 *    pixel shift, so it is correct at the seam and the poles.
 *  - Digital Glitch only moves whole rows in longitude (a rotation about the vertical axis per band of latitude), so
 *    it is exactly equivariant under a longitude shift and cannot create a seam.
 *  - Stereo frames are processed per eye (the eye rectangle bounds every tap), and Glitch uses the same random draws
 *    for both eyes so the eyes stay coherent.
 *  - Every effect is an exact no-op at its neutral value (amount / brightness / intensity 0).
 */
import {
  VR_LAYOUT_FLAGS,
  apply3,
  cameraRotation,
  dirFromEquirect,
  equirectFromDir,
  eyeRect,
  sampleEquirect,
  sampleSpherePixel,
  transpose3,
  type Mat3,
  type VrFrameLayout,
} from "../vr/vr-math";
import type { ResolvedProParams } from "./pro-effects";

import {
  VR_CA_MAX_SCALE,
  VR_DISC_MAX_SAMPLES,
  VR_SHARPEN_GAIN,
  isVrImageNeutral,
  isVrImageEffectType,
  normalizeVrImageParams,
  type VrImageEffectType,
} from "./vr-image-effect-specs";

// The spec half is re-exported so this module stays the one place to import everything about these effects from;
// the app's startup code imports vr-image-effect-specs.ts instead.
export {
  VR_CA_MAX_SCALE,
  VR_DISC_MAX_SAMPLES,
  VR_GLITCH_DEFAULT_RATE,
  VR_GLOW_MAX_DEGREES,
  VR_IMAGE_EFFECT_SPECS,
  VR_IMAGE_EFFECT_TYPES,
  VR_IMAGE_TIME_DRIVEN,
  VR_SHARPEN_GAIN,
  isVrImageEffectType,
  isVrImageNeutral,
  normalizeVrImageParams,
  type VrImageEffectType,
} from "./vr-image-effect-specs";

const GOLDEN_ANGLE = 2.399963229728653;
const MIN_COS = 0.05;
const n = (p: ResolvedProParams, key: string): number => p[key] as number;
const layoutOf = (p: ResolvedProParams): VrFrameLayout => {
  const v = p.layout;
  return v === "over-under" || v === "side-by-side" ? v : "mono";
};

/** Disc sample count for a radius in pixels (shared by CPU and GPU). */
export function vrDiscSampleCount(radiusPx: number): number {
  return Math.min(VR_DISC_MAX_SAMPLES, Math.max(16, Math.ceil(radiusPx * 2) + 8));
}

/** Radius in pixels at the equator of an eye of the given width. */
export function vrDiscRadiusPx(degrees: number, eyeWidth: number): number {
  return (degrees / 360) * eyeWidth;
}

/** Gaussian-like falloff of the i-th of `count` equal-area disc samples (rho^2 / R^2 = (i + 0.5) / count). */
export function vrDiscWeight(i: number, count: number): number {
  return Math.exp((-2 * (i + 0.5)) / count);
}

/** Bilateral range sigma in 0..1 colour units for a noise level in percent. */
export function vrDenoiseSigma(amountPct: number): number {
  return (3 + amountPct * 0.6) / 255;
}

/** Frame index of the glitch re-roll for a clip-local time and rate. */
export function vrGlitchFrame(time: number, rate: number): number {
  return Math.floor(Math.max(0, Number.isFinite(time) ? time : 0) * Math.max(1, rate) + 1e-6);
}

/** Bit-exact copy of the pro effects hash (and of `hashU` in GLSL): 32-bit integer hash -> [0, 1). */
export function vrHash(a: number, c: number, d: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(c | 0, 668265263)) | 0;
  h = (h + Math.imul(d | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return Math.fround(h >>> 0) / 4294967296;
}

/** Rows of a glitch band in an eye of the given height (16 bands from pole to pole). */
export function vrGlitchBandRows(eyeHeight: number): number {
  return Math.max(1, Math.round(eyeHeight / 16));
}

/** Seed offset of the fine jitter stream. */
const JITTER_SEED = 10007;

export interface GlitchRow {
  /** Whole-pixel longitude shift of the row. */
  readonly shift: number;
  /** Red / blue channel offset in pixels (opposite directions). */
  readonly split: number;
}

/** The shift of row `y` (eye-local) of an eye of the given size: the single definition both paths evaluate. */
export function glitchRow(y: number, eyeW: number, eyeH: number, k: number, seed: number, frame: number): GlitchRow {
  const rows = vrGlitchBandRows(eyeH);
  const band = Math.floor(y / rows);
  let shift = 0;
  if (vrHash(seed, frame, band * 4 + 1) < 0.1 + 0.5 * k) {
    shift = Math.round((vrHash(seed, frame, band * 4) * 2 - 1) * k * 0.2 * eyeW);
  }
  if (vrHash(seed + JITTER_SEED, frame, y * 4 + 2) < 0.3 * k) {
    shift += Math.round((vrHash(seed + JITTER_SEED, frame, y * 4 + 3) * 2 - 1) * k * 0.02 * eyeW);
  }
  const split = shift !== 0 ? Math.round(k * 0.01 * eyeW * (0.5 + vrHash(seed, frame, band * 4 + 2))) : 0;
  return { shift, split };
}

/**
 * Direction of the aberrated sample: scales the angle from the view axis (`rot`: view -> world) by 1 + k w, where w is 1
 * in the front hemisphere and fades as sin^2 of the angle behind the axis. Without the fade every azimuth around the
 * antipode of the axis (which is on the 0/360 seam for a centre straight ahead) would map to a ring of directions, a
 * singularity; with it the offset vanishes smoothly there.
 */
export function aberrateDir(d: readonly [number, number, number], rot: Mat3, rotT: Mat3, k: number): [number, number, number] {
  const v = apply3(rotT, d);
  const sinT = Math.hypot(v[0], v[1]);
  const theta = Math.atan2(sinT, v[2]);
  const factor = 1 + (v[2] < 0 ? k * sinT * sinT : k);
  const t2 = theta * factor;
  const ratio = sinT > 1e-9 ? Math.sin(t2) / sinT : factor;
  const w = apply3(rot, [v[0] * ratio, v[1] * ratio, Math.cos(t2)]);
  return [w[0], w[1], w[2]];
}

/* -------------------------------------------------------------------------- */
/* CPU reference                                                               */
/* -------------------------------------------------------------------------- */

const eyeCount = (layout: VrFrameLayout): number => (layout === "mono" ? 1 : 2);
const luma255 = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
const to8 = (v: number): number => Math.round(v < 0 ? 0 : v > 255 ? 255 : v);

function sharpen(data: Uint8ClampedArray, width: number, height: number, layout: VrFrameLayout, amount: number, degrees: number): void {
  const src = new Uint8ClampedArray(data);
  const px = [0, 0, 0, 0];
  const k = (amount / 100) * VR_SHARPEN_GAIN;
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    const radius = vrDiscRadiusPx(degrees, r.w);
    const count = vrDiscSampleCount(radius);
    for (let y = 0; y < r.h; y++) {
      const lat = (0.5 - (y + 0.5) / r.h) * Math.PI;
      const hs = 1 / Math.max(Math.cos(lat), MIN_COS);
      for (let x = 0; x < r.w; x++) {
        let a0 = 0;
        let a1 = 0;
        let a2 = 0;
        for (let i = 0; i < count; i++) {
          const rho = radius * Math.sqrt((i + 0.5) / count);
          const th = i * GOLDEN_ANGLE;
          sampleSpherePixel(src, width, r, x + rho * Math.cos(th) * hs, y + rho * Math.sin(th), px);
          a0 += px[0];
          a1 += px[1];
          a2 += px[2];
        }
        const o = ((r.y + y) * width + r.x + x) * 4;
        data[o] = to8(src[o] + k * (src[o] - a0 / count));
        data[o + 1] = to8(src[o + 1] + k * (src[o + 1] - a1 / count));
        data[o + 2] = to8(src[o + 2] + k * (src[o + 2] - a2 / count));
      }
    }
  }
}

function glow(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  layout: VrFrameLayout,
  thr: number,
  degrees: number,
  boost: number,
  tint: readonly [number, number, number],
): void {
  const src = new Uint8ClampedArray(data);
  const px = [0, 0, 0, 0];
  const range = Math.max(1 - thr, 1e-3);
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    const radius = vrDiscRadiusPx(degrees, r.w);
    const count = vrDiscSampleCount(radius);
    for (let y = 0; y < r.h; y++) {
      const lat = (0.5 - (y + 0.5) / r.h) * Math.PI;
      const hs = 1 / Math.max(Math.cos(lat), MIN_COS);
      for (let x = 0; x < r.w; x++) {
        let a0 = 0;
        let a1 = 0;
        let a2 = 0;
        let ws = 0;
        for (let i = 0; i < count; i++) {
          const rho = radius * Math.sqrt((i + 0.5) / count);
          const th = i * GOLDEN_ANGLE;
          sampleSpherePixel(src, width, r, x + rho * Math.cos(th) * hs, y + rho * Math.sin(th), px);
          const l = luma255(px[0], px[1], px[2]) / 255;
          const ex = l > thr ? (l - thr) / range : 0;
          const w = vrDiscWeight(i, count);
          const wa = w * ex * (px[3] / 255);
          a0 += wa * px[0];
          a1 += wa * px[1];
          a2 += wa * px[2];
          ws += w;
        }
        const o = ((r.y + y) * width + r.x + x) * 4;
        data[o] = to8(src[o] + boost * tint[0] * (a0 / ws));
        data[o + 1] = to8(src[o + 1] + boost * tint[1] * (a1 / ws));
        data[o + 2] = to8(src[o + 2] + boost * tint[2] * (a2 / ws));
      }
    }
  }
}

function chromatic(data: Uint8ClampedArray, width: number, height: number, layout: VrFrameLayout, scale: number, rot: Mat3): void {
  const src = new Uint8ClampedArray(data);
  const rotT = transpose3(rot);
  const a = [0, 0, 0, 0];
  const b = [0, 0, 0, 0];
  const c = [0, 0, 0, 0];
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const d = dirFromEquirect((x + 0.5) / r.w, (y + 0.5) / r.h);
        const dr = equirectFromDir(aberrateDir(d, rot, rotT, scale));
        const dg = equirectFromDir(d);
        const db = equirectFromDir(aberrateDir(d, rot, rotT, -scale));
        sampleEquirect(src, width, r, dr.u, dr.v, a);
        sampleEquirect(src, width, r, dg.u, dg.v, b);
        sampleEquirect(src, width, r, db.u, db.v, c);
        const o = ((r.y + y) * width + r.x + x) * 4;
        data[o] = to8(a[0]);
        data[o + 1] = to8(b[1]);
        data[o + 2] = to8(c[2]);
        data[o + 3] = to8((a[3] + b[3] + c[3]) / 3);
      }
    }
  }
}

function glitch(data: Uint8ClampedArray, width: number, height: number, layout: VrFrameLayout, k: number, seed: number, frame: number): void {
  const src = new Uint8ClampedArray(data);
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    for (let y = 0; y < r.h; y++) {
      const row = glitchRow(y, r.w, r.h, k, seed, frame);
      if (row.shift === 0 && row.split === 0) continue;
      const base = (r.y + y) * width + r.x;
      for (let x = 0; x < r.w; x++) {
        const at = (dx: number): number => (base + ((((x - row.shift + dx) % r.w) + r.w) % r.w)) * 4;
        const o = (base + x) * 4;
        data[o] = src[at(-row.split)];
        data[o + 1] = src[at(0) + 1];
        data[o + 2] = src[at(row.split) + 2];
        data[o + 3] = src[at(0) + 3];
      }
    }
  }
}

function denoise(data: Uint8ClampedArray, width: number, height: number, layout: VrFrameLayout, amount: number, degrees: number): void {
  const src = new Uint8ClampedArray(data);
  const px = [0, 0, 0, 0];
  const sigma = vrDenoiseSigma(amount) * 255;
  const inv = 1 / (2 * sigma * sigma);
  for (let e = 0; e < eyeCount(layout); e++) {
    const r = eyeRect(layout, e as 0 | 1, width, height);
    const radius = vrDiscRadiusPx(degrees, r.w);
    const count = vrDiscSampleCount(radius);
    for (let y = 0; y < r.h; y++) {
      const lat = (0.5 - (y + 0.5) / r.h) * Math.PI;
      const hs = 1 / Math.max(Math.cos(lat), MIN_COS);
      for (let x = 0; x < r.w; x++) {
        const o = ((r.y + y) * width + r.x + x) * 4;
        const c0 = src[o];
        const c1 = src[o + 1];
        const c2 = src[o + 2];
        let a0 = c0;
        let a1 = c1;
        let a2 = c2;
        let ws = 1;
        for (let i = 0; i < count; i++) {
          const rho = radius * Math.sqrt((i + 0.5) / count);
          const th = i * GOLDEN_ANGLE;
          sampleSpherePixel(src, width, r, x + rho * Math.cos(th) * hs, y + rho * Math.sin(th), px);
          const d0 = px[0] - c0;
          const d1 = px[1] - c1;
          const d2 = px[2] - c2;
          const w = vrDiscWeight(i, count) * Math.exp(-((d0 * d0 + d1 * d1 + d2 * d2) / 3) * inv);
          a0 += w * px[0];
          a1 += w * px[1];
          a2 += w * px[2];
          ws += w;
        }
        data[o] = to8(a0 / ws);
        data[o + 1] = to8(a1 / ws);
        data[o + 2] = to8(a2 / ws);
      }
    }
  }
}

/** Applies a VR image effect to RGBA bytes in place. Returns false when `type` is not one of them. */
export function applyVrImageEffect(type: string, resolved: ResolvedProParams, data: Uint8ClampedArray, width: number, height: number): boolean {
  if (!isVrImageEffectType(type)) return false;
  if (isVrImageNeutral(type, resolved)) return true;
  const p = normalizeVrImageParams(type, resolved);
  const layout = layoutOf(p);
  switch (type) {
    case "vr-sharpen":
      sharpen(data, width, height, layout, n(p, "amount"), n(p, "radius"));
      break;
    case "vr-glow":
      glow(data, width, height, layout, n(p, "threshold") / 100, n(p, "radius"), n(p, "brightness") / 100, [n(p, "tintR") / 255, n(p, "tintG") / 255, n(p, "tintB") / 255]);
      break;
    case "vr-chromatic-aberrations":
      chromatic(data, width, height, layout, (n(p, "amount") / 100) * VR_CA_MAX_SCALE, cameraRotation(n(p, "pan"), n(p, "tilt"), 0));
      break;
    case "vr-digital-glitch":
      glitch(data, width, height, layout, n(p, "intensity") / 100, Math.round(n(p, "seed")), vrGlitchFrame(n(p, "time"), n(p, "rate")));
      break;
    case "vr-de-noise":
      denoise(data, width, height, layout, n(p, "amount"), n(p, "radius"));
      break;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* GPU uniform mapping                                                         */
/* -------------------------------------------------------------------------- */

const MATRIX_UNIFORMS = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"] as const;

/** Uniform names (without `u_`) each VR image shader consumes. */
export const VR_IMAGE_UNIFORMS: Readonly<Record<VrImageEffectType, readonly string[]>> = {
  "vr-sharpen": ["layout", "degrees", "k"],
  "vr-glow": ["layout", "degrees", "thr", "boost", "tintR", "tintG", "tintB"],
  "vr-chromatic-aberrations": ["layout", "scale", ...MATRIX_UNIFORMS],
  "vr-digital-glitch": ["layout", "k", "seed", "frame"],
  "vr-de-noise": ["layout", "degrees", "sigma"],
};

export function vrImageEffectGpuUniforms(type: VrImageEffectType, resolved: ResolvedProParams): Record<string, number> {
  const p = normalizeVrImageParams(type, resolved);
  const layout = VR_LAYOUT_FLAGS[layoutOf(p)];
  switch (type) {
    case "vr-sharpen":
      return { layout, degrees: n(p, "radius"), k: (n(p, "amount") / 100) * VR_SHARPEN_GAIN };
    case "vr-glow":
      return {
        layout,
        degrees: n(p, "radius"),
        thr: n(p, "threshold") / 100,
        boost: n(p, "brightness") / 100,
        tintR: n(p, "tintR") / 255,
        tintG: n(p, "tintG") / 255,
        tintB: n(p, "tintB") / 255,
      };
    case "vr-chromatic-aberrations": {
      const m = cameraRotation(n(p, "pan"), n(p, "tilt"), 0);
      return { layout, scale: (n(p, "amount") / 100) * VR_CA_MAX_SCALE, ...Object.fromEntries(MATRIX_UNIFORMS.map((name, i) => [name, m[i]])) };
    }
    case "vr-digital-glitch":
      return { layout, k: n(p, "intensity") / 100, seed: Math.round(n(p, "seed")), frame: vrGlitchFrame(n(p, "time"), n(p, "rate")) };
    case "vr-de-noise":
      return { layout, degrees: n(p, "radius"), sigma: vrDenoiseSigma(n(p, "amount")) };
  }
}
