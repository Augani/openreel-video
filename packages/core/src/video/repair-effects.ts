/**
 * Repair effects: Dehaze, Deflicker and Deband (Premiere / Resolve staples).
 *
 * They plug into the pro effects library (pro-effects.ts) like the wave 7
 * batch: specs (ranges, defaults, neutral values), the CPU reference (the
 * Canvas2D / software fallback and the reference the GLSL ports in
 * pro-effect-shaders-repair.ts are written against) and the single mapping
 * from stored params to shader uniforms.
 *
 *  - Dehaze: dark channel prior. The atmospheric light is the colour of the
 *    brightest-dark sample of a fixed 8x8 grid, the transmission comes from the
 *    patch minimum / mean of min(r/A, g/A, b/A), and a sky mask (patch
 *    close to the atmospheric light) keeps skies from being amplified.
 *    Negative amounts add haze. Single pass: there is no guided-filter refine.
 *  - Deband: gradient-aware smoothing. Four taps on a hashed circle replace a
 *    pixel only when every tap is within `threshold` of it, so ramps are
 *    averaged out and edges are never crossed; a small hashed dither then breaks
 *    up what is left.
 *  - Deflicker: a per-channel gain computed from the clip's neighbour frames
 *    (deflicker.ts); the pixel pass here only applies it.
 *
 * Every effect is an exact no-op for its neutral parameters, and all random
 * values are pure hashes of the pixel position, so preview == export.
 */
import {
  applyDeflicker,
  isDeflickerNeutral,
  readDeflickerGains,
} from "./deflicker";
import type {
  ProEffectParamSpec,
  ProEffectSpec,
  ResolvedProParams,
} from "./pro-effects";

export const REPAIR_PRO_EFFECT_TYPES = ["dehaze", "deflicker", "deband"] as const;

export type RepairProEffectType = (typeof REPAIR_PRO_EFFECT_TYPES)[number];

const REPAIR_SET: ReadonlySet<string> = new Set(REPAIR_PRO_EFFECT_TYPES);

export function isRepairProEffectType(type: string): type is RepairProEffectType {
  return REPAIR_SET.has(type);
}

/** None of the repair effects touch alpha. */
export const REPAIR_EFFECTS_WRITING_ALPHA: readonly RepairProEffectType[] = [];

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  neutral: number,
  unit?: string,
): ProEffectParamSpec => ({
  key,
  label,
  kind: "number",
  min,
  max,
  step,
  unit,
  default: def,
  neutral,
  keyframable: true,
});

export const REPAIR_PRO_EFFECT_SPECS: Readonly<Record<RepairProEffectType, ProEffectSpec>> = {
  dehaze: {
    type: "dehaze",
    label: "Dehaze",
    description: "Remove haze and fog with a dark channel prior; protects the sky",
    category: "Repair",
    params: [
      num("amount", "Amount", -100, 100, 1, 50, 0, "%"),
      num("radius", "Patch size", 1, 40, 1, 8, 8, "px"),
      num("skyProtection", "Sky protection", 0, 100, 1, 60, 60, "%"),
    ],
  },
  deflicker: {
    type: "deflicker",
    label: "Deflicker",
    description: "Even out brightness and colour flicker over neighbouring frames, without smoothing scene cuts",
    category: "Repair",
    params: [
      num("window", "Window", 3, 31, 2, 15, 15, "frames"),
      num("luma", "Luma correction", 0, 100, 1, 100, 0, "%"),
      num("color", "Colour correction", 0, 100, 1, 40, 0, "%"),
      num("sensitivity", "Scene cut sensitivity", 0, 100, 1, 50, 50, "%"),
      num("limit", "Max correction", 0, 100, 1, 40, 40, "%"),
    ],
  },
  deband: {
    type: "deband",
    label: "Deband",
    description: "Smooth banding in gradients while keeping edges, then dither",
    category: "Repair",
    params: [
      num("threshold", "Threshold", 0, 32, 0.5, 6, 0, "lv"),
      num("radius", "Radius", 1, 64, 1, 16, 16, "px"),
      num("iterations", "Iterations", 1, 4, 1, 2, 2),
      num("dither", "Dither", 0, 100, 1, 50, 0, "%"),
    ],
  },
};

