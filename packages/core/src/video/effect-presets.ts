import type { Clip, Effect, Keyframe } from "../types/timeline";
import { EASING_TYPES, type EasingType } from "../types/timeline";
import {
  effectInstanceKeyframeProperty,
  migrateClipEffectKeyframes,
  parseEffectInstanceKeyframeProperty,
} from "./effect-instance-keyframes";

/**
 * Effect presets: a named snapshot of one or more effect instances of a clip
 * together with their instance keyframes. Stored on the project
 * (`project.effectPresets`), applied to other clips and exchanged as JSON.
 *
 * Timing modes
 *  - "relative": keyframe times are stored as a 0..1 fraction of the source
 *    clip duration and are scaled to the duration of the clip they are applied to.
 *  - "absolute": keyframe times are clip-local seconds and are kept as is
 *    (clamped to the target clip).
 */

export const EFFECT_PRESET_FORMAT = "openreel-effect-presets";
export const EFFECT_PRESET_VERSION = 1;

export type EffectPresetTiming = "relative" | "absolute";

export interface EffectPresetEffect {
  /** Stable key inside the preset; keyframes reference it. */
  readonly key: string;
  readonly type: string;
  readonly params: Record<string, unknown>;
  readonly enabled: boolean;
  readonly metadata?: Effect["metadata"];
}

export interface EffectPresetKeyframe {
  readonly effectKey: string;
  readonly param: string;
  /** Seconds (absolute) or 0..1 fraction of clip duration (relative). */
  readonly time: number;
  readonly value: number;
  readonly easing: EasingType;
  readonly bezierHandles?: Keyframe["bezierHandles"];
}

export interface EffectPreset {
  readonly id: string;
  readonly name: string;
  readonly timing: EffectPresetTiming;
  readonly effects: readonly EffectPresetEffect[];
  readonly keyframes: readonly EffectPresetKeyframe[];
  readonly createdAt: number;
}

export interface EffectPresetFile {
  readonly format: typeof EFFECT_PRESET_FORMAT;
  readonly version: number;
  readonly presets: readonly EffectPreset[];
}

export type EffectPresetResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

type PresetSourceClip = Pick<Clip, "effects" | "keyframes" | "duration">;

export interface CreateEffectPresetOptions {
  readonly id: string;
  readonly name: string;
  readonly timing: EffectPresetTiming;
  /** Effect instance ids to capture, in stack order. Omit for the whole stack. */
  readonly effectIds?: readonly string[];
  readonly createdAt?: number;
}

export function createEffectPreset(
  source: PresetSourceClip,
  options: CreateEffectPresetOptions,
): EffectPresetResult<EffectPreset> {
  const name = options.name.trim();
  if (!name) return { ok: false, error: "Preset name is required" };
  // Type-keyed keyframes are bound to instances first so they are captured too.
  const clip = migrateClipEffectKeyframes(source);
  const wanted = options.effectIds ? new Set(options.effectIds) : null;
  const picked = (clip.effects ?? []).filter((effect) => !wanted || wanted.has(effect.id));
  if (wanted) {
    const missing = [...wanted].filter((id) => !picked.some((effect) => effect.id === id));
    if (missing.length > 0) return { ok: false, error: `Effect not found on clip: ${missing.join(", ")}` };
  }
  if (picked.length === 0) return { ok: false, error: "Select at least one effect to save" };
  const keyByEffectId = new Map(picked.map((effect, index) => [effect.id, `fx${index + 1}`]));
  const duration = source.duration > 0 ? source.duration : 1;
  const keyframes: EffectPresetKeyframe[] = [];
  for (const keyframe of clip.keyframes ?? []) {
    const ref = parseEffectInstanceKeyframeProperty(keyframe.property);
    const effectKey = ref ? keyByEffectId.get(ref.effectId) : undefined;
    if (!ref || !effectKey) continue;
    if (typeof keyframe.value !== "number" || !Number.isFinite(keyframe.value)) continue;
    keyframes.push({
      effectKey,
      param: ref.param,
      time: options.timing === "relative" ? keyframe.time / duration : keyframe.time,
      value: keyframe.value,
      easing: keyframe.easing,
      ...(keyframe.bezierHandles ? { bezierHandles: structuredClone(keyframe.bezierHandles) } : {}),
    });
  }
  keyframes.sort((a, b) => a.time - b.time);
  return {
    ok: true,
    value: {
      id: options.id,
      name,
      timing: options.timing,
      effects: picked.map((effect) => ({
        key: keyByEffectId.get(effect.id)!,
        type: effect.type,
        params: structuredClone(effect.params),
        enabled: effect.enabled,
        ...(effect.metadata ? { metadata: structuredClone(effect.metadata) } : {}),
      })),
      keyframes,
      createdAt: options.createdAt ?? Date.now(),
    },
  };
}

