/**
 * VR image effect specs (VR Sharpen, VR Glow, VR Chromatic Aberrations, VR Digital Glitch, VR De-Noise): labels,
 * ranges, defaults, neutral values and the neutral test. This is the small part the Effects panel, the inspector,
 * project load and the agent need up front; the CPU reference, the GLSL and the shader uniforms are in
 * vr-image-effects.ts / vr-image-effect-shaders.ts, behind the lazy VR runtime (vr-runtime-loader.ts).
 */
import { wrapDegrees } from "../vr/vr-layout";
import type { ProEffectParamSpec, ProEffectSpec, ResolvedProParams } from "./pro-effects";

export const VR_IMAGE_EFFECT_TYPES = [
  "vr-sharpen",
  "vr-glow",
  "vr-chromatic-aberrations",
  "vr-digital-glitch",
  "vr-de-noise",
] as const;

export type VrImageEffectType = (typeof VR_IMAGE_EFFECT_TYPES)[number];

const SET: ReadonlySet<string> = new Set(VR_IMAGE_EFFECT_TYPES);

export function isVrImageEffectType(type: string): type is VrImageEffectType {
  return SET.has(type);
}

/** Effects whose output depends on clip-local time (the glitch re-rolls at its rate); `time` is added to by the renderer. */
export const VR_IMAGE_TIME_DRIVEN: readonly VrImageEffectType[] = ["vr-digital-glitch"];

/** Disc samples (upper bound shared with the shaders' loops). */
export const VR_DISC_MAX_SAMPLES = 64;

/** Largest glow radius, degrees of arc. */
export const VR_GLOW_MAX_DEGREES = 12;
/** Chromatic aberration at amount 100: the red / blue channels scale the angle from the axis by 1 +/- this. */
export const VR_CA_MAX_SCALE = 0.06;
/** Unsharp gain at amount 100. */
export const VR_SHARPEN_GAIN = 2;
/** Frame index of the glitch re-rolls: `rate` changes per second. */
export const VR_GLITCH_DEFAULT_RATE = 12;

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  neutral: number,
  unit?: string,
  keyframable = true,
  wrap?: number,
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
  keyframable,
  ...(wrap ? { wrap } : {}),
});

const layoutParam = (): ProEffectParamSpec => ({
  key: "layout",
  label: "Frame layout",
  kind: "select",
  default: "mono",
  neutral: "mono",
  options: [
    { value: "mono", label: "Monoscopic" },
    { value: "over-under", label: "Stereo over/under" },
    { value: "side-by-side", label: "Stereo side by side" },
  ],
});

/** A parameter the effect sweep and the tests set to a clearly visible value when the defaults are neutral. */
const acting = (p: ProEffectParamSpec, value: number): ProEffectParamSpec => ({ ...p, acting: value });

const angle = (key: string, label: string): ProEffectParamSpec => num(key, label, -360, 360, 0.1, 0, 0, "°", true, 360);

