/**
 * Pro effects library (Premiere-staple looks).
 *
 * This module is the single source of truth for the effects:
 *  - PRO_EFFECT_SPECS: labels, parameter ranges, defaults, neutral values and
 *    which parameters can be keyframed (drives the inspector and keyframes UI).
 *  - CPU reference implementations: pure, deterministic RGBA buffer functions
 *    that mutate `data` in place. They are the Canvas2D fallback and the
 *    reference the GLSL shaders in `pro-effect-shaders.ts` are written against.
 *  - proEffectGpuUniforms: the shared mapping from stored params to the shader
 *    uniforms, so any value derived on the CPU side (lens scale, VHS frame
 *    index, ...) is computed exactly once for both paths.
 *
 * Every effect is an exact no-op for its neutral parameters. All randomness is
 * a pure hash of (seed, clip-local time, position) so preview == export.
 */

import {
  applyHslSecondary,
  isSecondaryCorrectionNeutral,
  secondaryUniforms,
} from "./hsl-secondary";
import {
  EXTRA_EFFECTS_WRITING_ALPHA,
  EXTRA_PRO_EFFECT_SPECS,
  EXTRA_PRO_EFFECT_TYPES,
  EXTRA_TIME_DRIVEN,
  applyExtraProEffect,
  extraProEffectGpuUniforms,
  isExtraNeutral,
  isExtraProEffectType,
} from "./pro-effects-extra";
import {
  CREATIVE_EFFECTS_WRITING_ALPHA,
  CREATIVE_PRO_EFFECT_SPECS,
  CREATIVE_PRO_EFFECT_TYPES,
  applyCreativeProEffect,
  creativeProEffectGpuUniforms,
  isCreativeNeutral,
  isCreativeProEffectType,
} from "./creative-effects";
import {
  REPAIR_EFFECTS_WRITING_ALPHA,
  REPAIR_PRO_EFFECT_SPECS,
  REPAIR_PRO_EFFECT_TYPES,
  applyRepairProEffect,
  isRepairNeutral,
  isRepairProEffectType,
  repairProEffectGpuUniforms,
} from "./repair-effects";
import {
  VR_EFFECTS_WRITING_ALPHA,
  VR_PRO_EFFECT_SPECS,
  VR_PRO_EFFECT_TYPES,
  isVrNeutral,
  isVrProEffectType,
} from "./vr-effect-specs";
import {
  VR_IMAGE_EFFECT_SPECS,
  VR_IMAGE_EFFECT_TYPES,
  VR_IMAGE_TIME_DRIVEN,
  isVrImageEffectType,
  isVrImageNeutral,
} from "./vr-image-effect-specs";
import { requireVrRuntime } from "./vr-runtime-loader";
import {
  TEMPORAL_EFFECTS_WRITING_ALPHA,
  TEMPORAL_PRO_EFFECT_SPECS,
  TEMPORAL_PRO_EFFECT_TYPES,
  isTemporalEffectType,
  isTemporalNeutral,
} from "./temporal-effects";

const BASE_PRO_EFFECT_TYPES = [
  "mosaic",
  "posterize",
  "mirror",
  "lens-distortion",
  "directional-blur",
  "find-edges",
  "emboss",
  "exposure",
  "threshold",
  "halftone",
  "vhs-glitch",
  "unsharp-mask",
  "gaussian-blur",
  "crop",
  "vibrance",
  "skew",
  "hsl-secondary",
] as const;

/** Base library plus the wave 7 breadth batch (pro-effects-extra.ts). */
export const PRO_EFFECT_TYPES = [
  ...BASE_PRO_EFFECT_TYPES,
  ...EXTRA_PRO_EFFECT_TYPES,
  ...REPAIR_PRO_EFFECT_TYPES,
  ...CREATIVE_PRO_EFFECT_TYPES,
  ...TEMPORAL_PRO_EFFECT_TYPES,
  ...VR_PRO_EFFECT_TYPES,
  ...VR_IMAGE_EFFECT_TYPES,
] as const;

export type ProEffectType = (typeof PRO_EFFECT_TYPES)[number];

export function isProEffectType(type: string): type is ProEffectType {
  return (PRO_EFFECT_TYPES as readonly string[]).includes(type);
}

/**
 * Effects that legitimately write alpha (feathered crop edges, skew exposure).
 * Every other pro effect leaves alpha of opaque input untouched.
 */
export const PRO_EFFECTS_WRITING_ALPHA: readonly ProEffectType[] = [
  "crop",
  "skew",
  ...EXTRA_EFFECTS_WRITING_ALPHA,
  ...REPAIR_EFFECTS_WRITING_ALPHA,
  ...CREATIVE_EFFECTS_WRITING_ALPHA,
  ...TEMPORAL_EFFECTS_WRITING_ALPHA,
  ...VR_EFFECTS_WRITING_ALPHA,
];

export type MirrorMode = "none" | "horizontal" | "vertical" | "quad";

export type ProEffectCategory =
  | "Stylize"
  | "Creative"
  | "Blur"
  | "Color"
  | "Keying"
  | "Distort"
  | "Generate"
  | "Time"
  | "Repair"
  | "Immersive Video";

export interface ProEffectParamSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: "number" | "toggle" | "select";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly default: number | boolean | string;
  /** Value under which the effect leaves the picture unchanged. */
  readonly neutral: number | boolean | string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** Numeric params that appear in the keyframes inspector. */
  readonly keyframable?: boolean;
  /** Angle parameter with this period (degrees): keyframes interpolate along the shorter arc instead of the long way round. */
  readonly wrap?: number;
  /** A clearly non-neutral value `proEffectActingParams` uses for this parameter when the effect's defaults are neutral (tests, the effects sweep). */
  readonly acting?: number | boolean | string;
}

export interface ProEffectSpec {
  readonly type: ProEffectType;
  readonly label: string;
  readonly description: string;
  readonly category: ProEffectCategory;
  readonly params: readonly ProEffectParamSpec[];
}

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
});

const toggle = (
  key: string,
  label: string,
  def: boolean,
  neutral: boolean,
): ProEffectParamSpec => ({ key, label, kind: "toggle", default: def, neutral });

