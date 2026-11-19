import { isProEffectType, PRO_EFFECT_DEFAULTS } from "./pro-effects";
import { BURN_IN_DEFAULTS, isBurnInEffectType } from "./burn-in";
import { isPluginEffectType, newPluginEffectParams } from "../plugins/manifest";
import { getPluginRegistry } from "../plugins/registry";

/**
 * Parameters a legacy (non-pro) video effect receives when it is first added
 * without explicit params, e.g. from the Effects browser or an agent call.
 *
 * The rendering engine resolves a missing param to its NEUTRAL value (blur
 * radius 0, vignette amount 0, ...), so an effect stored with `{}` is a
 * silent no-op. Every add path must seed values that visibly change the
 * picture. Units are the runtime units the engine and inspector use
 * (brightness / sharpen / vignette / grain amounts are percentage points).
 *
 * Effects that already default to a visible look (grayscale, sepia, invert,
 * chromaKey) are intentionally absent.
 */
export const LEGACY_EFFECT_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = {
  brightness: { value: 20 },
  contrast: { value: 1.25 },
  saturation: { value: 1.4 },
  hue: { rotation: 45 },
  blur: { radius: 8, type: "gaussian" },
  sharpen: { amount: 100, radius: 1, threshold: 0 },
  vignette: { amount: 50, midpoint: 0.5, roundness: 0.5, feather: 0.3 },
  grain: { amount: 25, size: 1, roughness: 0.5, colored: false },
  temperature: { value: 30 },
  tint: { value: 30 },
  tonal: { shadows: 0.5, midtones: 0.2, highlights: -0.3 },
  shadow: { offsetX: 8, offsetY: 8, blur: 12, opacity: 0.8, color: "#000000" },
  glow: { radius: 12, intensity: 1, color: "#ffffff" },
  "motion-blur": { angle: 0, distance: 20 },
  "radial-blur": { amount: 20, centerX: 50, centerY: 50 },
  "chromatic-aberration": { amount: 5, angle: 0 },
};

/**
 * Default params of a newly added effect of `type`, or undefined when the
 * type has no authored defaults (shader/mask/unknown types).
 */
export function getDefaultEffectParams(
  type: string,
): Record<string, unknown> | undefined {
  if (isProEffectType(type)) return { ...PRO_EFFECT_DEFAULTS[type] };
  if (isBurnInEffectType(type)) return { ...BURN_IN_DEFAULTS[type] };
  if (isPluginEffectType(type)) {
    // Plugin effects seed every manifest default plus the plugin version they were authored with.
    const plugin = getPluginRegistry().forEffectType(type);
    return plugin ? newPluginEffectParams(plugin.manifest) : undefined;
  }
  const legacy = LEGACY_EFFECT_DEFAULTS[type];
  return legacy ? { ...legacy } : undefined;
}

/**
 * Params for a newly added effect. Pro effects merge their authored defaults
 * under the explicit params (the established behaviour). Legacy effects are
 * seeded only when the caller supplied no params at all: explicit legacy
 * params are an authored payload (presets, shared edits) and stay exact.
 * Types without defaults return `params` unchanged, so shader / unknown
 * effects keep their exact payload.
 */
export function withEffectDefaults(
  type: string,
  params?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const defaults = getDefaultEffectParams(type);
  if (!defaults) return params;
  if (isProEffectType(type) || isBurnInEffectType(type) || isPluginEffectType(type)) return { ...defaults, ...(params ?? {}) };
  if (params && Object.keys(params).length > 0) return params;
  return defaults;
}

/**
 * Legacy effects that the effects browser no longer lists because a more
 * capable pro effect covers the same concept. The legacy types keep loading
 * and rendering, so existing projects are unchanged; new edits (UI and agent)
 * should use the pro type. `shader:<id>` names a `shader` effect by shaderId.
 */
export const SUPERSEDED_LEGACY_EFFECTS: Readonly<Record<string, string>> = {
  blur: "gaussian-blur",
  "shader:pixelate": "mosaic",
  "shader:mirror": "mirror",
  "shader:fisheye": "lens-distortion",
  "shader:posterize": "posterize",
  "shader:vhs": "vhs-glitch",
};

/** Legacy effect keys superseded by the given pro effect type. */
export function legacyEffectsSupersededBy(proType: string): string[] {
  return Object.entries(SUPERSEDED_LEGACY_EFFECTS)
    .filter(([, replacement]) => replacement === proType)
    .map(([legacy]) => legacy);
}