export interface ApplyEffectPresetOptions {
  readonly mode: "append" | "replace";
  readonly makeId: (prefix: "effect" | "keyframe") => string;
}

export interface AppliedEffectPreset {
  /** Complete effect stack to store on the clip. */
  readonly effects: Effect[];
  /** Complete keyframe list to store on the clip. */
  readonly keyframes: Keyframe[];
  /** Ids of the effect instances the preset created, in preset order. */
  readonly addedEffectIds: string[];
}

/** Computes the clip's new stack and keyframes. Pure: the caller dispatches one undoable action. */
export function applyEffectPreset(
  target: Pick<Clip, "effects" | "keyframes" | "duration">,
  preset: EffectPreset,
  options: ApplyEffectPresetOptions,
): AppliedEffectPreset {
  const idByKey = new Map<string, string>();
  const created: Effect[] = preset.effects.map((entry) => {
    const id = options.makeId("effect");
    idByKey.set(entry.key, id);
    return {
      id,
      type: entry.type,
      params: structuredClone(entry.params),
      enabled: entry.enabled,
      ...(entry.metadata ? { metadata: structuredClone(entry.metadata) } : {}),
    };
  });
  const duration = target.duration > 0 ? target.duration : 0;
  const keyframes: Keyframe[] = [];
  for (const entry of preset.keyframes) {
    const effectId = idByKey.get(entry.effectKey);
    if (!effectId) continue;
    const raw = preset.timing === "relative" ? entry.time * duration : entry.time;
    keyframes.push({
      id: options.makeId("keyframe"),
      time: Math.min(Math.max(raw, 0), duration),
      property: effectInstanceKeyframeProperty(effectId, entry.param),
      value: entry.value,
      easing: entry.easing,
      ...(entry.bezierHandles ? { bezierHandles: structuredClone(entry.bezierHandles) } : {}),
    });
  }
  const keepEffects = options.mode === "replace" ? [] : [...(target.effects ?? [])];
  const existingKeyframes = target.keyframes ?? [];
  const keptKeyframes =
    options.mode === "replace"
      ? existingKeyframes.filter((keyframe) => {
          const ref = parseEffectInstanceKeyframeProperty(keyframe.property);
          return !ref || !(target.effects ?? []).some((effect) => effect.id === ref.effectId);
        })
      : [...existingKeyframes];
  return {
    effects: [...keepEffects, ...created],
    keyframes: [...keptKeyframes, ...keyframes],
    addedEffectIds: created.map((effect) => effect.id),
  };
}

/* -------------------------------------------------------------------------- */
/* JSON exchange                                                               */
/* -------------------------------------------------------------------------- */