export const PRO_EFFECT_SPECS: Readonly<Record<ProEffectType, ProEffectSpec>> = {
  ...EXTRA_PRO_EFFECT_SPECS,
  ...REPAIR_PRO_EFFECT_SPECS,
  ...CREATIVE_PRO_EFFECT_SPECS,
  ...TEMPORAL_PRO_EFFECT_SPECS,
  ...VR_PRO_EFFECT_SPECS,
  ...VR_IMAGE_EFFECT_SPECS,
  mosaic: {
    type: "mosaic",
    label: "Mosaic",
    description: "Pixelate into solid colour blocks",
    category: "Stylize",
    params: [num("size", "Block size", 1, 200, 1, 12, 1, "px")],
  },
  posterize: {
    type: "posterize",
    label: "Posterize",
    description: "Reduce to a few tonal levels",
    category: "Stylize",
    params: [num("levels", "Levels", 2, 256, 1, 6, 256)],
  },
  mirror: {
    type: "mirror",
    label: "Mirror",
    description: "Reflect horizontally, vertically or in quads",
    category: "Creative",
    params: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        default: "horizontal",
        neutral: "none",
        options: [
          { value: "none", label: "Off" },
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
          { value: "quad", label: "Quad" },
        ],
      },
      num("center", "Center", 0, 100, 1, 50, 50, "%"),
    ],
  },
  "lens-distortion": {
    type: "lens-distortion",
    label: "Lens Distortion",
    description: "Barrel or pincushion warp with zoom compensation",
    category: "Creative",
    params: [
      num("amount", "Curvature", -100, 100, 1, 40, 0),
      num("zoom", "Zoom", 10, 400, 1, 100, 100, "%"),
      toggle("compensate", "Fill frame", true, true),
    ],
  },
  "directional-blur": {
    type: "directional-blur",
    label: "Directional Blur",
    description: "Blur along an angle and length",
    category: "Blur",
    params: [
      num("angle", "Angle", 0, 360, 1, 0, 0, "°"),
      num("length", "Length", 0, 200, 1, 20, 0, "px"),
    ],
  },
  "find-edges": {
    type: "find-edges",
    label: "Find Edges",
    description: "Sketch-style edge detection",
    category: "Stylize",
    params: [
      num("amount", "Blend", 0, 100, 1, 100, 0, "%"),
      toggle("invert", "Invert", false, false),
    ],
  },
  emboss: {
    type: "emboss",
    label: "Emboss",
    description: "Raised relief lit from an angle",
    category: "Stylize",
    params: [
      num("amount", "Blend", 0, 100, 1, 100, 0, "%"),
      num("angle", "Light angle", 0, 360, 1, 135, 135, "°"),
      num("relief", "Relief", 0, 10, 0.1, 1, 1),
    ],
  },
  exposure: {
    type: "exposure",
    label: "Exposure",
    description: "Exposure in stops (linear light), offset and gamma",
    category: "Color",
    params: [
      num("exposure", "Exposure", -5, 5, 0.05, 0.5, 0, " EV"),
      num("offset", "Offset", -0.5, 0.5, 0.01, 0, 0),
      num("gamma", "Gamma", 0.2, 3, 0.01, 1, 1),
    ],
  },
  threshold: {
    type: "threshold",
    label: "Threshold",
    description: "Pure black and white at a luma level",
    category: "Stylize",
    params: [
      num("level", "Level", 0, 255, 1, 128, 128),
      num("mix", "Blend", 0, 100, 1, 100, 0, "%"),
    ],
  },
  halftone: {
    type: "halftone",
    label: "Halftone",
    description: "Print-style dot screen",
    category: "Stylize",
    params: [
      num("dotSize", "Dot size", 2, 100, 1, 8, 8, "px"),
      num("angle", "Angle", 0, 360, 1, 45, 45, "°"),
      num("amount", "Blend", 0, 100, 1, 100, 0, "%"),
      toggle("invert", "Invert", false, false),
    ],
  },
  "vhs-glitch": {
    type: "vhs-glitch",
    label: "VHS / Glitch",
    description: "Scanlines, RGB split, tracking jitter and noise",
    category: "Stylize",
    params: [
      num("scanlines", "Scanlines", 0, 100, 1, 35, 0, "%"),
      num("rgbSplit", "RGB split", 0, 100, 1, 4, 0, "px"),
      num("jitter", "Jitter", 0, 200, 1, 6, 0, "px"),
      num("noise", "Noise", 0, 100, 1, 10, 0, "%"),
      num("time", "Time offset", 0, 3600, 0.1, 0, 0, "s", false),
      num("seed", "Seed", 0, 9999, 1, 1, 1, undefined, false),
    ],
  },
  "unsharp-mask": {
    type: "unsharp-mask",
    label: "Unsharp Mask",
    description: "Amount, radius and threshold sharpening",
    category: "Creative",
    params: [
      num("amount", "Amount", 0, 500, 1, 100, 0, "%"),
      num("radius", "Radius", 0.1, 50, 0.1, 2, 2, "px"),
      num("threshold", "Threshold", 0, 255, 1, 0, 0),
    ],
  },
  "gaussian-blur": {
    type: "gaussian-blur",
    label: "Gaussian Blur (H/V)",
    description: "Gaussian blur with separate horizontal and vertical amounts",
    category: "Blur",
    params: [
      num("blurX", "Horizontal", 0, 100, 1, 10, 0, "px"),
      num("blurY", "Vertical", 0, 100, 1, 10, 0, "px"),
    ],
  },
  crop: {
    type: "crop",
    label: "Crop (Feather)",
    description: "Trim the frame edges with a feathered, transparent border",
    category: "Creative",
    params: [
      num("left", "Left", 0, 100, 0.5, 10, 0, "%"),
      num("top", "Top", 0, 100, 0.5, 10, 0, "%"),
      num("right", "Right", 0, 100, 0.5, 10, 0, "%"),
      num("bottom", "Bottom", 0, 100, 0.5, 10, 0, "%"),
      num("feather", "Edge feather", 0, 100, 1, 12, 0, "px"),
    ],
  },
  vibrance: {
    type: "vibrance",
    label: "Vibrance",
    description: "Boost muted colours more than already-saturated ones",
    category: "Color",
    params: [
      num("vibrance", "Vibrance", -100, 100, 1, 50, 0),
      num("saturation", "Saturation", -100, 100, 1, 0, 0),
    ],
  },
  skew: {
    type: "skew",
    label: "Skew",
    description: "Shear the frame horizontally and vertically about its centre",
    category: "Creative",
    params: [
      num("skewX", "Skew X", -60, 60, 1, 20, 0, "°"),
      num("skewY", "Skew Y", -60, 60, 1, 0, 0, "°"),
    ],
  },
  "hsl-secondary": {
    type: "hsl-secondary",
    label: "HSL Secondary",
    description:
      "Key a colour range with H/S/L qualifiers and correct it only through the matte",
    category: "Color",
    params: [
      num("hueMin", "Hue min", 0, 360, 1, 0, 0, "°"),
      num("hueMax", "Hue max", 0, 360, 1, 360, 360, "°"),
      num("hueSoft", "Hue softness", 0, 180, 1, 10, 10, "°"),
      num("satMin", "Saturation min", 0, 100, 1, 0, 0, "%"),
      num("satMax", "Saturation max", 0, 100, 1, 100, 100, "%"),
      num("satSoft", "Saturation softness", 0, 100, 1, 10, 10, "%"),
      num("lumMin", "Luma min", 0, 100, 1, 0, 0, "%"),
      num("lumMax", "Luma max", 0, 100, 1, 100, 100, "%"),
      num("lumSoft", "Luma softness", 0, 100, 1, 10, 10, "%"),
      num("denoise", "Denoise", 0, 100, 1, 0, 0, "%"),
      num("blur", "Blur", 0, 20, 0.5, 0, 0, "px"),
      toggle("invert", "Invert matte", false, false),
      num("temperature", "Temperature", -100, 100, 1, 0, 0),
      num("tint", "Tint", -100, 100, 1, 0, 0),
      num("contrast", "Contrast", -100, 100, 1, 0, 0),
      num("sharpen", "Sharpen", 0, 100, 1, 0, 0),
      num("saturation", "Saturation", -100, 100, 1, -50, 0),
      num("wheelX", "Wheel X", -1, 1, 0.01, 0, 0),
      num("wheelY", "Wheel Y", -1, 1, 0.01, 0, 0),
      {
        key: "maskShape",
        label: "Limit to shape",
        kind: "select",
        default: "none",
        neutral: "none",
        options: [
          { value: "none", label: "None" },
          { value: "ellipse", label: "Ellipse" },
          { value: "rectangle", label: "Rectangle" },
        ],
      },
      num("maskX", "Shape centre X", 0, 100, 0.5, 50, 50, "%"),
      num("maskY", "Shape centre Y", 0, 100, 0.5, 50, 50, "%"),
      num("maskW", "Shape width", 0, 100, 0.5, 50, 50, "%"),
      num("maskH", "Shape height", 0, 100, 0.5, 50, 50, "%"),
      num("maskFeather", "Shape feather", 0, 200, 1, 0, 0, "px"),
      toggle("maskInvert", "Invert shape", false, false),
    ],
  },
};

