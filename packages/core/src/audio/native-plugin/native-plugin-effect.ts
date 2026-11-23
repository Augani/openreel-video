/**
 * The "nativePlugin" clip audio effect: one hosted Audio Unit / VST3 instance on a clip.
 *
 * Like Enhance Speech it works on the whole decoded source, not in the live Web Audio chain: the helper renders the source
 * offline (latency compensated, parameter automation applied block by block), the result is cached, and the preview and the
 * export both play that same buffer. The effect carries the plugin's state chunk and parameter values (saved with the
 * project); parameter automation is ordinary clip keyframes with property `effect.nativeplugin:<effectId>.<paramKey>`.
 */
import type { Action } from "../../types/actions";
import type { Clip, Effect, Keyframe } from "../../types/timeline";
import { easeKeyframeSegment } from "../../animation/keyframe-easing";
import type { NativePluginDescriptor, NativePluginLane, NativePluginStep } from "./native-plugin-types";

export const NATIVE_PLUGIN_EFFECT_TYPE = "nativePlugin";
export const NATIVE_PLUGIN_KEYFRAME_PREFIX = "effect.nativeplugin:";
/** Maximum plugin instances on one clip. */
export const MAX_NATIVE_PLUGINS_PER_CLIP = 8;

export const isNativePluginEffect = (effect: Pick<Effect, "type">): boolean => effect.type === NATIVE_PLUGIN_EFFECT_TYPE;

export interface NativePluginEffectParams extends Record<string, unknown> {
  pluginId: string;
  format: "au" | "vst3";
  name: string;
  vendor: string;
  /** Plugin state chunk (base64), as the plugin itself saved it. */
  state?: string;
  /** Parameter values the user set (key -> value); override `state`. */
  values: Record<string, number>;
  /** Latency the plugin reported when last used (display only; the render compensates it exactly). */
  latencySamples?: number;
  /** Baked from clip keyframes at render time, never stored. */
  automation?: Record<string, NativePluginLane>;
}

export const nativePluginKeyframeProperty = (effectId: string, key: string): string => `${NATIVE_PLUGIN_KEYFRAME_PREFIX}${effectId}.${key}`;

