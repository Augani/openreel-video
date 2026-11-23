/**
 * VR effect specs for the pro effects library: labels, ranges, defaults, neutral values and the neutral test of
 * VR Rotate Sphere, VR Projection, VR Blur and VR Plane to Sphere. This is the small part the Effects panel, the
 * inspector, project load and the agent need up front; the CPU reference, the GLSL and the shader uniforms are in
 * vr-effects.ts / vr-effect-shaders.ts, behind the lazy VR runtime (vr-runtime-loader.ts).
 */
import { wrapDegrees, type VrFrameLayout } from "../vr/vr-layout";
import { isVrImageEffectType } from "./vr-image-effect-specs";
import type { ProEffectParamSpec, ProEffectSpec, ResolvedProParams } from "./pro-effects";

export const VR_PRO_EFFECT_TYPES = [
  "vr-rotate-sphere",
  "vr-projection",
  "vr-blur",
  "vr-plane-to-sphere",
] as const;

export type VrProEffectType = (typeof VR_PRO_EFFECT_TYPES)[number];

const VR_SET: ReadonlySet<string> = new Set(VR_PRO_EFFECT_TYPES);

export function isVrProEffectType(type: string): type is VrProEffectType {
  return VR_SET.has(type);
}

/** VR effects that write alpha: Reframe letterboxing and the transparent surround of a plane on the sphere. */
export const VR_EFFECTS_WRITING_ALPHA: readonly VrProEffectType[] = ["vr-projection", "vr-plane-to-sphere"];

/** Largest blur radius, degrees of arc. */
export const VR_BLUR_MAX_DEGREES = 15;
/** Disc samples of VR Blur (fixed upper bound shared with the shader loop). */
export const VR_BLUR_MAX_SAMPLES = 64;

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

const select = (
  key: string,
  label: string,
  def: string,
  neutral: string,
  options: readonly (readonly [string, string])[],
): ProEffectParamSpec => ({
  key,
  label,
  kind: "select",
  default: def,
  neutral,
  options: options.map(([value, text]) => ({ value, label: text })),
});

const toggle = (key: string, label: string, def: boolean, neutral: boolean): ProEffectParamSpec => ({
  key,
  label,
  kind: "toggle",
  default: def,
  neutral,
});

const layoutParam = (): ProEffectParamSpec =>
  select("layout", "Frame layout", "mono", "mono", [
    ["mono", "Monoscopic"],
    ["over-under", "Stereo over/under"],
    ["side-by-side", "Stereo side by side"],
  ]);

/** An angle parameter: keyframes take the shorter arc. `def` is what adding the effect from the UI writes; every VR effect adds neutral (0). */
const angle = (key: string, label: string, def = 0): ProEffectParamSpec =>
  num(key, label, -360, 360, 0.1, def, 0, "°", true, 360);

export const VR_PRO_EFFECT_SPECS: Readonly<Record<VrProEffectType, ProEffectSpec>> = {
  "vr-rotate-sphere": {
    type: "vr-rotate-sphere",
    label: "VR Rotate Sphere",
    description:
      "Rotate a 360 picture: pan turns it about the vertical axis, tilt raises or lowers the horizon, roll turns it clockwise. The seam wraps and stereo eyes rotate together",
    category: "Immersive Video",
    params: [layoutParam(), angle("tilt", "Tilt"), angle("pan", "Pan"), angle("roll", "Roll")],
  },
  "vr-projection": {
    type: "vr-projection",
    label: "VR Projection",
    description:
      "Reframe 360 to flat: render a rectilinear view (or little planet / fisheye) of an equirectangular picture with keyframable pan, tilt, roll and field of view. The view is drawn in the largest rectangle of the chosen aspect that fits the clip, so scale the clip up to fill a flat sequence",
    category: "Immersive Video",
    params: [
      select("mode", "Projection", "none", "none", [
        ["none", "None"],
        ["rectilinear", "Reframe to flat"],
        ["stereographic", "Little planet"],
        ["fisheye", "Fisheye"],
      ]),
      layoutParam(),
      num("fov", "Field of view", 10, 360, 0.1, 90, 90, "°"),
      angle("pan", "Pan"),
      angle("tilt", "Tilt"),
      angle("roll", "Roll"),
      num("aspect", "View aspect (w/h)", 0.25, 4, 0.01, 16 / 9, 16 / 9, undefined, false),
    ],
  },
  "vr-blur": {
    type: "vr-blur",
    label: "VR Blur",
    description:
      "Seam-aware blur of a 360 picture: the radius is an angle, so it looks the same at every latitude, wraps across the 0/360 seam and folds over the poles",
    category: "Immersive Video",
    params: [layoutParam(), num("radius", "Blur radius", 0, VR_BLUR_MAX_DEGREES, 0.1, 0, 0, "°")],
  },
  "vr-plane-to-sphere": {
    type: "vr-plane-to-sphere",
    label: "VR Plane to Sphere",
    description:
      "Place a flat clip (title, graphic, lower third) onto the sphere without distortion at a yaw/pitch with an angular width; the rest of the frame is transparent so it composites over the 360 footage below",
    category: "Immersive Video",
    params: [
      num("width", "Angular width", 5, 179, 0.1, 60, 60, "°"),
      angle("pan", "Pan (yaw)"),
      angle("tilt", "Tilt (pitch)"),
      angle("roll", "Roll"),
      toggle("enabled", "Place on sphere", false, false),
    ],
  },
};

/**
 * A VR effect added to a VR sequence takes the sequence's frame layout unless the caller named one: `seeded` are the
 * params with defaults applied, `given` what the caller passed. Other effects (and flat sequences) are returned as is.
 */
export function withVrSequenceLayout(
  type: string,
  given: Readonly<Record<string, unknown>> | undefined,
  seeded: Record<string, unknown> | undefined,
  sequenceVr: { readonly projection: string; readonly layout: VrFrameLayout } | undefined,
): Record<string, unknown> | undefined {
  if (!seeded || !(isVrProEffectType(type) || isVrImageEffectType(type)) || given?.layout !== undefined || !("layout" in seeded)) return seeded;
  if (!sequenceVr || sequenceVr.projection === "none") return seeded;
  return { ...seeded, layout: sequenceVr.layout };
}

const n = (p: ResolvedProParams, key: string): number => p[key] as number;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Params with ranges enforced; the wrapped angles are wrapped into [-180, 180) instead of clamped. */
export function normalizeVrParams(type: VrProEffectType, p: ResolvedProParams): ResolvedProParams {
  const out: ResolvedProParams = { ...p };
  for (const s of VR_PRO_EFFECT_SPECS[type].params) {
    if (s.kind !== "number") continue;
    const v = p[s.key] as number;
    out[s.key] = s.wrap ? wrapDegrees(v) : clamp(v, s.min ?? -Infinity, s.max ?? Infinity);
  }
  return out;
}


export function isVrNeutral(type: VrProEffectType, resolved: ResolvedProParams): boolean {
  const p = normalizeVrParams(type, resolved);
  switch (type) {
    case "vr-rotate-sphere":
      return n(p, "tilt") === 0 && n(p, "pan") === 0 && n(p, "roll") === 0;
    case "vr-projection":
      return p.mode === "none";
    case "vr-blur":
      return n(p, "radius") < 0.05;
    case "vr-plane-to-sphere":
      return p.enabled !== true;
  }
}
