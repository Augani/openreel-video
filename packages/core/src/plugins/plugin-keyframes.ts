/**
 * Keyframing of plugin parameters through the existing keyframe system.
 *
 * A plugin parameter is animated by ordinary clip keyframes whose `property`
 * is `effect.plugin:<pluginId>.<paramKey>` (plus `.x`/`.y` for points and
 * `.r`/`.g`/`.b` for colours). They are stored, undone, graphed and
 * interpolated exactly like every other keyframe; this module only maps those
 * properties to effect parameters at a clip-local time. As with the built-in
 * effects, keyframes of a type drive the first effect of that type on a clip.
 */

import type { Clip, Effect } from "../types/timeline";
import { keyframeEngine } from "../video/keyframe-engine";
import {
  hexToRgb,
  isPluginEffectType,
  PLUGIN_TIME_PARAM,
  pluginEffectType,
  pluginIdFromEffectType,
  resolvePluginParam,
  rgbToHex,
  type PluginManifest,
  type PluginParamDef,
} from "./manifest";
import { getPluginRegistry, type PluginRegistry } from "./registry";

export const PLUGIN_KEYFRAME_PREFIX = "effect.plugin:";

export type PluginKeyframePart = "x" | "y" | "r" | "g" | "b";

export interface PluginKeyframeChannel {
  readonly id: string;
  readonly pluginId: string;
  readonly key: string;
  readonly part?: PluginKeyframePart;
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export function pluginKeyframePropertyId(pluginId: string, key: string, part?: PluginKeyframePart): string {
  return `${PLUGIN_KEYFRAME_PREFIX}${pluginId}.${key}${part ? `.${part}` : ""}`;
}

export function parsePluginKeyframeProperty(
  property: string,
): { pluginId: string; key: string; part?: PluginKeyframePart } | null {
  if (!property.startsWith(PLUGIN_KEYFRAME_PREFIX)) return null;
  const [pluginId, key, part, extra] = property.slice(PLUGIN_KEYFRAME_PREFIX.length).split(".");
  if (!pluginId || !key || extra !== undefined) return null;
  if (part !== undefined && !["x", "y", "r", "g", "b"].includes(part)) return null;
  return { pluginId, key, ...(part ? { part: part as PluginKeyframePart } : {}) };
}

/** Every animatable scalar channel of a plugin. */
export function pluginKeyframeChannels(manifest: PluginManifest): PluginKeyframeChannel[] {
  const out: PluginKeyframeChannel[] = [];
  for (const def of manifest.parameters) {
    if (!def.keyframable) continue;
    const label = `${manifest.name}: ${def.label}`;
    switch (def.type) {
      case "float":
      case "int":
      case "angle":
        out.push({
          id: pluginKeyframePropertyId(manifest.id, def.key),
          pluginId: manifest.id,
          key: def.key,
          label,
          defaultValue: def.default as number,
          min: def.min ?? 0,
          max: def.max ?? 1,
          step: def.step ?? 0.01,
        });
        break;
      case "point": {
        const d = def.default as { x: number; y: number };
        for (const part of ["x", "y"] as const) {
          out.push({
            id: pluginKeyframePropertyId(manifest.id, def.key, part),
            pluginId: manifest.id,
            key: def.key,
            part,
            label: `${label} ${part.toUpperCase()}`,
            defaultValue: d[part],
            min: 0,
            max: 1,
            step: 0.01,
          });
        }
        break;
      }
      case "color": {
        const c = hexToRgb(def.default as string);
        for (const part of ["r", "g", "b"] as const) {
          out.push({
            id: pluginKeyframePropertyId(manifest.id, def.key, part),
            pluginId: manifest.id,
            key: def.key,
            part,
            label: `${label} ${part.toUpperCase()}`,
            defaultValue: c[part],
            min: 0,
            max: 1,
            step: 0.01,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

type Keyframes = NonNullable<Clip["keyframes"]>;

function sampleChannel(keyframes: Keyframes, id: string, localTime: number): number | null {
  const group = keyframeEngine.getKeyframesForProperty(keyframes, id);
  if (group.length === 0) return null;
  const value = keyframeEngine.getValueAtTime(group, localTime).value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function withSampledParam(def: PluginParamDef, params: Record<string, unknown>, manifest: PluginManifest, keyframes: Keyframes, localTime: number): void {
  const key = def.key;
  switch (def.type) {
    case "float":
    case "int":
    case "angle": {
      const v = sampleChannel(keyframes, pluginKeyframePropertyId(manifest.id, key), localTime);
      if (v !== null) params[key] = resolvePluginParam(def, v);
      break;
    }
    case "point": {
      const x = sampleChannel(keyframes, pluginKeyframePropertyId(manifest.id, key, "x"), localTime);
      const y = sampleChannel(keyframes, pluginKeyframePropertyId(manifest.id, key, "y"), localTime);
      if (x === null && y === null) break;
      const base = resolvePluginParam(def, params[key]) as { x: number; y: number };
      params[key] = { x: x ?? base.x, y: y ?? base.y };
      break;
    }
    case "color": {
      const r = sampleChannel(keyframes, pluginKeyframePropertyId(manifest.id, key, "r"), localTime);
      const g = sampleChannel(keyframes, pluginKeyframePropertyId(manifest.id, key, "g"), localTime);
      const b = sampleChannel(keyframes, pluginKeyframePropertyId(manifest.id, key, "b"), localTime);
      if (r === null && g === null && b === null) break;
      const base = hexToRgb(resolvePluginParam(def, params[key]) as string);
      params[key] = rgbToHex(r ?? base.r, g ?? base.g, b ?? base.b);
      break;
    }
    default:
      break;
  }
}

/** Clip has keyframes on a plugin parameter. */
export function hasPluginKeyframes(clip: { readonly keyframes?: readonly { readonly property: string }[] }): boolean {
  return clip.keyframes?.some((k) => k.property.startsWith(PLUGIN_KEYFRAME_PREFIX)) ?? false;
}

/** Clip has an enabled plugin effect whose look changes every frame on its own. */
export function hasTimeDrivenPluginEffects(
  clip: { readonly effects?: readonly Effect[] },
  registry: PluginRegistry = getPluginRegistry(),
): boolean {
  return (
    clip.effects?.some((effect) => {
      if (effect.enabled === false || !isPluginEffectType(effect.type)) return false;
      return registry.forEffectType(effect.type)?.manifest.timeDriven === true;
    }) ?? false
  );
}

/**
 * Sample plugin keyframes (and the clip-local time of time driven plugins)
 * into the effect stack. Returns the input array unchanged when nothing applies.
 */
export function samplePluginEffects(
  effects: readonly Effect[],
  keyframes: Keyframes | undefined,
  localTime: number,
  registry: PluginRegistry = getPluginRegistry(),
): readonly Effect[] {
  if (!effects.some((e) => isPluginEffectType(e.type))) return effects;
  const time = Number.isFinite(localTime) ? Math.max(0, localTime) : 0;
  const seen = new Set<string>();
  let changed = false;
  const out = effects.map((effect) => {
    const id = pluginIdFromEffectType(effect.type);
    if (!id) return effect;
    const plugin = registry.get(id);
    if (!plugin) return effect;
    const { manifest } = plugin;
    const first = !seen.has(effect.type);
    seen.add(effect.type);
    const params: Record<string, unknown> = { ...effect.params };
    let touched = false;
    if (first && keyframes && keyframes.length > 0) {
      for (const def of manifest.parameters) {
        if (!def.keyframable) continue;
        const before = params[def.key];
        withSampledParam(def, params, manifest, keyframes, time);
        if (params[def.key] !== before) touched = true;
      }
    }
    if (manifest.timeDriven) {
      params[PLUGIN_TIME_PARAM] = time;
      touched = true;
    }
    if (!touched) return effect;
    changed = true;
    return { ...effect, params };
  });
  return changed ? out : effects;
}

export { pluginEffectType };