export function parseNativePluginKeyframeProperty(property: string): { effectId: string; key: string } | null {
  if (!property.startsWith(NATIVE_PLUGIN_KEYFRAME_PREFIX)) return null;
  const rest = property.slice(NATIVE_PLUGIN_KEYFRAME_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { effectId: rest.slice(0, dot), key: rest.slice(dot + 1) };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sanitizeValues(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") for (const [key, value] of Object.entries(raw as Record<string, unknown>)) if (finite(value)) out[key] = value;
  return out;
}

export function readNativePluginParams(effect: Pick<Effect, "params">): NativePluginEffectParams {
  const p = (effect.params ?? {}) as Record<string, unknown>;
  const format = p.format === "vst3" ? "vst3" : "au";
  return {
    pluginId: typeof p.pluginId === "string" ? p.pluginId : "",
    format,
    name: typeof p.name === "string" && p.name ? p.name : typeof p.pluginId === "string" ? p.pluginId : "Plugin",
    vendor: typeof p.vendor === "string" ? p.vendor : "",
    ...(typeof p.state === "string" && p.state ? { state: p.state } : {}),
    values: sanitizeValues(p.values),
    ...(finite(p.latencySamples) ? { latencySamples: Math.max(0, Math.round(p.latencySamples)) } : {}),
    ...(p.automation && typeof p.automation === "object" ? { automation: p.automation as Record<string, NativePluginLane> } : {}),
  };
}

export function createNativePluginEffect(id: string, plugin: Pick<NativePluginDescriptor, "id" | "format" | "name" | "vendor" | "latencySamples">, extra: { state?: string; values?: Record<string, number> } = {}): Effect {
  const params: NativePluginEffectParams = {
    pluginId: plugin.id,
    format: plugin.format,
    name: plugin.name,
    vendor: plugin.vendor,
    values: sanitizeValues(extra.values),
    ...(extra.state ? { state: extra.state } : {}),
    ...(finite(plugin.latencySamples) ? { latencySamples: plugin.latencySamples } : {}),
  };
  return { id, type: NATIVE_PLUGIN_EFFECT_TYPE, enabled: true, params };
}

export const getNativePluginEffects = (effects: readonly Effect[] | undefined): Effect[] =>
  (effects ?? []).filter((effect) => effect.type === NATIVE_PLUGIN_EFFECT_TYPE && readNativePluginParams(effect).pluginId !== "");

/** Enabled instances, in chain order: what the render has to run. */
export const getActiveNativePluginEffects = (effects: readonly Effect[] | undefined): Effect[] => getNativePluginEffects(effects).filter((effect) => effect.enabled !== false);

export const withoutNativePlugins = <T extends Pick<Effect, "type">>(effects: readonly T[]): T[] => effects.filter((effect) => effect.type !== NATIVE_PLUGIN_EFFECT_TYPE);

export const hasNativePlugins = (effects: readonly Pick<Effect, "type" | "enabled">[] | undefined): boolean =>
  (effects ?? []).some((effect) => effect.type === NATIVE_PLUGIN_EFFECT_TYPE && effect.enabled !== false);

export function nativePluginSteps(effects: readonly Effect[] | undefined): NativePluginStep[] {
  return getActiveNativePluginEffects(effects).map((effect) => {
    const p = readNativePluginParams(effect);
    return { effectId: effect.id, pluginId: p.pluginId, ...(p.state ? { state: p.state } : {}), values: p.values, automation: p.automation ?? {} };
  });
}

/** Ids of installed plugins that the effects use but the host cannot run (not installed, blocked or no backend). */
export function findMissingNativePlugins(effects: readonly Effect[] | undefined, usable: ReadonlySet<string>): Effect[] {
  return getNativePluginEffects(effects).filter((effect) => !usable.has(readNativePluginParams(effect).pluginId));
}

const SAMPLE_STEP_SECONDS = 0.01;
const MAX_LANE_POINTS = 4000;
const HOLD_EDGE_SECONDS = 0.001;

/**
 * Lane in SOURCE seconds for one parameter from its keyframes (clip-local seconds). Linear segments keep just their keys;
 * eased segments are sampled every 10 ms. A reversed clip plays its source backwards, so the lane is mirrored.
 */
export function laneFromKeyframes(
  keys: readonly Keyframe[],
  clip: Pick<Clip, "inPoint" | "outPoint" | "speed" | "reversed">,
): NativePluginLane {
  const sorted = keys.filter((k) => finite(k.time) && finite(Number(k.value))).sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return [];
  const speed = Math.abs(clip.speed ?? 1) || 1;
  const toSource = (t: number): number => (clip.reversed ? clip.outPoint - t * speed : clip.inPoint + t * speed);
  const local: Array<[number, number]> = [];
  const linearOnly = sorted.every((k) => k.easing === "linear" && !k.bezierHandles);
  for (let i = 0; i < sorted.length; i += 1) {
    const key = sorted[i];
    local.push([key.time, Number(key.value)]);
    const next = sorted[i + 1];
    if (!next || linearOnly || (key.easing === "linear" && !key.bezierHandles)) continue;
    const span = next.time - key.time;
    if (key.easing === "hold") {
      // A step: flat until just before the next key, so the host's linear read of the lane does not ramp early.
      local.push([next.time - Math.min(HOLD_EDGE_SECONDS, span / 2), Number(key.value)]);
      continue;
    }
    const steps = Math.min(Math.ceil(span / SAMPLE_STEP_SECONDS), Math.floor(MAX_LANE_POINTS / Math.max(1, sorted.length)));
    for (let s = 1; s < steps; s += 1) {
      const t = key.time + (span * s) / steps;
      const progress = easeKeyframeSegment((t - key.time) / span, key);
      local.push([t, Number(key.value) + (Number(next.value) - Number(key.value)) * progress]);
    }
  }
  const mapped = local.map(([t, v]): [number, number] => [toSource(t), v]);
  mapped.sort((a, b) => a[0] - b[0]);
  return mapped;
}

/**
 * The effects with each native plugin's automation lanes baked from the clip's keyframes (`params.automation`). Effects
 * without keyframes are returned unchanged (same objects), so unrelated clips never re-render.
 */
export function bakeNativePluginAutomation(
  effects: readonly Effect[],
  clip: Pick<Clip, "keyframes" | "inPoint" | "outPoint" | "speed" | "reversed">,
): Effect[] {
  if (!effects.some(isNativePluginEffect)) return effects as Effect[];
  const byEffect = new Map<string, Map<string, Keyframe[]>>();
  for (const keyframe of clip.keyframes ?? []) {
    const parsed = parseNativePluginKeyframeProperty(keyframe.property);
    if (!parsed) continue;
    const lanes = byEffect.get(parsed.effectId) ?? new Map<string, Keyframe[]>();
    const list = lanes.get(parsed.key) ?? [];
    list.push(keyframe);
    lanes.set(parsed.key, list);
    byEffect.set(parsed.effectId, lanes);
  }
  return effects.map((effect) => {
    if (!isNativePluginEffect(effect)) return effect;
    const lanes = byEffect.get(effect.id);
    if (!lanes || lanes.size === 0) return effect;
    const automation: Record<string, NativePluginLane> = {};
    for (const [key, keys] of lanes) {
      const lane = laneFromKeyframes(keys, clip);
      if (lane.length > 0) automation[key] = lane;
    }
    return Object.keys(automation).length === 0 ? effect : { ...effect, params: { ...effect.params, automation } };
  });
}

export const findNativePluginEffect = (clip: Pick<Clip, "audioEffects"> | undefined, effectId: string): Effect | undefined =>
  (clip?.audioEffects ?? []).find((effect) => effect.id === effectId && effect.type === NATIVE_PLUGIN_EFFECT_TYPE);

export interface NativePluginActionIds {
  readonly actionId: string;
  readonly effectId: string;
}

/** Undoable action that appends a plugin instance to the clip's chain. Null when the clip is full. */
export function planAddNativePluginAction(
  clip: Pick<Clip, "id" | "audioEffects">,
  plugin: Pick<NativePluginDescriptor, "id" | "format" | "name" | "vendor" | "latencySamples">,
  ids: NativePluginActionIds,
  timestamp = Date.now(),
): Action | null {
  if (getNativePluginEffects(clip.audioEffects).length >= MAX_NATIVE_PLUGINS_PER_CLIP) return null;
  return { id: ids.actionId, timestamp, type: "audio/addEffect", params: { clipId: clip.id, effect: createNativePluginEffect(ids.effectId, plugin) } };
}

/** Undoable action that replaces the plugin's state chunk and parameter values (the plugin window closing, a slider moving). Null when nothing changes. */
export function planUpdateNativePluginAction(
  clip: Pick<Clip, "id" | "audioEffects">,
  effectId: string,
  patch: { state?: string; values?: Record<string, number>; enabled?: boolean; latencySamples?: number },
  ids: { actionId: string },
  timestamp = Date.now(),
): Action | null {
  const existing = findNativePluginEffect(clip, effectId);
  if (!existing) return null;
  const current = readNativePluginParams(existing);
  const { automation: _baked, ...stored } = existing.params as Record<string, unknown>;
  void _baked;
  const next: Record<string, unknown> = { ...stored };
  if (patch.state !== undefined) next.state = patch.state;
  if (patch.values) next.values = { ...current.values, ...sanitizeValues(patch.values) };
  if (patch.latencySamples !== undefined) next.latencySamples = patch.latencySamples;
  const enabled = patch.enabled ?? existing.enabled;
  if (enabled === existing.enabled && JSON.stringify(next) === JSON.stringify(stored)) return null;
  return {
    id: ids.actionId,
    timestamp,
    type: "audio/replaceEffect",
    params: { clipId: clip.id, effectId, effect: { ...existing, enabled, params: next } },
  };
}

export function planRemoveNativePluginAction(clip: Pick<Clip, "id" | "audioEffects">, effectId: string, ids: { actionId: string }, timestamp = Date.now()): Action | null {
  return findNativePluginEffect(clip, effectId)
    ? { id: ids.actionId, timestamp, type: "audio/removeEffect", params: { clipId: clip.id, effectId } }
    : null;
}
