/**
 * Lumetri Creative and Lens Correction (pro effects).
 *
 *  - `lumetri-creative`: the Premiere Creative tab. Order of operations:
 *    Sharpen (3x3 unsharp mask on luma, read from the source neighbours) ->
 *    Faded Film (black lift) -> Vibrance (skin-protecting) -> Shadow / Highlight
 *    Tint split by Tint Balance. Every stage is the identity at its neutral value.
 *  - `lens-correction`: Brown-Conrady distortion (k1, k2 radial; p1, p2
 *    tangential), lateral chromatic aberration (red and blue radial scale
 *    against green) and vignette compensation, with a small table of camera
 *    profiles plus a manual mode.
 *
 * Both are single-pass per pixel. The CPU functions here are the Canvas2D /
 * software fallback and the reference the GLSL ports in
 * pro-effect-shaders-creative.ts are written against (same arithmetic, same
 * sample positions, bilinear with edge clamp), so preview == export.
 *
 * Lens model. Coordinates are normalised to the half diagonal of the frame
 * (r = 1 at the corners), origin at the frame centre. The output pixel is the
 * undistorted position u; it samples the source at the distorted position
 *   x_d = x (1 + k1 r^2 + k2 r^4) + 2 p1 x y + p2 (r^2 + 2 x^2)
 *   y_d = y (1 + k1 r^2 + k2 r^4) + p1 (r^2 + 2 y^2) + 2 p2 x y
 * which is the forward model of Brown, "Decentering distortion of lenses"
 * (Photogrammetric Engineering 32(3), 1966), the same equations OpenCV's
 * calib3d documents. The forward model is evaluated directly, so no inversion
 * is needed.
 */
import type {
  ProEffectCategory,
  ProEffectParamSpec,
  ProEffectSpec,
  ResolvedProParams,
} from "./pro-effects";

export const CREATIVE_PRO_EFFECT_TYPES = ["lumetri-creative", "lens-correction"] as const;

export type CreativeProEffectType = (typeof CREATIVE_PRO_EFFECT_TYPES)[number];

const CREATIVE_SET: ReadonlySet<string> = new Set(CREATIVE_PRO_EFFECT_TYPES);

export function isCreativeProEffectType(type: string): type is CreativeProEffectType {
  return CREATIVE_SET.has(type);
}

/** Lens correction resamples the frame, so it writes the alpha it samples. */
export const CREATIVE_EFFECTS_WRITING_ALPHA: readonly CreativeProEffectType[] = ["lens-correction"];

const num = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
  neutral: number,
  unit?: string,
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
  keyframable: true,
  ...(wrap ? { wrap } : {}),
});

/* -------------------------------------------------------------------------- */
/* Lens profiles                                                               */
/* -------------------------------------------------------------------------- */

export interface LensProfile {
  readonly id: string;
  readonly label: string;
  /** Radial terms in the half-diagonal normalisation above (negative = barrel). */
  readonly k1: number;
  readonly k2: number;
  /** Tangential (decentering) terms. */
  readonly p1: number;
  readonly p2: number;
  /** Where the numbers come from. */
  readonly basis: string;
}

/**
 * Built-in profiles. The coefficients are representative values of the
 * typical barrel strength of each camera mode, written in the half-diagonal
 * normalisation of this module. They are NOT manufacturer data and were not
 * fitted to a specific published calibration set: use `strength` and the
 * manual mode to fine-tune, and add a measured profile through the table when
 * one is available (OpenCV `calibrateCamera` on a checkerboard produces k1,
 * k2, p1, p2 in the same model, once rescaled to this normalisation).
 */