/** Most iterations / taps the shaders loop over (constant GLSL loop bounds). */
export const DEBAND_MAX_ITERATIONS = 4;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const n = (p: Readonly<Record<string, number | boolean | string>>, key: string): number => p[key] as number;

/** Resolved params clamped to the spec ranges (keyframe interpolation can overshoot). */
export function normalizeRepairParams(
  type: RepairProEffectType,
  p: ResolvedProParams,
): ResolvedProParams {
  const out: ResolvedProParams = { ...p };
  for (const s of REPAIR_PRO_EFFECT_SPECS[type].params) {
    if (s.kind === "number") out[s.key] = clamp(p[s.key] as number, s.min ?? -Infinity, s.max ?? Infinity);
  }
  return out;
}

export function isRepairNeutral(type: RepairProEffectType, resolved: ResolvedProParams): boolean {
  const p = normalizeRepairParams(type, resolved);
  switch (type) {
    case "dehaze":
      return Math.abs(n(p, "amount")) < 0.5;
    case "deflicker":
      return isDeflickerNeutral(p);
    case "deband":
      return n(p, "threshold") <= 0 && n(p, "dither") <= 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Same bit-exact hash as pro-effects.ts hash01 (duplicated to avoid a value cycle). */
function hashUnit(a: number, c: number, d: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(c | 0, 668265263)) | 0;
  h = (h + Math.imul(d | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return Math.fround(h >>> 0) / 4294967296;
}

const rnd = (v: number): number => Math.floor(v + 0.5);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* -------------------------------------------------------------------------- */
/* Dehaze                                                                      */
/* -------------------------------------------------------------------------- */

/** The atmospheric light is searched on this grid (powers of two keep the sample positions exact in float32). */
export const DEHAZE_GRID = 8;
/** Patch taps per axis are 2 * DEHAZE_PATCH_K + 1. */
export const DEHAZE_PATCH_K = 2;
/** Weight of the patch mean in the dark channel (the rest is the patch minimum): fewer blocky halos. */
export const DEHAZE_MEAN_WEIGHT = 0.35;
/** The transmission never drops below this (limits noise amplification). */
export const DEHAZE_MIN_TRANSMISSION = 0.25;
/** Atmospheric light is never darker than this, so a dark scene is hardly touched. */
export const DEHAZE_MIN_LIGHT = 0.55;
/** Haze added at amount -100 (fraction of the atmospheric light). */
export const DEHAZE_MAX_ADDED_HAZE = 0.6;
const DEHAZE_OMEGA = 0.95;

/** Atmospheric light (0..1 RGB): the colour of the sample with the brightest darkest channel. */
export function dehazeAtmosphericLight(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  let best = -1;
  let r = 1;
  let g = 1;
  let b = 1;
  for (let j = 0; j < DEHAZE_GRID; j++) {
    for (let i = 0; i < DEHAZE_GRID; i++) {
      const x = Math.min(width - 1, Math.floor(((i + 0.5) / DEHAZE_GRID) * width));
      const y = Math.min(height - 1, Math.floor(((j + 0.5) / DEHAZE_GRID) * height));
      const o = (y * width + x) * 4;
      const m = Math.min(data[o], data[o + 1], data[o + 2]);
      if (m > best) {
        best = m;
        r = data[o] / 255;
        g = data[o + 1] / 255;
        b = data[o + 2] / 255;
      }
    }
  }
  return [
    Math.max(r, DEHAZE_MIN_LIGHT),
    Math.max(g, DEHAZE_MIN_LIGHT),
    Math.max(b, DEHAZE_MIN_LIGHT),
  ];
}

export function dehazePatchStep(radius: number): number {
  return Math.max(1, Math.round(clamp(radius, 1, 40)) / DEHAZE_PATCH_K);
}

/**
 * CPU reference. Positive amounts remove haze (J = (I - A) / t + A); negative
 * amounts mix the atmospheric light in. `light` can be passed to pin the
 * atmospheric light (tests, parity checks); it is estimated from the frame otherwise.
 */
export function applyDehaze(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amountPct: number,
  radius: number,
  skyPct: number,
  light?: readonly [number, number, number],
): void {
  const amount = clamp(amountPct, -100, 100) / 100;
  if (amount === 0) return;
  const [ar, ag, ab] = light ?? dehazeAtmosphericLight(data, width, height);
  if (amount < 0) {
    const s = -amount * DEHAZE_MAX_ADDED_HAZE;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(clamp((data[i] / 255) * (1 - s) + ar * s, 0, 1) * 255);
      data[i + 1] = Math.round(clamp((data[i + 1] / 255) * (1 - s) + ag * s, 0, 1) * 255);
      data[i + 2] = Math.round(clamp((data[i + 2] / 255) * (1 - s) + ab * s, 0, 1) * 255);
    }
    return;
  }
  const omega = DEHAZE_OMEGA * amount;
  const sky = clamp(skyPct, 0, 100) / 100;
  const step = dehazePatchStep(radius);
  const src = new Uint8ClampedArray(data);
  const offsets: number[] = [];
  for (let k = -DEHAZE_PATCH_K; k <= DEHAZE_PATCH_K; k++) offsets.push(rnd(k * step));
  const taps = offsets.length * offsets.length;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let mn = 1;
      let sum = 0;
      for (const dy of offsets) {
        const qy = clamp(y + dy, 0, height - 1);
        for (const dx of offsets) {
          const qx = clamp(x + dx, 0, width - 1);
          const o = (qy * width + qx) * 4;
          const v = Math.min(src[o] / 255 / ar, src[o + 1] / 255 / ag, src[o + 2] / 255 / ab);
          if (v < mn) mn = v;
          sum += v;
        }
      }
      const d = clamp(mn + (sum / taps - mn) * DEHAZE_MEAN_WEIGHT, 0, 1);
      let t = Math.max(1 - omega * d, DEHAZE_MIN_TRANSMISSION);
      t = t + (1 - t) * (sky * smooth(0.8, 0.98, d));
      const o = (y * width + x) * 4;
      data[o] = Math.round(clamp((src[o] / 255 - ar) / t + ar, 0, 1) * 255);
      data[o + 1] = Math.round(clamp((src[o + 1] / 255 - ag) / t + ag, 0, 1) * 255);
      data[o + 2] = Math.round(clamp((src[o + 2] / 255 - ab) / t + ab, 0, 1) * 255);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Deband                                                                      */
/* -------------------------------------------------------------------------- */

/** Hash salts: iteration `i` uses (2i, 2i + 1) for the tap angle and distance; the dither has its own. */
export const DEBAND_DITHER_SALT = 977;

/**
 * CPU reference. A pixel is replaced by the average of four taps on a hashed
 * circle (angle and distance are pure hashes of the pixel) only when every tap
 * is within `threshold` levels of it in every channel; `iterations` passes use
 * growing radii. A hashed dither of +-`ditherLevels` is added last.
 */
export function applyDeband(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  thresholdLevels: number,
  radius: number,
  iterations: number,
  ditherPct: number,
): void {
  const thr = clamp(thresholdLevels, 0, 32) / 255;
  const iters = Math.round(clamp(iterations, 1, DEBAND_MAX_ITERATIONS));
  const rad = Math.round(clamp(radius, 1, 64));
  const amp = clamp(ditherPct, 0, 100) / 100 / 255;
  const src = new Uint8ClampedArray(data);
  const tap = [0, 0, 0, 0].map(() => [0, 0, 0]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let cr = src[o] / 255;
      let cg = src[o + 1] / 255;
      let cb = src[o + 2] / 255;
      if (thr > 0) {
        for (let it = 1; it <= iters; it++) {
          const theta = hashUnit(x, y, 2 * it) * 6.283185307179586;
          const rho = Math.max(1, rad * (it / iters) * (0.5 + 0.5 * hashUnit(x, y, 2 * it + 1)));
          const cs = Math.cos(theta) * rho;
          const sn = Math.sin(theta) * rho;
          const dx = [cs, -cs, -sn, sn];
          const dy = [sn, -sn, cs, -cs];
          let ok = true;
          let ar = 0;
          let ag = 0;
          let ab = 0;
          for (let k = 0; k < 4; k++) {
            const qx = clamp(rnd(x + dx[k]), 0, width - 1);
            const qy = clamp(rnd(y + dy[k]), 0, height - 1);
            const q = (qy * width + qx) * 4;
            const t = tap[k];
            t[0] = src[q] / 255;
            t[1] = src[q + 1] / 255;
            t[2] = src[q + 2] / 255;
            if (Math.abs(t[0] - cr) >= thr || Math.abs(t[1] - cg) >= thr || Math.abs(t[2] - cb) >= thr) ok = false;
            ar += t[0];
            ag += t[1];
            ab += t[2];
          }
          if (ok) {
            cr = ar / 4;
            cg = ag / 4;
            cb = ab / 4;
          }
        }
      }
      if (amp > 0) {
        const noise = (hashUnit(x, y, DEBAND_DITHER_SALT) * 2 - 1) * amp;
        cr += noise;
        cg += noise;
        cb += noise;
      }
      data[o] = Math.round(clamp(cr, 0, 1) * 255);
      data[o + 1] = Math.round(clamp(cg, 0, 1) * 255);
      data[o + 2] = Math.round(clamp(cb, 0, 1) * 255);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Dispatch and GPU uniforms                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runs a repair effect on an RGBA buffer. `raw` are the stored params as they
 * are, because Deflicker's gains are not spec params (the render path adds
 * them once it has read the neighbour frames).
 */
export function applyRepairProEffect(
  type: RepairProEffectType,
  resolved: ResolvedProParams,
  raw: Readonly<Record<string, unknown>>,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const p = normalizeRepairParams(type, resolved);
  if (isRepairNeutral(type, p)) return;
  switch (type) {
    case "dehaze":
      applyDehaze(data, width, height, n(p, "amount"), n(p, "radius"), n(p, "skyProtection"));
      break;
    case "deflicker":
      applyDeflicker(data, readDeflickerGains(raw));
      break;
    case "deband":
      applyDeband(data, width, height, n(p, "threshold"), n(p, "radius"), n(p, "iterations"), n(p, "dither"));
      break;
  }
}

export function repairProEffectGpuUniforms(
  type: RepairProEffectType,
  resolved: ResolvedProParams,
  raw: Readonly<Record<string, unknown>>,
): Record<string, number> {
  const p = normalizeRepairParams(type, resolved);
  switch (type) {
    case "dehaze":
      return {
        amount: clamp(n(p, "amount"), -100, 100) / 100,
        step: dehazePatchStep(n(p, "radius")),
        sky: clamp(n(p, "skyProtection"), 0, 100) / 100,
      };
    case "deflicker": {
      const [r, g, b] = readDeflickerGains(raw);
      return { gr: r, gg: g, gb: b };
    }
    case "deband":
      return {
        thr: clamp(n(p, "threshold"), 0, 32) / 255,
        radius: Math.round(clamp(n(p, "radius"), 1, 64)),
        iters: Math.round(clamp(n(p, "iterations"), 1, DEBAND_MAX_ITERATIONS)),
        amp: clamp(n(p, "dither"), 0, 100) / 100 / 255,
      };
  }
}