export function serializeEffectPresets(presets: readonly EffectPreset[]): string {
  const file: EffectPresetFile = {
    format: EFFECT_PRESET_FORMAT,
    version: EFFECT_PRESET_VERSION,
    presets,
  };
  return JSON.stringify(file, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePresetEffect(value: unknown, index: number): EffectPresetResult<EffectPresetEffect> {
  if (!isRecord(value)) return { ok: false, error: `effects[${index}] must be an object` };
  const { key, type, params, enabled, metadata } = value;
  if (typeof key !== "string" || !key) return { ok: false, error: `effects[${index}].key is required` };
  if (typeof type !== "string" || !type) return { ok: false, error: `effects[${index}].type is required` };
  if (!isRecord(params)) return { ok: false, error: `effects[${index}].params must be an object` };
  return {
    ok: true,
    value: {
      key,
      type,
      params: structuredClone(params),
      enabled: typeof enabled === "boolean" ? enabled : true,
      ...(isRecord(metadata) ? { metadata: structuredClone(metadata) as Effect["metadata"] } : {}),
    },
  };
}

function parsePresetKeyframe(
  value: unknown,
  index: number,
  timing: EffectPresetTiming,
  effectKeys: ReadonlySet<string>,
): EffectPresetResult<EffectPresetKeyframe> {
  if (!isRecord(value)) return { ok: false, error: `keyframes[${index}] must be an object` };
  const { effectKey, param, time, value: sample, easing, bezierHandles } = value;
  if (typeof effectKey !== "string" || !effectKeys.has(effectKey)) {
    return { ok: false, error: `keyframes[${index}].effectKey does not match an effect` };
  }
  if (typeof param !== "string" || !param || param.includes(":")) {
    return { ok: false, error: `keyframes[${index}].param is invalid` };
  }
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
    return { ok: false, error: `keyframes[${index}].time must be a non-negative number` };
  }
  if (timing === "relative" && time > 1) {
    return { ok: false, error: `keyframes[${index}].time must be within 0..1 for relative presets` };
  }
  if (typeof sample !== "number" || !Number.isFinite(sample)) {
    return { ok: false, error: `keyframes[${index}].value must be a finite number` };
  }
  const resolvedEasing: EasingType =
    typeof easing === "string" && (EASING_TYPES as readonly string[]).includes(easing)
      ? (easing as EasingType)
      : "linear";
  return {
    ok: true,
    value: {
      effectKey,
      param,
      time,
      value: sample,
      easing: resolvedEasing,
      ...(isRecord(bezierHandles) ? { bezierHandles: structuredClone(bezierHandles) as Keyframe["bezierHandles"] } : {}),
    },
  };
}

function parsePreset(value: unknown, index: number): EffectPresetResult<EffectPreset> {
  const where = `presets[${index}]`;
  if (!isRecord(value)) return { ok: false, error: `${where} must be an object` };
  const { id, name, timing, effects, keyframes, createdAt } = value;
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: `${where}.name is required` };
  if (timing !== "relative" && timing !== "absolute") {
    return { ok: false, error: `${where}.timing must be "relative" or "absolute"` };
  }
  if (!Array.isArray(effects) || effects.length === 0) {
    return { ok: false, error: `${where}.effects must be a non-empty array` };
  }
  const parsedEffects: EffectPresetEffect[] = [];
  for (const [effectIndex, entry] of effects.entries()) {
    const parsed = parsePresetEffect(entry, effectIndex);
    if (!parsed.ok) return { ok: false, error: `${where}: ${parsed.error}` };
    parsedEffects.push(parsed.value);
  }
  const keys = new Set(parsedEffects.map((effect) => effect.key));
  if (keys.size !== parsedEffects.length) return { ok: false, error: `${where}: effect keys must be unique` };
  const parsedKeyframes: EffectPresetKeyframe[] = [];
  for (const [keyframeIndex, entry] of (Array.isArray(keyframes) ? keyframes : []).entries()) {
    const parsed = parsePresetKeyframe(entry, keyframeIndex, timing, keys);
    if (!parsed.ok) return { ok: false, error: `${where}: ${parsed.error}` };
    parsedKeyframes.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      id: typeof id === "string" && id ? id : "",
      name: name.trim(),
      timing,
      effects: parsedEffects,
      keyframes: parsedKeyframes,
      createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
    },
  };
}

/**
 * Parses an exported preset file. Accepts the bundle written by
 * serializeEffectPresets or a bare single preset object. Validation is strict
 * so a malformed file never reaches the project; ids missing from the file
 * are filled by `makeId`.
 */
export function parseEffectPresets(
  text: string,
  makeId: () => string,
): EffectPresetResult<EffectPreset[]> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Preset file is not valid JSON" };
  }
  let rawPresets: unknown[];
  if (isRecord(data) && data.format === EFFECT_PRESET_FORMAT) {
    if (typeof data.version !== "number" || data.version > EFFECT_PRESET_VERSION) {
      return { ok: false, error: "Preset file was written by a newer version of the app" };
    }
    if (!Array.isArray(data.presets)) return { ok: false, error: "Preset file has no presets array" };
    rawPresets = data.presets;
  } else if (isRecord(data) && Array.isArray(data.effects)) {
    rawPresets = [data];
  } else {
    return { ok: false, error: "Not an OpenReel effect preset file" };
  }
  if (rawPresets.length === 0) return { ok: false, error: "Preset file is empty" };
  const presets: EffectPreset[] = [];
  for (const [index, raw] of rawPresets.entries()) {
    const parsed = parsePreset(raw, index);
    if (!parsed.ok) return parsed;
    presets.push({ ...parsed.value, id: parsed.value.id || makeId() });
  }
  return { ok: true, value: presets };
}

/**
 * Library merge for imports: presets with an id already in the library are
 * re-identified so an import never overwrites an existing preset.
 */
export function mergeImportedPresets(
  library: readonly EffectPreset[],
  imported: readonly EffectPreset[],
  makeId: () => string,
): EffectPreset[] {
  const used = new Set(library.map((preset) => preset.id));
  const added = imported.map((preset) => {
    const id = used.has(preset.id) ? makeId() : preset.id;
    used.add(id);
    return { ...preset, id };
  });
  return [...library, ...added];
}