export const LENS_PROFILES: readonly LensProfile[] = [
  { id: "gopro-wide", label: "GoPro Hero (Wide)", k1: -0.28, k2: 0.06, p1: 0, p2: 0, basis: "typical Wide FOV barrel" },
  { id: "gopro-superview", label: "GoPro Hero (SuperView)", k1: -0.34, k2: 0.08, p1: 0, p2: 0, basis: "typical SuperView barrel (stretched wide)" },
  { id: "dji-action", label: "DJI Osmo Action (Wide)", k1: -0.2, k2: 0.04, p1: 0, p2: 0, basis: "typical action camera wide mode" },
  { id: "dji-drone-wide", label: "DJI Mavic / Mini (24 mm)", k1: -0.09, k2: 0.02, p1: 0, p2: 0, basis: "typical drone 24 mm equivalent" },
  { id: "dji-drone-ultrawide", label: "DJI Air / Avata (Ultra-wide)", k1: -0.18, k2: 0.04, p1: 0, p2: 0, basis: "typical drone ultra-wide mode" },
  { id: "iphone-wide", label: "iPhone Wide (26 mm)", k1: -0.02, k2: 0, p1: 0, p2: 0, basis: "main phone camera, slight residual barrel" },
  { id: "iphone-ultrawide", label: "iPhone Ultra Wide (13 mm)", k1: -0.1, k2: 0.02, p1: 0, p2: 0, basis: "typical phone ultra-wide barrel" },
];

const PROFILE_BY_ID: ReadonlyMap<string, LensProfile> = new Map(LENS_PROFILES.map((p) => [p.id, p]));

export function getLensProfile(id: string): LensProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

/** Largest radial / tangential terms the manual sliders reach at +-100. */
export const MANUAL_K1_RANGE = 0.5;
export const MANUAL_K2_RANGE = 0.25;
export const MANUAL_TANGENTIAL_RANGE = 0.05;
/** Lateral chromatic aberration slider range: +-100 is +-1 % of the radius. */
export const CA_RANGE = 0.01;

/* -------------------------------------------------------------------------- */
/* Specs                                                                       */
/* -------------------------------------------------------------------------- */

const lensProfileSelect: ProEffectParamSpec = {
  key: "profile",
  label: "Profile",
  kind: "select",
  default: "manual",
  neutral: "manual",
  options: [
    { value: "manual", label: "Manual" },
    ...LENS_PROFILES.map((p) => ({ value: p.id, label: p.label })),
  ],
};