function paramsOf(
  pick: "default" | "neutral",
): Record<ProEffectType, Record<string, unknown>> {
  const out = {} as Record<ProEffectType, Record<string, unknown>>;
  for (const type of PRO_EFFECT_TYPES) {
    out[type] = Object.fromEntries(
      PRO_EFFECT_SPECS[type].params.map((p) => [p.key, p[pick]]),
    );
  }
  return out;
}

/** Defaults used when the effect is first added from the UI. */
export const PRO_EFFECT_DEFAULTS: Readonly<
  Record<ProEffectType, Readonly<Record<string, unknown>>>
> = paramsOf("default");

/** Parameters under which each effect leaves the image bit-identical. */
export const PRO_EFFECT_NEUTRAL_PARAMS: Readonly<
  Record<ProEffectType, Readonly<Record<string, unknown>>>
> = paramsOf("neutral");

/**
 * Params that make an effect visibly act: the defaults, except where the defaults of an effect are neutral (VR Rotate
 * Sphere is added at 0 / 0 / 0, as in Premiere), in which case every parameter takes a clearly non-neutral value
 * (numbers a fraction of their range away from neutral, toggles flipped, selects the first other option). Used by the
 * tests that ask whether an effect changes the picture; it reads only the parameter specs.
 */
export function proEffectActingParams(type: ProEffectType): Record<string, unknown> {
  const defaults = { ...PRO_EFFECT_DEFAULTS[type] };
  if (!isProEffectNeutral(type, defaults)) return defaults;
  const out: Record<string, unknown> = {};
  // A different fraction per numeric parameter, so that parameters cannot cancel each other (three angles of 180
  // degrees compose to the identity).
  const fractions = [0.1, 0.17, 0.23, 0.13];
  let numberIndex = 0;
  for (const p of PRO_EFFECT_SPECS[type].params) {
    if (p.acting !== undefined) {
      out[p.key] = p.acting;
      if (p.kind === "number") numberIndex++;
    } else if (p.kind === "number") {
      const fraction = fractions[numberIndex++ % fractions.length];
      const lo = p.min ?? -Infinity;
      const hi = p.max ?? Infinity;
      const neutral = p.neutral as number;
      const span = Number.isFinite(hi - lo) ? hi - lo : 100;
      const up = neutral + span * fraction;
      out[p.key] = up <= hi ? up : neutral - span * fraction;
    } else if (p.kind === "toggle") {
      out[p.key] = !(p.neutral as boolean);
    } else {
      out[p.key] = (p.options ?? []).find((o) => o.value !== p.neutral)?.value ?? p.neutral;
    }
  }
  return out;
}

/**
 * Params for a newly added effect. A pro effect stored with `{}` resolves to
 * its NEUTRAL values (a no-op), so every add path must seed the defaults;
 * explicit params win. Non-pro types are returned unchanged.
 */