const RAW_SPECS: Readonly<Record<VrImageEffectType, ProEffectSpec>> = {
  "vr-sharpen": {
    type: "vr-sharpen",
    label: "VR Sharpen",
    description:
      "Seam-aware unsharp mask for a 360 picture: the radius is an angle, so detail is sharpened equally at every latitude, across the 0/360 seam and over the poles. Stereo eyes are sharpened separately",
    category: "Immersive Video",
    params: [layoutParam(), acting(num("amount", "Sharpen amount", 0, 100, 0.1, 0, 0, "%"), 50), num("radius", "Radius", 0.05, 3, 0.05, 0.4, 0.4, "°")],
  },
  "vr-glow": {
    type: "vr-glow",
    label: "VR Glow",
    description:
      "Bloom for a 360 picture: pixels above the luminance threshold bleed light over an angular radius that wraps across the 0/360 seam and folds over the poles, tinted and added to the picture",
    category: "Immersive Video",
    params: [
      layoutParam(),
      num("threshold", "Luminance threshold", 0, 100, 0.5, 60, 60, "%"),
      num("radius", "Glow radius", 0.1, VR_GLOW_MAX_DEGREES, 0.1, 3, 3, "°"),
      acting(num("brightness", "Glow brightness", 0, 400, 1, 0, 0, "%"), 150),
      num("tintR", "Tint R", 0, 255, 1, 255, 255, undefined, false),
      num("tintG", "Tint G", 0, 255, 1, 255, 255, undefined, false),
      num("tintB", "Tint B", 0, 255, 1, 255, 255, undefined, false),
    ],
  },
  "vr-chromatic-aberrations": {
    type: "vr-chromatic-aberrations",
    label: "VR Chromatic Aberrations",
    description:
      "Radial colour fringing defined on the sphere: red and blue are sampled at a slightly larger and smaller angle from the aberration centre (pan / tilt), so the fringes grow towards the edge of a reframed view and stay correct at the seam and the poles",
    category: "Immersive Video",
    params: [layoutParam(), acting(num("amount", "Amount", 0, 100, 0.1, 0, 0, "%"), 25), angle("pan", "Centre pan"), angle("tilt", "Centre tilt")],
  },
  "vr-digital-glitch": {
    type: "vr-digital-glitch",
    label: "VR Digital Glitch",
    description:
      "Digital glitch for a 360 picture: bands of latitude slip around the sphere (a rotation, so the seam never tears), fine jitter rows and red / blue splits. Deterministic for a seed and time, so preview and export match; both stereo eyes glitch together",
    category: "Immersive Video",
    params: [
      layoutParam(),
      acting(num("intensity", "Intensity", 0, 100, 0.1, 0, 0, "%"), 40),
      num("seed", "Seed", 0, 9999, 1, 1, 1, undefined, false),
      num("rate", "Changes per second", 1, 24, 1, VR_GLITCH_DEFAULT_RATE, VR_GLITCH_DEFAULT_RATE, "fps", false),
      num("time", "Time offset", 0, 3600, 0.1, 0, 0, "s", false),
    ],
  },
  "vr-de-noise": {
    type: "vr-de-noise",
    label: "VR De-Noise",
    description:
      "Edge-preserving noise reduction for a 360 picture: a bilateral filter over an angular radius that wraps across the 0/360 seam and folds over the poles, so noise is cleaned equally at every latitude. Spatial only (no temporal averaging)",
    category: "Immersive Video",
    params: [layoutParam(), acting(num("amount", "Noise level", 0, 100, 0.1, 0, 0, "%"), 40), acting(num("radius", "Radius", 0.1, 3, 0.05, 0.5, 0.5, "°"), 3)],
  },
};

/**
 * The five effects are added neutral (amount / brightness / intensity 0), so `proEffectActingParams` needs a visible
 * value for the one parameter that drives each; every other parameter acts at its default, which keeps the layout
 * monoscopic and the glitch seed, rate and time where a user would have them.
 */
export const VR_IMAGE_EFFECT_SPECS: Readonly<Record<VrImageEffectType, ProEffectSpec>> = Object.fromEntries(
  (Object.keys(RAW_SPECS) as VrImageEffectType[]).map((type) => [
    type,
    { ...RAW_SPECS[type], params: RAW_SPECS[type].params.map((p) => (p.acting === undefined ? { ...p, acting: p.default } : p)) },
  ]),
) as unknown as Record<VrImageEffectType, ProEffectSpec>;

const n = (p: ResolvedProParams, key: string): number => p[key] as number;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Params with ranges enforced; the wrapped angles are wrapped into [-180, 180) instead of clamped. */
export function normalizeVrImageParams(type: VrImageEffectType, p: ResolvedProParams): ResolvedProParams {
  const out: ResolvedProParams = { ...p };
  for (const s of VR_IMAGE_EFFECT_SPECS[type].params) {
    if (s.kind !== "number") continue;
    const v = p[s.key] as number;
    out[s.key] = s.wrap ? wrapDegrees(v) : clamp(v, s.min ?? -Infinity, s.max ?? Infinity);
  }
  return out;
}


export function isVrImageNeutral(type: VrImageEffectType, resolved: ResolvedProParams): boolean {
  const p = normalizeVrImageParams(type, resolved);
  switch (type) {
    case "vr-sharpen":
      return n(p, "amount") < 0.05;
    case "vr-glow":
      return n(p, "brightness") < 0.05 || n(p, "threshold") >= 100;
    case "vr-chromatic-aberrations":
      return n(p, "amount") < 0.01;
    case "vr-digital-glitch":
      return n(p, "intensity") < 0.05;
    case "vr-de-noise":
      return n(p, "amount") < 0.05;
  }
}