export const CREATIVE_PRO_EFFECT_SPECS: Readonly<Record<CreativeProEffectType, ProEffectSpec>> = {
  "lumetri-creative": {
    type: "lumetri-creative",
    label: "Lumetri Creative",
    description: "Faded Film, skin-protecting Vibrance, Sharpen, and Shadow / Highlight Tint with Tint Balance",
    category: "Color" satisfies ProEffectCategory,
    params: [
      num("fadedFilm", "Faded Film", 0, 100, 1, 25, 0, "%"),
      num("sharpen", "Sharpen", 0, 100, 1, 0, 0, "%"),
      num("vibrance", "Vibrance", -100, 100, 1, 30, 0, "%"),
      num("shadowTintHue", "Shadow Tint hue", 0, 360, 1, 210, 210, "deg", 360),
      num("shadowTintAmount", "Shadow Tint amount", 0, 100, 1, 0, 0, "%"),
      num("highlightTintHue", "Highlight Tint hue", 0, 360, 1, 40, 40, "deg", 360),
      num("highlightTintAmount", "Highlight Tint amount", 0, 100, 1, 0, 0, "%"),
      num("tintBalance", "Tint Balance", -100, 100, 1, 0, 0, "%"),
    ],
  },
  "lens-correction": {
    type: "lens-correction",
    label: "Lens Correction",
    description: "Remove lens distortion (camera profiles or manual), chromatic aberration and vignetting",
    category: "Repair",
    params: [
      lensProfileSelect,
      num("strength", "Profile strength", 0, 150, 1, 100, 100, "%"),
      num("distortion", "Distortion (manual)", -100, 100, 1, 25, 0, "%"),
      num("curvature", "Curvature (manual)", -100, 100, 1, 0, 0, "%"),
      num("tangentialX", "Tangential X (manual)", -100, 100, 1, 0, 0, "%"),
      num("tangentialY", "Tangential Y (manual)", -100, 100, 1, 0, 0, "%"),
      num("scale", "Scale", 50, 150, 1, 100, 100, "%"),
      num("caRed", "Red/Cyan fringe", -100, 100, 1, 0, 0, "%"),
      num("caBlue", "Blue/Yellow fringe", -100, 100, 1, 0, 0, "%"),
      num("vignette", "Vignette compensation", -100, 100, 1, 0, 0, "%"),
    ],
  },
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const n = (p: Readonly<Record<string, number | boolean | string>>, key: string): number => p[key] as number;

/** Resolved params clamped to the spec ranges (keyframe interpolation can overshoot). */
export function normalizeCreativeParams(
  type: CreativeProEffectType,
  p: ResolvedProParams,
): ResolvedProParams {
  const out: ResolvedProParams = { ...p };
  for (const s of CREATIVE_PRO_EFFECT_SPECS[type].params) {
    if (s.kind === "number") out[s.key] = clamp(p[s.key] as number, s.min ?? -Infinity, s.max ?? Infinity);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Lumetri Creative                                                            */
/* -------------------------------------------------------------------------- */

/** Faded Film lifts black by up to this fraction of the range at 100 %. */
export const FADED_FILM_MAX_LIFT = 0.25;
/** Sharpen strength (unsharp gain on luma) at 100 %. */
export const SHARPEN_MAX_GAIN = 1.5;
/** Tint offset (chroma added at luma 0) at 100 %. */
export const TINT_MAX_STRENGTH = 0.5;
/** Vibrance: how much of the effect skin hues keep (1 - this is the protection). */
export const VIBRANCE_SKIN_PROTECTION = 0.8;
/** Skin hue centre and the half widths of the full / fading bands, in degrees. */
export const SKIN_HUE_CENTER = 25;
export const SKIN_HUE_FULL = 20;
export const SKIN_HUE_FADE = 50;

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Hue in degrees (0..360) of an RGB triple in 0..1; 0 for grays. Same branch order as the shader. */
export function rgbHueDegrees(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d <= 0) return 0;
  let h: number;
  if (mx === r) {
    h = (g - b) / d;
    if (h < 0) h += 6;
  } else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

/** 1 for skin-like hues (orange-red), fading to 0 away from them. */
export function skinHueWeight(hueDeg: number): number {
  const dh = Math.abs(((((hueDeg - SKIN_HUE_CENTER + 180) % 360) + 360) % 360) - 180);
  return 1 - smoothstep(SKIN_HUE_FULL, SKIN_HUE_FADE, dh);
}

/**
 * Vibrance on one pixel. Positive vibrance boosts the least saturated colours
 * most; negative vibrance removes saturation from the most saturated colours
 * most. Skin hues keep only (1 - VIBRANCE_SKIN_PROTECTION) of the change.
 * `amount` is -1..1.
 */
export function applyVibranceToRgb(
  r: number,
  g: number,
  b: number,
  amount: number,
): [number, number, number] {
  if (amount === 0) return [r, g, b];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const s = mx > 0 ? (mx - mn) / mx : 0;
  const skin = skinHueWeight(rgbHueDegrees(r, g, b));
  const protect = 1 - VIBRANCE_SKIN_PROTECTION * skin;
  const k = 1 + (amount > 0 ? amount * (1 - s) : amount * s) * protect;
  const y = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  return [y + (r - y) * k, y + (g - y) * k, y + (b - y) * k];
}

/** Plain saturation on one pixel (the reference vibrance is compared against). */
export function applySaturationToRgb(
  r: number,
  g: number,
  b: number,
  amount: number,
): [number, number, number] {
  const y = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  const k = 1 + amount;
  return [y + (r - y) * k, y + (g - y) * k, y + (b - y) * k];
}

/** Fully saturated colour of a hue (degrees), RGB 0..1. */
export function hueToRgb(hueDeg: number): [number, number, number] {
  const h = ((((hueDeg % 360) + 360) % 360) / 360) * 6;
  return [
    clamp(Math.abs(h - 3) - 1, 0, 1),
    clamp(2 - Math.abs(h - 2), 0, 1),
    clamp(2 - Math.abs(h - 4), 0, 1),
  ];
}

/** The chroma-only offset a tint adds (zero luma change, so brightness is kept). */
export function tintOffset(hueDeg: number, amountPct: number): [number, number, number] {
  const strength = (clamp(amountPct, 0, 100) / 100) * TINT_MAX_STRENGTH;
  if (strength === 0) return [0, 0, 0];
  const [tr, tg, tb] = hueToRgb(hueDeg);
  const y = tr * LUMA_R + tg * LUMA_G + tb * LUMA_B;
  return [(tr - y) * strength, (tg - y) * strength, (tb - y) * strength];
}

/** Luma where shadow tint hands over to highlight tint: 0.5 at balance 0, +-0.4 at +-100. */
export function tintPivot(balancePct: number): number {
  return clamp(0.5 + 0.4 * (clamp(balancePct, -100, 100) / 100), 0.1, 0.9);
}

/** Shadow / highlight tint weights of a luma for a pivot (zero at the pivot, so midtones stay clean). */
export function tintWeights(luma: number, pivot: number): [number, number] {
  return [1 - smoothstep(0, pivot, luma), smoothstep(pivot, 1, luma)];
}

export function faded(c: number, lift: number): number {
  return lift + c * (1 - lift);
}

export interface CreativeStages {
  /** 0..FADED_FILM_MAX_LIFT */
  lift: number;
  /** Unsharp gain on luma (0 = off). */
  sharpen: number;
  /** -1..1 */
  vibrance: number;
  shadowOffset: [number, number, number];
  highlightOffset: [number, number, number];
  pivot: number;
}

export function creativeStages(p: ResolvedProParams): CreativeStages {
  return {
    lift: (n(p, "fadedFilm") / 100) * FADED_FILM_MAX_LIFT,
    sharpen: (n(p, "sharpen") / 100) * SHARPEN_MAX_GAIN,
    vibrance: n(p, "vibrance") / 100,
    shadowOffset: tintOffset(n(p, "shadowTintHue"), n(p, "shadowTintAmount")),
    highlightOffset: tintOffset(n(p, "highlightTintHue"), n(p, "highlightTintAmount")),
    pivot: tintPivot(n(p, "tintBalance")),
  };
}

function isCreativeStagesNeutral(s: CreativeStages): boolean {
  const zero = (v: readonly number[]): boolean => v.every((x) => x === 0);
  return (
    s.lift === 0 &&
    s.sharpen === 0 &&
    s.vibrance === 0 &&
    zero(s.shadowOffset) &&
    zero(s.highlightOffset)
  );
}

/** The 3x3 binomial kernel (1 2 1 / 2 4 2 / 1 2 1) / 16 the sharpen stage subtracts. */
const BLUR_TAPS: readonly (readonly [number, number, number])[] = [
  [-1, -1, 1], [0, -1, 2], [1, -1, 1],
  [-1, 0, 2], [0, 0, 4], [1, 0, 2],
  [-1, 1, 1], [0, 1, 2], [1, 1, 1],
];

/** Lumetri Creative CPU reference: float arithmetic per pixel, one rounding at the end. Alpha untouched. */
export function applyLumetriCreative(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  stages: CreativeStages,
): void {
  if (isCreativeStagesNeutral(stages)) return;
  const src = stages.sharpen > 0 ? new Uint8ClampedArray(data) : data;
  const lumaAt = (x: number, y: number): number => {
    const o = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    return (src[o] * LUMA_R + src[o + 1] * LUMA_G + src[o + 2] * LUMA_B) / 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = src[o] / 255;
      let g = src[o + 1] / 255;
      let b = src[o + 2] / 255;
      if (stages.sharpen > 0) {
        let blur = 0;
        for (const [dx, dy, w] of BLUR_TAPS) blur += lumaAt(x + dx, y + dy) * w;
        blur /= 16;
        const d = stages.sharpen * (r * LUMA_R + g * LUMA_G + b * LUMA_B - blur);
        r = clamp(r + d, 0, 1);
        g = clamp(g + d, 0, 1);
        b = clamp(b + d, 0, 1);
      }
      if (stages.lift > 0) {
        r = faded(r, stages.lift);
        g = faded(g, stages.lift);
        b = faded(b, stages.lift);
      }
      if (stages.vibrance !== 0) [r, g, b] = applyVibranceToRgb(r, g, b, stages.vibrance);
      const hasTint =
        stages.shadowOffset.some((v) => v !== 0) || stages.highlightOffset.some((v) => v !== 0);
      if (hasTint) {
        const [ws, wh] = tintWeights(clamp(r * LUMA_R + g * LUMA_G + b * LUMA_B, 0, 1), stages.pivot);
        r += stages.shadowOffset[0] * ws + stages.highlightOffset[0] * wh;
        g += stages.shadowOffset[1] * ws + stages.highlightOffset[1] * wh;
        b += stages.shadowOffset[2] * ws + stages.highlightOffset[2] * wh;
      }
      data[o] = Math.round(clamp(r, 0, 1) * 255);
      data[o + 1] = Math.round(clamp(g, 0, 1) * 255);
      data[o + 2] = Math.round(clamp(b, 0, 1) * 255);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Lens correction                                                             */
/* -------------------------------------------------------------------------- */

export interface LensCoefficients {
  k1: number;
  k2: number;
  p1: number;
  p2: number;
}

/** Effective Brown-Conrady terms: the profile scaled by strength, or the manual sliders. */
export function lensCoefficients(p: ResolvedProParams): LensCoefficients {
  const profile = getLensProfile(p.profile as string);
  if (profile) {
    const s = n(p, "strength") / 100;
    return { k1: profile.k1 * s, k2: profile.k2 * s, p1: profile.p1 * s, p2: profile.p2 * s };
  }
  return {
    k1: (-n(p, "distortion") / 100) * MANUAL_K1_RANGE,
    k2: (-n(p, "curvature") / 100) * MANUAL_K2_RANGE,
    p1: (n(p, "tangentialX") / 100) * MANUAL_TANGENTIAL_RANGE,
    p2: (n(p, "tangentialY") / 100) * MANUAL_TANGENTIAL_RANGE,
  };
}

export interface LensStages extends LensCoefficients {
  /** 1 / scale */
  invScale: number;
  /** Radial scale of the red / blue sampling against green (1 = aligned). */
  redScale: number;
  blueScale: number;
  /** Gain slope on the squared radius. */
  vignette: number;
}

export function lensStages(p: ResolvedProParams): LensStages {
  return {
    ...lensCoefficients(p),
    invScale: 100 / Math.max(n(p, "scale"), 1),
    redScale: 1 + (n(p, "caRed") / 100) * CA_RANGE,
    blueScale: 1 + (n(p, "caBlue") / 100) * CA_RANGE,
    vignette: n(p, "vignette") / 100,
  };
}

function isLensStagesNeutral(s: LensStages): boolean {
  return (
    s.k1 === 0 &&
    s.k2 === 0 &&
    s.p1 === 0 &&
    s.p2 === 0 &&
    s.invScale === 1 &&
    s.redScale === 1 &&
    s.blueScale === 1 &&
    s.vignette === 0
  );
}

/**
 * The source position (normalised, centre origin) the undistorted position
 * (x, y) samples: the Brown-Conrady forward model above.
 */
export function distortPoint(
  x: number,
  y: number,
  c: LensCoefficients,
): [number, number] {
  const r2 = x * x + y * y;
  const radial = 1 + c.k1 * r2 + c.k2 * r2 * r2;
  return [
    x * radial + 2 * c.p1 * x * y + c.p2 * (r2 + 2 * x * x),
    y * radial + c.p1 * (r2 + 2 * y * y) + 2 * c.p2 * x * y,
  ];
}

/** Bilinear sample of one channel at texel-index coordinates (pixel centres on integers), edge clamp. */
function bilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  ch: number,
): number {
  const x = clamp(fx, 0, width - 1);
  const y = clamp(fy, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = src[(y0 * width + x0) * 4 + ch] * (1 - tx) + src[(y0 * width + x1) * 4 + ch] * tx;
  const bottom = src[(y1 * width + x0) * 4 + ch] * (1 - tx) + src[(y1 * width + x1) * 4 + ch] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Lens correction CPU reference. */
export function applyLensCorrection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  s: LensStages,
): void {
  if (isLensStagesNeutral(s)) return;
  const src = new Uint8ClampedArray(data);
  const hx = width / 2;
  const hy = height / 2;
  const norm = Math.hypot(width, height) / 2;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const qx = ((px + 0.5 - hx) / norm) * s.invScale;
      const qy = ((py + 0.5 - hy) / norm) * s.invScale;
      const [dx, dy] = distortPoint(qx, qy, s);
      const gx = hx + dx * norm - 0.5;
      const gy = hy + dy * norm - 0.5;
      const o = (py * width + px) * 4;
      const r = bilinear(src, width, height, hx + dx * norm * s.redScale - 0.5, hy + dy * norm * s.redScale - 0.5, 0);
      const g = bilinear(src, width, height, gx, gy, 1);
      const b = bilinear(src, width, height, hx + dx * norm * s.blueScale - 0.5, hy + dy * norm * s.blueScale - 0.5, 2);
      const a = bilinear(src, width, height, gx, gy, 3);
      const gain = 1 + s.vignette * (dx * dx + dy * dy);
      data[o] = Math.round(clamp((r / 255) * gain, 0, 1) * 255);
      data[o + 1] = Math.round(clamp((g / 255) * gain, 0, 1) * 255);
      data[o + 2] = Math.round(clamp((b / 255) * gain, 0, 1) * 255);
      data[o + 3] = Math.round(a);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Dispatch and GPU uniforms                                                   */
/* -------------------------------------------------------------------------- */

export function isCreativeNeutral(type: CreativeProEffectType, resolved: ResolvedProParams): boolean {
  const p = normalizeCreativeParams(type, resolved);
  return type === "lumetri-creative"
    ? isCreativeStagesNeutral(creativeStages(p))
    : isLensStagesNeutral(lensStages(p));
}

export function applyCreativeProEffect(
  type: CreativeProEffectType,
  resolved: ResolvedProParams,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const p = normalizeCreativeParams(type, resolved);
  if (type === "lumetri-creative") applyLumetriCreative(data, width, height, creativeStages(p));
  else applyLensCorrection(data, width, height, lensStages(p));
}

export function creativeProEffectGpuUniforms(
  type: CreativeProEffectType,
  resolved: ResolvedProParams,
): Record<string, number> {
  const p = normalizeCreativeParams(type, resolved);
  if (type === "lumetri-creative") {
    const s = creativeStages(p);
    return {
      lift: s.lift,
      sharpen: s.sharpen,
      vibrance: s.vibrance,
      shR: s.shadowOffset[0],
      shG: s.shadowOffset[1],
      shB: s.shadowOffset[2],
      hiR: s.highlightOffset[0],
      hiG: s.highlightOffset[1],
      hiB: s.highlightOffset[2],
      pivot: s.pivot,
    };
  }
  const s = lensStages(p);
  return {
    k1: s.k1,
    k2: s.k2,
    p1: s.p1,
    p2: s.p2,
    invScale: s.invScale,
    redScale: s.redScale,
    blueScale: s.blueScale,
    vig: s.vignette,
  };
}

/**
 * One-click starting points for the effects browser: each applies the effect
 * with these parameters (everything else at its default).
 */
export const CREATIVE_PRESETS: readonly {
  readonly id: string;
  readonly type: CreativeProEffectType;
  readonly label: string;
  readonly description: string;
  readonly params: Record<string, number | string>;
}[] = [
  { id: "creative-faded-film", type: "lumetri-creative", label: "Faded Film", description: "Lifted blacks and a soft, muted look", params: { fadedFilm: 45, vibrance: -10, sharpen: 0, shadowTintAmount: 0, highlightTintAmount: 0 } },
  { id: "creative-vibrance-boost", type: "lumetri-creative", label: "Vibrance Boost", description: "Richer colour that leaves skin tones alone", params: { fadedFilm: 0, vibrance: 60, sharpen: 0, shadowTintAmount: 0, highlightTintAmount: 0 } },
  { id: "creative-teal-orange", type: "lumetri-creative", label: "Teal and Orange Tint", description: "Teal shadows, warm highlights", params: { fadedFilm: 10, vibrance: 15, sharpen: 0, shadowTintHue: 190, shadowTintAmount: 45, highlightTintHue: 35, highlightTintAmount: 40, tintBalance: 0 } },
  { id: "creative-crisp", type: "lumetri-creative", label: "Crisp Sharpen", description: "Subtle detail sharpening", params: { fadedFilm: 0, vibrance: 0, sharpen: 35, shadowTintAmount: 0, highlightTintAmount: 0 } },
  ...LENS_PROFILES.map((profile) => ({
    id: `lens-${profile.id}`,
    type: "lens-correction" as const,
    label: `Lens: ${profile.label}`,
    description: `Corrects the ${profile.basis}`,
    params: { profile: profile.id, strength: 100 } as Record<string, number | string>,
  })),
  { id: "lens-manual-barrel", type: "lens-correction", label: "Lens: Manual Barrel Fix", description: "Manual distortion, curvature and tangential sliders", params: { profile: "manual", distortion: 25 } },
  { id: "lens-fringe-vignette", type: "lens-correction", label: "Lens: Fringe and Vignette", description: "Chromatic aberration and edge falloff only", params: { profile: "manual", distortion: 0, caRed: 30, caBlue: -30, vignette: 30 } },
];