export function withProEffectDefaults(
  type: string,
  params?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isProEffectType(type)) return params;
  return { ...PRO_EFFECT_DEFAULTS[type], ...(params ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* Agent / MCP schemas                                                         */
/* -------------------------------------------------------------------------- */

export interface ProEffectParamJsonSchema {
  readonly type: "number" | "boolean" | "string";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  readonly description: string;
}

/** JSON-schema-style description of each pro effect's parameters, derived from the specs. */
export function proEffectParamJsonSchemas(
  type: ProEffectType,
): Record<string, ProEffectParamJsonSchema> {
  const out: Record<string, ProEffectParamJsonSchema> = {};
  for (const p of PRO_EFFECT_SPECS[type].params) {
    const unit = p.unit ? ` ${p.unit.trim()}` : "";
    const dflt = ` (default ${String(p.default)}${unit}, neutral ${String(p.neutral)})`;
    if (p.kind === "number") {
      out[p.key] = {
        type: "number",
        minimum: p.min,
        maximum: p.max,
        description: `${p.label}${dflt}`,
      };
    } else if (p.kind === "toggle") {
      out[p.key] = { type: "boolean", description: `${p.label}${dflt}` };
    } else {
      out[p.key] = {
        type: "string",
        enum: (p.options ?? []).map((o) => o.value),
        description: `${p.label}${dflt}`,
      };
    }
  }
  return out;
}

/** Returns an error message when `params` has unknown keys, wrong types or out-of-range numbers. */
export function validateProEffectParams(
  type: ProEffectType,
  params: Readonly<Record<string, unknown>>,
): string | null {
  const schema = proEffectParamJsonSchemas(type);
  for (const [key, value] of Object.entries(params)) {
    const spec = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
    if (!spec) {
      return `${type} has no parameter "${key}"; valid: ${Object.keys(schema).join(", ")}`;
    }
    if (spec.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${type}.${key} must be a finite number`;
      }
      if (
        (spec.minimum !== undefined && value < spec.minimum) ||
        (spec.maximum !== undefined && value > spec.maximum)
      ) {
        return `${type}.${key} must be within ${spec.minimum}..${spec.maximum}`;
      }
    } else if (spec.type === "boolean") {
      if (typeof value !== "boolean") return `${type}.${key} must be a boolean`;
    } else if (typeof value !== "string" || !spec.enum?.includes(value)) {
      return `${type}.${key} must be one of ${spec.enum?.join(" | ")}`;
    }
  }
  return null;
}

/** One-line-per-effect catalogue for tool descriptions. */
export function describeProEffectsForAgent(): string {
  return PRO_EFFECT_TYPES.map((type) => {
    const params = PRO_EFFECT_SPECS[type].params
      .map((p) =>
        p.kind === "number"
          ? `${p.key} ${p.min}..${p.max}`
          : p.kind === "toggle"
            ? `${p.key} boolean`
            : `${p.key} ${(p.options ?? []).map((o) => o.value).join("|")}`,
      )
      .join(", ");
    return `${type} (${params})`;
  }).join("; ");
}

/* -------------------------------------------------------------------------- */
/* Keyframe properties                                                         */
/* -------------------------------------------------------------------------- */

export interface ProEffectKeyframeProperty {
  readonly id: string;
  /** Angle period in degrees when keyframes interpolate along the shorter arc; absent for ordinary numbers. */
  readonly wrap?: number;
  readonly type: ProEffectType;
  readonly key: string;
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export function proEffectKeyframePropertyId(
  type: ProEffectType,
  key: string,
): string {
  return `effect.${type}.${key}`;
}

export const PRO_EFFECT_KEYFRAME_PROPERTIES: readonly ProEffectKeyframeProperty[] =
  PRO_EFFECT_TYPES.flatMap((type) =>
    PRO_EFFECT_SPECS[type].params
      .filter((p) => p.kind === "number" && p.keyframable)
      .map((p) => ({
        id: proEffectKeyframePropertyId(type, p.key),
        ...(p.wrap ? { wrap: p.wrap } : {}),
        type,
        key: p.key,
        label: `${PRO_EFFECT_SPECS[type].label}: ${p.label}`,
        defaultValue: Number(p.neutral),
        min: p.min ?? 0,
        max: p.max ?? 100,
        step: p.step ?? 1,
      })),
  );

/** Angle period (degrees) of a pro effect parameter whose keyframes take the shorter arc; undefined for ordinary parameters. */
export function proEffectParamWrap(type: string, key: string): number | undefined {
  if (!isProEffectType(type)) return undefined;
  return PRO_EFFECT_SPECS[type].params.find((p) => p.key === key)?.wrap;
}

const KEYFRAME_PROPERTY_BY_ID: ReadonlyMap<string, ProEffectKeyframeProperty> =
  new Map(PRO_EFFECT_KEYFRAME_PROPERTIES.map((p) => [p.id, p]));

export function parseProEffectKeyframeProperty(
  property: string,
): ProEffectKeyframeProperty | null {
  return KEYFRAME_PROPERTY_BY_ID.get(property) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Parameter resolution                                                        */
/* -------------------------------------------------------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export type ResolvedProParams = Record<string, number | boolean | string>;

/**
 * Fill missing / non-finite values from the neutral set. Neutral (not default)
 * is the fallback so a keyframe-synthesised effect that only animates one
 * parameter never inherits surprising defaults for the others.
 */
export function resolveProEffectParams(
  type: ProEffectType,
  params: Readonly<Record<string, unknown>>,
): ResolvedProParams {
  const out: ResolvedProParams = {};
  for (const spec of PRO_EFFECT_SPECS[type].params) {
    const raw = params[spec.key];
    if (spec.kind === "number") {
      out[spec.key] =
        typeof raw === "number" && Number.isFinite(raw)
          ? raw
          : (spec.neutral as number);
    } else if (spec.kind === "toggle") {
      out[spec.key] = typeof raw === "boolean" ? raw : (spec.neutral as boolean);
    } else {
      out[spec.key] =
        typeof raw === "string" && spec.options?.some((o) => o.value === raw)
          ? raw
          : (spec.neutral as string);
    }
  }
  return out;
}

const n = (p: ResolvedProParams, key: string): number => p[key] as number;
const b = (p: ResolvedProParams, key: string): boolean => p[key] === true;

/** True when the effect would leave the image unchanged. */
export function isProEffectNeutral(
  type: ProEffectType,
  rawParams: Readonly<Record<string, unknown>>,
): boolean {
  const p = resolveProEffectParams(type, rawParams);
  if (isExtraProEffectType(type)) return isExtraNeutral(type, p);
  if (isRepairProEffectType(type)) return isRepairNeutral(type, p);
  if (isCreativeProEffectType(type)) return isCreativeNeutral(type, p);
  if (isTemporalEffectType(type)) return isTemporalNeutral(type, p);
  if (isVrProEffectType(type)) return isVrNeutral(type, p);
  if (isVrImageEffectType(type)) return isVrImageNeutral(type, p);
  switch (type) {
    case "mosaic":
      return Math.floor(n(p, "size")) <= 1;
    case "posterize":
      return Math.floor(n(p, "levels")) >= 256;
    case "mirror":
      return p.mode === "none";
    case "lens-distortion":
      return (
        clamp(n(p, "amount"), -100, 100) === 0 &&
        clamp(n(p, "zoom"), 10, 400) === 100
      );
    case "directional-blur":
      return clamp(n(p, "length"), 0, 400) < 1;
    case "find-edges":
    case "emboss":
    case "halftone":
      return clamp(n(p, "amount"), 0, 100) === 0;
    case "exposure":
      return (
        n(p, "exposure") === 0 &&
        n(p, "offset") === 0 &&
        clamp(n(p, "gamma"), 0.1, 5) === 1
      );
    case "threshold":
      return clamp(n(p, "mix"), 0, 100) === 0;
    case "vhs-glitch":
      return (
        clamp(n(p, "scanlines"), 0, 100) === 0 &&
        Math.round(clamp(n(p, "rgbSplit"), 0, 100)) === 0 &&
        clamp(n(p, "jitter"), 0, 200) === 0 &&
        clamp(n(p, "noise"), 0, 100) === 0
      );
    case "unsharp-mask":
      return clamp(n(p, "amount"), 0, 500) === 0;
    case "gaussian-blur":
      return (
        clamp(n(p, "blurX"), 0, 100) === 0 && clamp(n(p, "blurY"), 0, 100) === 0
      );
    case "crop":
      return (
        clamp(n(p, "left"), 0, 100) === 0 &&
        clamp(n(p, "top"), 0, 100) === 0 &&
        clamp(n(p, "right"), 0, 100) === 0 &&
        clamp(n(p, "bottom"), 0, 100) === 0
      );
    case "vibrance":
      return (
        clamp(n(p, "vibrance"), -100, 100) === 0 &&
        clamp(n(p, "saturation"), -100, 100) === 0
      );
    case "skew":
      return (
        clamp(n(p, "skewX"), -60, 60) === 0 && clamp(n(p, "skewY"), -60, 60) === 0
      );
    case "hsl-secondary": {
      const u = secondaryUniforms({ ...p, matteView: rawParams.matteView });
      return u.view === 0 && isSecondaryCorrectionNeutral(u);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic 32-bit integer hash -> [0, 1). The final value is rounded to
 * float32 so it equals the GLSL `float(h) / 4294967296.0` bit for bit.
 */
export function hash01(a: number, c: number, d: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(c | 0, 668265263)) | 0;
  h = (h + Math.imul(d | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return Math.fround(h >>> 0) / 4294967296;
}

/** 24 fps frame index of a clip-local time; epsilon guards float drift. */
export function vhsFrameIndex(time: number): number {
  return Math.floor(Math.max(0, Number.isFinite(time) ? time : 0) * 24 + 1e-6);
}

/** Seeds live in [0, 2^24) so they survive a float uniform exactly. */
export function vhsSeedInt(seed: number): number {
  const s = Math.floor(Number.isFinite(seed) ? seed : 0);
  return ((s % 16777216) + 16777216) % 16777216;
}

function vhsBandHeight(height: number): number {
  return Math.max(2, Math.round(height / 48));
}

function luma(r: number, g: number, bl: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * bl;
}

/** Solve s * (1 + k s^2) = 1 so the axis edges map back onto the frame. */
function lensCompensationScale(k: number, compensate: boolean): number {
  let scale = 1;
  if (compensate && k > 0) {
    for (let i = 0; i < 12; i++) {
      const f = scale * (1 + k * scale * scale) - 1;
      const df = 1 + 3 * k * scale * scale;
      scale -= f / df;
    }
  }
  return scale;
}

function directionalSampleCount(length: number): number {
  return Math.max(3, Math.min(64, Math.round(length)) | 1);
}

/* -------------------------------------------------------------------------- */
/* CPU reference implementations                                               */
/* -------------------------------------------------------------------------- */

export function applyMosaic(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  size: number,
): void {
  const block = Math.floor(clamp(size, 1, 400));
  if (block <= 1) return;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      const x1 = Math.min(width, bx + block);
      const y1 = Math.min(height, by + block);
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      let count = 0;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const o = (y * width + x) * 4;
          r += data[o];
          g += data[o + 1];
          bl += data[o + 2];
          a += data[o + 3];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      bl = Math.round(bl / count);
      a = Math.round(a / count);
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const o = (y * width + x) * 4;
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = bl;
          data[o + 3] = a;
        }
      }
    }
  }
}

export function applyPosterize(data: Uint8ClampedArray, levels: number): void {
  const count = Math.floor(levels);
  if (count >= 256) return;
  const steps = Math.max(2, count) - 1;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(Math.round((i / 255) * steps) * (255 / steps));
  }
  for (let o = 0; o < data.length; o += 4) {
    data[o] = lut[data[o]];
    data[o + 1] = lut[data[o + 1]];
    data[o + 2] = lut[data[o + 2]];
  }
}

export function applyMirror(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  mode: MirrorMode,
  centerPercent: number,
): void {
  if (mode === "none") return;
  const copy = new Uint8ClampedArray(data);
  const c = clamp(centerPercent, 0, 100) / 100;
  const cx = Math.round(width * c);
  const cy = Math.round(height * c);
  const horizontal = mode === "horizontal" || mode === "quad";
  const vertical = mode === "vertical" || mode === "quad";
  for (let y = 0; y < height; y++) {
    const sy = vertical && y >= cy ? clamp(2 * cy - 1 - y, 0, height - 1) : y;
    for (let x = 0; x < width; x++) {
      const sx =
        horizontal && x >= cx ? clamp(2 * cx - 1 - x, 0, width - 1) : x;
      if (sx === x && sy === y) continue;
      const o = (y * width + x) * 4;
      const s = (sy * width + sx) * 4;
      data[o] = copy[s];
      data[o + 1] = copy[s + 1];
      data[o + 2] = copy[s + 2];
      data[o + 3] = copy[s + 3];
    }
  }
}

function sampleBilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  fx: number,
  fy: number,
  out: number[],
): void {
  const x = clamp(fx, 0, width - 1);
  const y = clamp(fy, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  for (let ch = 0; ch < 4; ch++) {
    const top =
      src[(y0 * width + x0) * 4 + ch] * (1 - tx) +
      src[(y0 * width + x1) * 4 + ch] * tx;
    const bottom =
      src[(y1 * width + x0) * 4 + ch] * (1 - tx) +
      src[(y1 * width + x1) * 4 + ch] * tx;
    out[ch] = top * (1 - ty) + bottom * ty;
  }
}

/**
 * Radial lens distortion. amount > 0 is barrel, < 0 is pincushion.
 * `zoomPercent` is a manual zoom; `compensate` additionally scales a barrel
 * distortion so the edge midpoints of the frame stay filled (no empty border).
 */
export function applyLensDistortion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  zoomPercent: number,
  compensate: boolean,
): void {
  const k = clamp(amount, -100, 100) / 100;
  const zoom = clamp(zoomPercent, 10, 400) / 100;
  if (k === 0 && zoom === 1) return;

  const scale = lensCompensationScale(k, compensate);
  const copy = new Uint8ClampedArray(data);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const hx = Math.max(1, cx);
  const hy = Math.max(1, cy);
  const px: number[] = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let u = ((x - cx) / hx) * (scale / zoom);
      let v = ((y - cy) / hy) * (scale / zoom);
      const f = 1 + k * (u * u + v * v);
      u *= f;
      v *= f;
      sampleBilinear(copy, width, height, u * hx + cx, v * hy + cy, px);
      const o = (y * width + x) * 4;
      data[o] = Math.round(px[0]);
      data[o + 1] = Math.round(px[1]);
      data[o + 2] = Math.round(px[2]);
      data[o + 3] = Math.round(px[3]);
    }
  }
}

export function applyDirectionalBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  angleDeg: number,
  length: number,
): void {
  const len = clamp(length, 0, 400);
  if (len < 1) return;
  const copy = new Uint8ClampedArray(data);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const samples = directionalSampleCount(len);
  const half = len / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let i = 0; i < samples; i++) {
        const t = (i / (samples - 1) - 0.5) * 2 * half;
        const sx = clamp(Math.round(x + dx * t), 0, width - 1);
        const sy = clamp(Math.round(y + dy * t), 0, height - 1);
        const s = (sy * width + sx) * 4;
        r += copy[s];
        g += copy[s + 1];
        bl += copy[s + 2];
        a += copy[s + 3];
      }
      const o = (y * width + x) * 4;
      data[o] = Math.round(r / samples);
      data[o + 1] = Math.round(g / samples);
      data[o + 2] = Math.round(bl / samples);
      data[o + 3] = Math.round(a / samples);
    }
  }
}

export function applyFindEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amountPercent: number,
  invert: boolean,
): void {
  const mix = clamp(amountPercent, 0, 100) / 100;
  if (mix === 0) return;
  const copy = new Uint8ClampedArray(data);
  const lum = (x: number, y: number): number => {
    const o = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    return luma(copy[o], copy[o + 1], copy[o + 2]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -lum(x - 1, y - 1) -
        2 * lum(x - 1, y) -
        lum(x - 1, y + 1) +
        lum(x + 1, y - 1) +
        2 * lum(x + 1, y) +
        lum(x + 1, y + 1);
      const gy =
        -lum(x - 1, y - 1) -
        2 * lum(x, y - 1) -
        lum(x + 1, y - 1) +
        lum(x - 1, y + 1) +
        2 * lum(x, y + 1) +
        lum(x + 1, y + 1);
      const mag = clamp(Math.sqrt(gx * gx + gy * gy), 0, 255);
      const edge = invert ? mag : 255 - mag;
      const o = (y * width + x) * 4;
      data[o] = Math.round(copy[o] * (1 - mix) + edge * mix);
      data[o + 1] = Math.round(copy[o + 1] * (1 - mix) + edge * mix);
      data[o + 2] = Math.round(copy[o + 2] * (1 - mix) + edge * mix);
    }
  }
}

export function applyEmboss(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amountPercent: number,
  angleDeg: number,
  relief: number,
): void {
  const mix = clamp(amountPercent, 0, 100) / 100;
  if (mix === 0) return;
  const copy = new Uint8ClampedArray(data);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const strength = clamp(relief, 0, 10);
  const lumAt = (x: number, y: number): number => {
    const o = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    return luma(copy[o], copy[o + 1], copy[o + 2]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = lumAt(Math.round(x + dx), Math.round(y + dy));
      const bl = lumAt(Math.round(x - dx), Math.round(y - dy));
      const v = clamp(128 + (a - bl) * strength, 0, 255);
      const o = (y * width + x) * 4;
      data[o] = Math.round(copy[o] * (1 - mix) + v * mix);
      data[o + 1] = Math.round(copy[o + 1] * (1 - mix) + v * mix);
      data[o + 2] = Math.round(copy[o + 2] * (1 - mix) + v * mix);
    }
  }
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = c <= 0 ? 0 : c;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Exposure in stops (linear light), additive offset, and gamma. */
export function applyExposure(
  data: Uint8ClampedArray,
  stops: number,
  offset: number,
  gamma: number,
): void {
  const g = clamp(gamma, 0.1, 5);
  if (stops === 0 && offset === 0 && g === 1) return;
  const gain = Math.pow(2, clamp(stops, -10, 10));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let lin = srgbToLinear(i / 255) * gain + offset;
    lin = Math.pow(clamp(lin, 0, 1), 1 / g);
    lut[i] = Math.round(clamp(linearToSrgb(lin), 0, 1) * 255);
  }
  for (let o = 0; o < data.length; o += 4) {
    data[o] = lut[data[o]];
    data[o + 1] = lut[data[o + 1]];
    data[o + 2] = lut[data[o + 2]];
  }
}

export function applyThreshold(
  data: Uint8ClampedArray,
  level: number,
  mixPercent: number,
): void {
  const mix = clamp(mixPercent, 0, 100) / 100;
  if (mix === 0) return;
  for (let o = 0; o < data.length; o += 4) {
    const v = luma(data[o], data[o + 1], data[o + 2]) >= level ? 255 : 0;
    data[o] = Math.round(data[o] * (1 - mix) + v * mix);
    data[o + 1] = Math.round(data[o + 1] * (1 - mix) + v * mix);
    data[o + 2] = Math.round(data[o + 2] * (1 - mix) + v * mix);
  }
}

export function applyHalftone(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  dotSize: number,
  angleDeg: number,
  amountPercent: number,
  invert: boolean,
): void {
  const mix = clamp(amountPercent, 0, 100) / 100;
  if (mix === 0) return;
  const cell = clamp(dotSize, 2, 100);
  const copy = new Uint8ClampedArray(data);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const bg = invert ? 255 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rotate into grid space, find the cell centre, rotate back to sample.
      const gx = x * cos + y * sin;
      const gy = -x * sin + y * cos;
      const ccx = (Math.floor(gx / cell) + 0.5) * cell;
      const ccy = (Math.floor(gy / cell) + 0.5) * cell;
      const sx = clamp(Math.round(ccx * cos - ccy * sin), 0, width - 1);
      const sy = clamp(Math.round(ccx * sin + ccy * cos), 0, height - 1);
      const s = (sy * width + sx) * 4;
      const l = luma(copy[s], copy[s + 1], copy[s + 2]) / 255;
      const coverage = invert ? 1 - l : l;
      const radius = (cell / 2) * 1.2 * Math.sqrt(coverage);
      const dist = Math.hypot(gx - ccx, gy - ccy);
      const inside = clamp(radius - dist + 0.5, 0, 1);
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const ht = bg * (1 - inside) + copy[s + ch] * inside;
        data[o + ch] = Math.round(copy[o + ch] * (1 - mix) + ht * mix);
      }
    }
  }
}

/**
 * VHS / glitch: scanlines, RGB channel split, per-band horizontal jitter and
 * noise. Randomness derives only from (seed, 24fps frame index of `time`,
 * row/band) so a frame at a given clip-local time renders identically in
 * preview and export.
 */
export function applyVhsGlitch(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scanlinesPercent: number,
  rgbSplit: number,
  jitter: number,
  noisePercent: number,
  time: number,
  seed: number,
): void {
  const scan = clamp(scanlinesPercent, 0, 100) / 100;
  const split = Math.round(clamp(rgbSplit, 0, 100));
  const jit = clamp(jitter, 0, 200);
  const noise = clamp(noisePercent, 0, 100) / 100;
  if (scan === 0 && split === 0 && jit === 0 && noise === 0) return;

  const copy = new Uint8ClampedArray(data);
  const frame = vhsFrameIndex(time);
  const seedInt = vhsSeedInt(seed);
  const bandHeight = vhsBandHeight(height);

  for (let y = 0; y < height; y++) {
    const band = Math.floor(y / bandHeight);
    let shift = 0;
    if (jit > 0) {
      const gate = hash01(seedInt, frame, band * 2 + 1);
      // Only ~30% of bands tear on any given frame.
      if (gate > 0.7) {
        shift = Math.round((hash01(seedInt, frame, band * 2) * 2 - 1) * jit);
      }
    }
    const scanFactor = scan > 0 && y % 2 === 1 ? 1 - scan * 0.6 : 1;
    for (let x = 0; x < width; x++) {
      const baseX = x - shift;
      const rx = clamp(baseX + split, 0, width - 1);
      const gx = clamp(baseX, 0, width - 1);
      const bx = clamp(baseX - split, 0, width - 1);
      const row = y * width;
      let r = copy[(row + rx) * 4];
      let g = copy[(row + gx) * 4 + 1];
      let bl = copy[(row + bx) * 4 + 2];
      if (noise > 0) {
        const nz = (hash01(seedInt + x, frame, y) * 2 - 1) * noise * 60;
        r += nz;
        g += nz;
        bl += nz;
      }
      const o = (row + x) * 4;
      data[o] = Math.round(clamp(r * scanFactor, 0, 255));
      data[o + 1] = Math.round(clamp(g * scanFactor, 0, 255));
      data[o + 2] = Math.round(clamp(bl * scanFactor, 0, 255));
    }
  }
}

function gaussianKernel(radius: number): Float32Array {
  const sigma = Math.max(0.1, radius / 2);
  const size = Math.max(1, Math.ceil(radius)) * 2 + 1;
  const half = (size - 1) / 2;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - half;
    kernel[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

function gaussianBlurRgb(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const kernel = gaussianKernel(radius);
  const half = (kernel.length - 1) / 2;
  const tmp = new Float32Array(width * height * 3);
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sx = clamp(x + k - half, 0, width - 1);
          acc += src[(y * width + sx) * 4 + ch] * kernel[k];
        }
        tmp[(y * width + x) * 3 + ch] = acc;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let k = 0; k < kernel.length; k++) {
          const sy = clamp(y + k - half, 0, height - 1);
          acc += tmp[(sy * width + x) * 3 + ch] * kernel[k];
        }
        out[(y * width + x) * 3 + ch] = acc;
      }
    }
  }
  return out;
}

/** amount in percent (100 = +1x detail), radius in px, threshold 0-255. */
export function applyUnsharpMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amountPercent: number,
  radius: number,
  threshold: number,
): void {
  const amount = clamp(amountPercent, 0, 500) / 100;
  if (amount === 0) return;
  const blurred = gaussianBlurRgb(data, width, height, clamp(radius, 0.1, 50));
  const thr = clamp(threshold, 0, 255);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    for (let ch = 0; ch < 3; ch++) {
      const diff = data[o + ch] - blurred[i * 3 + ch];
      if (Math.abs(diff) < thr) continue;
      data[o + ch] = Math.round(clamp(data[o + ch] + diff * amount, 0, 255));
    }
  }
}

/**
 * Gaussian blur with independent horizontal / vertical radii (px, sigma =
 * radius / 2, edge clamped). A zero radius skips that axis exactly.
 */
export function applyGaussianBlurHV(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  blurX: number,
  blurY: number,
): void {
  const rx = clamp(blurX, 0, 100);
  const ry = clamp(blurY, 0, 100);
  if (rx === 0 && ry === 0) return;
  let src = Float32Array.from(data);
  if (rx > 0) {
    const kernel = gaussianKernel(rx);
    const half = (kernel.length - 1) / 2;
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let ch = 0; ch < 4; ch++) {
          let acc = 0;
          for (let k = 0; k < kernel.length; k++) {
            const sx = clamp(x + k - half, 0, width - 1);
            acc += src[(y * width + sx) * 4 + ch] * kernel[k];
          }
          out[(y * width + x) * 4 + ch] = acc;
        }
      }
    }
    src = out;
  }
  if (ry > 0) {
    const kernel = gaussianKernel(ry);
    const half = (kernel.length - 1) / 2;
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let ch = 0; ch < 4; ch++) {
          let acc = 0;
          for (let k = 0; k < kernel.length; k++) {
            const sy = clamp(y + k - half, 0, height - 1);
            acc += src[(sy * width + x) * 4 + ch] * kernel[k];
          }
          out[(y * width + x) * 4 + ch] = acc;
        }
      }
    }
    src = out;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.round(src[i]);
}

/** Per-edge coverage: 1 inside, 0 outside, linear ramp across `feather` px. */
function edgeCoverage(distanceInside: number, feather: number): number {
  if (feather <= 0) return distanceInside >= 0 ? 1 : 0;
  return clamp(0.5 + distanceInside / feather, 0, 1);
}

/**
 * Crops each edge by a percentage of the frame and feathers the cut over
 * `feather` px (centred on the crop line). Only edges that actually crop
 * fade; the frame border itself is never feathered. Cropped area becomes
 * transparent (alpha is scaled, colour is untouched).
 */
export function applyCropFeather(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  leftPct: number,
  topPct: number,
  rightPct: number,
  bottomPct: number,
  feather: number,
): void {
  const l = (clamp(leftPct, 0, 100) / 100) * width;
  const t = (clamp(topPct, 0, 100) / 100) * height;
  const r = (clamp(rightPct, 0, 100) / 100) * width;
  const bt = (clamp(bottomPct, 0, 100) / 100) * height;
  if (l === 0 && t === 0 && r === 0 && bt === 0) return;
  const f = clamp(feather, 0, 100);
  for (let y = 0; y < height; y++) {
    const cy =
      (t > 0 ? edgeCoverage(y + 0.5 - t, f) : 1) *
      (bt > 0 ? edgeCoverage(height - bt - (y + 0.5), f) : 1);
    for (let x = 0; x < width; x++) {
      const cov =
        cy *
        (l > 0 ? edgeCoverage(x + 0.5 - l, f) : 1) *
        (r > 0 ? edgeCoverage(width - r - (x + 0.5), f) : 1);
      if (cov >= 1) continue;
      const o = (y * width + x) * 4 + 3;
      data[o] = Math.round(data[o] * cov);
    }
  }
}

/**
 * Vibrance (low-saturation-weighted saturation boost) plus plain saturation,
 * both in -100..100. Pixel saturation is HSV s = (max - min) / max.
 */
export function applyVibrance(
  data: Uint8ClampedArray,
  vibrance: number,
  saturation: number,
): void {
  const v = clamp(vibrance, -100, 100) / 100;
  const sat = 1 + clamp(saturation, -100, 100) / 100;
  if (v === 0 && sat === 1) return;
  for (let o = 0; o < data.length; o += 4) {
    const r = data[o];
    const g = data[o + 1];
    const bl = data[o + 2];
    const mx = Math.max(r, g, bl);
    const mn = Math.min(r, g, bl);
    const s = mx > 0 ? (mx - mn) / mx : 0;
    const factor = Math.max(0, (1 + v * (1 - s)) * sat);
    const y = luma(r, g, bl);
    data[o] = Math.round(clamp(y + (r - y) * factor, 0, 255));
    data[o + 1] = Math.round(clamp(y + (g - y) * factor, 0, 255));
    data[o + 2] = Math.round(clamp(y + (bl - y) * factor, 0, 255));
  }
}

/** Inverse shear matrix (output -> source) shared by the CPU and GPU skew. */
export function skewInverse(
  skewXDeg: number,
  skewYDeg: number,
): { a: number; b: number; c: number; d: number; valid: boolean } {
  const tx = Math.tan((clamp(skewXDeg, -60, 60) * Math.PI) / 180);
  const ty = Math.tan((clamp(skewYDeg, -60, 60) * Math.PI) / 180);
  const det = 1 - tx * ty;
  // det -> 0 collapses the frame to a line (e.g. 45 deg on both axes).
  if (Math.abs(det) < 1e-3) return { a: 0, b: 0, c: 0, d: 0, valid: false };
  return { a: 1 / det, b: -tx / det, c: -ty / det, d: 1 / det, valid: true };
}

/**
 * Shears the frame about its centre. Areas of the output the source does not
 * cover become transparent. Sampling is bilinear.
 */
export function applySkew(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  skewXDeg: number,
  skewYDeg: number,
): void {
  if (clamp(skewXDeg, -60, 60) === 0 && clamp(skewYDeg, -60, 60) === 0) return;
  const m = skewInverse(skewXDeg, skewYDeg);
  const copy = new Uint8ClampedArray(data);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const px: number[] = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const sx = m.a * dx + m.b * dy + cx;
      const sy = m.c * dx + m.d * dy + cy;
      if (!m.valid || sx < -0.5 || sx > width - 0.5 || sy < -0.5 || sy > height - 0.5) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        data[o + 3] = 0;
        continue;
      }
      sampleBilinear(copy, width, height, sx, sy, px);
      data[o] = Math.round(px[0]);
      data[o + 1] = Math.round(px[1]);
      data[o + 2] = Math.round(px[2]);
      data[o + 3] = Math.round(px[3]);
    }
  }
}

/**
 * Dispatches a pro effect on an RGBA buffer. Returns false when `type` is not
 * a pro effect so callers can fall through to their own switch.
 */
export function applyProEffect(
  type: string,
  params: Readonly<Record<string, unknown>>,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  if (!isProEffectType(type)) return false;
  const p = resolveProEffectParams(type, params);
  if (isExtraProEffectType(type)) {
    applyExtraProEffect(type, p, data, width, height);
    return true;
  }
  if (isRepairProEffectType(type)) {
    applyRepairProEffect(type, p, params, data, width, height);
    return true;
  }
  if (isCreativeProEffectType(type)) {
    applyCreativeProEffect(type, p, data, width, height);
    return true;
  }
  // Temporal effects choose frames rather than recolour one: the pixel pass is the identity.
  if (isTemporalEffectType(type)) return true;
  if (isVrProEffectType(type)) {
    requireVrRuntime(type).applyVrEffect(type, p, data, width, height);
    return true;
  }
  if (isVrImageEffectType(type)) {
    requireVrRuntime(type).applyVrImageEffect(type, p, data, width, height);
    return true;
  }
  switch (type) {
    case "mosaic":
      applyMosaic(data, width, height, n(p, "size"));
      break;
    case "posterize":
      applyPosterize(data, n(p, "levels"));
      break;
    case "mirror":
      applyMirror(data, width, height, p.mode as MirrorMode, n(p, "center"));
      break;
    case "lens-distortion":
      applyLensDistortion(
        data,
        width,
        height,
        n(p, "amount"),
        n(p, "zoom"),
        b(p, "compensate"),
      );
      break;
    case "directional-blur":
      applyDirectionalBlur(data, width, height, n(p, "angle"), n(p, "length"));
      break;
    case "find-edges":
      applyFindEdges(data, width, height, n(p, "amount"), b(p, "invert"));
      break;
    case "emboss":
      applyEmboss(
        data,
        width,
        height,
        n(p, "amount"),
        n(p, "angle"),
        n(p, "relief"),
      );
      break;
    case "exposure":
      applyExposure(data, n(p, "exposure"), n(p, "offset"), n(p, "gamma"));
      break;
    case "threshold":
      applyThreshold(data, n(p, "level"), n(p, "mix"));
      break;
    case "halftone":
      applyHalftone(
        data,
        width,
        height,
        n(p, "dotSize"),
        n(p, "angle"),
        n(p, "amount"),
        b(p, "invert"),
      );
      break;
    case "vhs-glitch":
      applyVhsGlitch(
        data,
        width,
        height,
        n(p, "scanlines"),
        n(p, "rgbSplit"),
        n(p, "jitter"),
        n(p, "noise"),
        n(p, "time"),
        n(p, "seed"),
      );
      break;
    case "unsharp-mask":
      applyUnsharpMask(
        data,
        width,
        height,
        n(p, "amount"),
        n(p, "radius"),
        n(p, "threshold"),
      );
      break;
    case "gaussian-blur":
      applyGaussianBlurHV(data, width, height, n(p, "blurX"), n(p, "blurY"));
      break;
    case "crop":
      applyCropFeather(
        data,
        width,
        height,
        n(p, "left"),
        n(p, "top"),
        n(p, "right"),
        n(p, "bottom"),
        n(p, "feather"),
      );
      break;
    case "vibrance":
      applyVibrance(data, n(p, "vibrance"), n(p, "saturation"));
      break;
    case "skew":
      applySkew(data, width, height, n(p, "skewX"), n(p, "skewY"));
      break;
    case "hsl-secondary":
      applyHslSecondary(
        data,
        width,
        height,
        secondaryUniforms({ ...p, matteView: params.matteView }),
      );
      break;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* GPU uniform mapping                                                         */
/* -------------------------------------------------------------------------- */

const MIRROR_MODE_FLAGS: Readonly<
  Record<MirrorMode, readonly [number, number]>
> = {
  none: [0, 0],
  horizontal: [1, 0],
  vertical: [0, 1],
  quad: [1, 1],
};

/**
 * Maps stored params to the uniforms of the matching fragment shader. Values
 * that need CPU-side derivation (lens compensation, VHS frame/seed, sample
 * counts) are computed here so both paths share one definition. `height` is
 * only needed for the VHS band height.
 */
export function proEffectGpuUniforms(
  type: ProEffectType,
  rawParams: Readonly<Record<string, unknown>>,
  height: number,
): Record<string, number> {
  const p = resolveProEffectParams(type, rawParams);
  if (isExtraProEffectType(type)) return extraProEffectGpuUniforms(type, p);
  if (isRepairProEffectType(type)) return repairProEffectGpuUniforms(type, p, rawParams);
  if (isCreativeProEffectType(type)) return creativeProEffectGpuUniforms(type, p);
  if (isTemporalEffectType(type)) return {};
  if (isVrProEffectType(type)) return requireVrRuntime(type).vrEffectGpuUniforms(type, p);
  if (isVrImageEffectType(type)) return requireVrRuntime(type).vrImageEffectGpuUniforms(type, p);
  switch (type) {
    case "mosaic":
      return { size: Math.floor(clamp(n(p, "size"), 1, 400)) };
    case "posterize":
      return { steps: Math.max(2, Math.floor(n(p, "levels"))) - 1 };
    case "mirror": {
      const [horizontal, vertical] = MIRROR_MODE_FLAGS[p.mode as MirrorMode];
      return {
        horizontal,
        vertical,
        center: clamp(n(p, "center"), 0, 100) / 100,
      };
    }
    case "lens-distortion": {
      const k = clamp(n(p, "amount"), -100, 100) / 100;
      const zoom = clamp(n(p, "zoom"), 10, 400) / 100;
      return { k, s: lensCompensationScale(k, b(p, "compensate")) / zoom };
    }
    case "directional-blur": {
      const len = clamp(n(p, "length"), 0, 400);
      const rad = (n(p, "angle") * Math.PI) / 180;
      return {
        dx: Math.cos(rad),
        dy: Math.sin(rad),
        half: len / 2,
        samples: directionalSampleCount(len),
      };
    }
    case "find-edges":
      return {
        mix: clamp(n(p, "amount"), 0, 100) / 100,
        invert: b(p, "invert") ? 1 : 0,
      };
    case "emboss": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      return {
        mix: clamp(n(p, "amount"), 0, 100) / 100,
        dx: Math.cos(rad),
        dy: Math.sin(rad),
        strength: clamp(n(p, "relief"), 0, 10),
      };
    }
    case "exposure":
      return {
        gain: Math.pow(2, clamp(n(p, "exposure"), -10, 10)),
        offset: n(p, "offset"),
        invGamma: 1 / clamp(n(p, "gamma"), 0.1, 5),
      };
    case "threshold":
      return {
        level: n(p, "level"),
        mix: clamp(n(p, "mix"), 0, 100) / 100,
      };
    case "halftone": {
      const rad = (n(p, "angle") * Math.PI) / 180;
      return {
        cell: clamp(n(p, "dotSize"), 2, 100),
        cs: Math.cos(rad),
        sn: Math.sin(rad),
        mix: clamp(n(p, "amount"), 0, 100) / 100,
        invert: b(p, "invert") ? 1 : 0,
      };
    }
    case "vhs-glitch":
      return {
        scan: clamp(n(p, "scanlines"), 0, 100) / 100,
        split: Math.round(clamp(n(p, "rgbSplit"), 0, 100)),
        jit: clamp(n(p, "jitter"), 0, 200),
        noise: clamp(n(p, "noise"), 0, 100) / 100,
        frame: vhsFrameIndex(n(p, "time")),
        seed: vhsSeedInt(n(p, "seed")),
        band: vhsBandHeight(height),
      };
    case "unsharp-mask":
      return {
        amount: clamp(n(p, "amount"), 0, 500) / 100,
        radius: clamp(n(p, "radius"), 0.1, 50),
        threshold: clamp(n(p, "threshold"), 0, 255) / 255,
      };
    case "gaussian-blur":
      return {
        rx: clamp(n(p, "blurX"), 0, 100),
        ry: clamp(n(p, "blurY"), 0, 100),
      };
    case "crop":
      // Fractions of the frame: the shader scales by u_resolution.
      return {
        l: clamp(n(p, "left"), 0, 100) / 100,
        t: clamp(n(p, "top"), 0, 100) / 100,
        r: clamp(n(p, "right"), 0, 100) / 100,
        b: clamp(n(p, "bottom"), 0, 100) / 100,
        feather: clamp(n(p, "feather"), 0, 100),
      };
    case "vibrance":
      return {
        vibrance: clamp(n(p, "vibrance"), -100, 100) / 100,
        sat: 1 + clamp(n(p, "saturation"), -100, 100) / 100,
      };
    case "skew": {
      const m = skewInverse(n(p, "skewX"), n(p, "skewY"));
      return { a: m.a, b: m.b, c: m.c, d: m.d, valid: m.valid ? 1 : 0 };
    }
    case "hsl-secondary":
      return { ...secondaryUniforms({ ...p, matteView: rawParams.matteView }) };
  }
}

/* -------------------------------------------------------------------------- */
/* Clip-local time                                                             */
/* -------------------------------------------------------------------------- */

const TIME_DRIVEN_PRO_EFFECTS: readonly string[] = ["vhs-glitch", ...EXTRA_TIME_DRIVEN, ...VR_IMAGE_TIME_DRIVEN];

/** True for effects whose output depends on playback time. */
export function isTimeVaryingProEffect(effect: {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}): boolean {
  if (effect.enabled === false || !isProEffectType(effect.type)) return false;
  if (!TIME_DRIVEN_PRO_EFFECTS.includes(effect.type)) return false;
  const params = effect.params ?? {};
  if (isProEffectNeutral(effect.type, params)) return false;
  // A wave with no speed is static; only a moving wave needs a clip-local time.
  if (effect.type === "ripple") {
    return resolveProEffectParams("ripple", params).speed !== 0;
  }
  return true;
}

/**
 * Time-driven pro effects (vhs-glitch, noise, strobe-light, moving ripple)
 * read a `time` param in seconds. The stored param acts as a user offset; at
 * render time the clip-local playback time is added so they animate during
 * playback and are identical between preview and export for the same frame.
 * Returns the input array untouched when no time-driven effect is present.
 */
export function withProEffectTime<
  T extends { type: string; params: Record<string, unknown> },
>(effects: readonly T[], clipLocalTime: number): readonly T[] {
  if (!effects.some((e) => TIME_DRIVEN_PRO_EFFECTS.includes(e.type))) return effects;
  const t = Number.isFinite(clipLocalTime) ? Math.max(0, clipLocalTime) : 0;
  return effects.map((e) => {
    if (!TIME_DRIVEN_PRO_EFFECTS.includes(e.type)) return e;
    const offset = e.params.time;
    return {
      ...e,
      params: {
        ...e.params,
        time: (typeof offset === "number" && Number.isFinite(offset) ? offset : 0) + t,
      },
    };
  });
}
