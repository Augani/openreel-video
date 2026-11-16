import type { Clip, Effect, Keyframe } from "../types/timeline";
import type { Project } from "../types/project";
import { keyframeEngine } from "./keyframe-engine";
import { LEGACY_EFFECT_DEFAULTS } from "./effect-defaults";
import {
  PRO_EFFECT_SPECS,
  PRO_EFFECT_KEYFRAME_PROPERTIES,
  isProEffectType,
} from "./pro-effects";
import { isPluginEffectType } from "../plugins/manifest";

/**
 * Keyframes keyed by effect INSTANCE.
 *
 * Property id grammar: `fx:<effectId>:<paramKey>`. Two copies of the same
 * effect on a clip therefore animate independently. Older projects keyed
 * keyframes by effect TYPE (`effect.brightness`, `effect.<proType>.<param>`);
 * `migrateClipEffectKeyframes` rewrites those onto the instances.
 */

export const EFFECT_INSTANCE_KEYFRAME_PREFIX = "fx:";

export function effectInstanceKeyframeProperty(effectId: string, param: string): string {
  return `${EFFECT_INSTANCE_KEYFRAME_PREFIX}${effectId}:${param}`;
}

export interface EffectInstanceKeyframeRef {
  readonly effectId: string;
  readonly param: string;
}

export function parseEffectInstanceKeyframeProperty(
  property: string,
): EffectInstanceKeyframeRef | null {
  if (!property.startsWith(EFFECT_INSTANCE_KEYFRAME_PREFIX)) return null;
  const body = property.slice(EFFECT_INSTANCE_KEYFRAME_PREFIX.length);
  const split = body.lastIndexOf(":");
  if (split <= 0 || split === body.length - 1) return null;
  return { effectId: body.slice(0, split), param: body.slice(split + 1) };
}

/**
 * Human label of an instance-keyed property for timeline lanes ("Blur 2: Radius"),
 * or null when the property is not instance-keyed or its effect is gone.
 */
export function describeEffectInstanceKeyframeProperty(
  effects: readonly Pick<Effect, "id" | "type">[],
  property: string,
): string | null {
  const ref = parseEffectInstanceKeyframeProperty(property);
  if (!ref) return null;
  const index = effects.findIndex((effect) => effect.id === ref.effectId);
  if (index < 0) return null;
  const type = effects[index]!.type;
  const sameType = effects.filter((effect) => effect.type === type);
  const nth = sameType.findIndex((effect) => effect.id === ref.effectId) + 1;
  return `${titleCase(type)}${sameType.length > 1 ? ` ${nth}` : ""}: ${titleCase(ref.param)}`;
}

export function isEffectInstanceKeyframeProperty(property: string): boolean {
  return parseEffectInstanceKeyframeProperty(property) !== null;
}

export interface AnimatableEffectParam {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Value to start a new animation from when the effect does not store the param yet. */
  readonly defaultValue: number;
}

/** Effects whose parameters are not plain scalars driven by the classic stopwatch. */
function isUnanimatableEffect(type: string): boolean {
  return type === "shader" || type === "mask" || type === "hsl-secondary" || isPluginEffectType(type);
}

/** Param keys that are runtime plumbing, never user animatable. */
const NON_ANIMATABLE_KEYS: ReadonlySet<string> = new Set(["time", "shaderId", "irisShape"]);

const LEGACY_PARAM_RANGES: Readonly<Record<string, readonly [number, number, number]>> = {
  value: [-100, 100, 1],
  radius: [0, 100, 1],
  amount: [0, 100, 1],
  threshold: [0, 255, 1],
  midpoint: [0, 1, 0.01],
  roundness: [0, 1, 0.01],
  feather: [0, 1, 0.01],
  size: [0.1, 10, 0.1],
  roughness: [0, 1, 0.01],
  shadows: [-1, 1, 0.01],
  midtones: [-1, 1, 0.01],
  highlights: [-1, 1, 0.01],
  offsetX: [-100, 100, 1],
  offsetY: [-100, 100, 1],
  blur: [0, 100, 1],
  opacity: [0, 1, 0.01],
  intensity: [0, 5, 0.01],
  angle: [0, 360, 1],
  rotation: [-180, 180, 1],
  distance: [0, 200, 1],
  centerX: [0, 100, 1],
  centerY: [0, 100, 1],
};

function titleCase(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function legacyRange(
  type: string,
  key: string,
  current: number,
): readonly [number, number, number] {
  if (type === "contrast" && key === "value") return [0, 3, 0.01];
  if (type === "saturation" && key === "value") return [0, 3, 0.01];
  const known = LEGACY_PARAM_RANGES[key];
  const base = known ?? [Math.min(0, current), Math.max(1, Math.abs(current) * 2), 0.01];
  const [lo, hi, step] = base;
  return [Math.min(lo, current), Math.max(hi, current), step];
}

/**
 * Every numeric parameter of a classic (non-shader, non-plugin) video effect.
 * Pro effects list all numeric spec params; legacy effects list every numeric
 * param they store plus the numeric params of their authored defaults.
 */
export function getAnimatableEffectParams(
  effect: Pick<Effect, "type" | "params">,
): AnimatableEffectParam[] {
  if (isUnanimatableEffect(effect.type)) return [];
  if (isProEffectType(effect.type)) {
    return PRO_EFFECT_SPECS[effect.type].params
      .filter((param) => param.kind === "number")
      .map((param) => ({
        key: param.key,
        label: param.label,
        min: param.min ?? 0,
        max: param.max ?? 100,
        step: param.step ?? 1,
        defaultValue: Number(param.neutral),
      }));
  }
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(LEGACY_EFFECT_DEFAULTS[effect.type] ?? {})) {
    if (typeof value === "number") keys.add(key);
  }
  for (const [key, value] of Object.entries(effect.params)) {
    if (typeof value === "number" && Number.isFinite(value)) keys.add(key);
  }
  return [...keys]
    .filter((key) => !NON_ANIMATABLE_KEYS.has(key))
    .map((key) => {
      const stored = effect.params[key];
      const fallback = LEGACY_EFFECT_DEFAULTS[effect.type]?.[key];
      const current =
        typeof stored === "number" && Number.isFinite(stored)
          ? stored
          : typeof fallback === "number"
            ? fallback
            : 0;
      const [min, max, step] = legacyRange(effect.type, key, current);
      return { key, label: titleCase(key), min, max, step, defaultValue: current };
    });
}

export function isEffectParamAnimatable(
  effect: Pick<Effect, "type" | "params">,
  param: string,
): boolean {
  return getAnimatableEffectParams(effect).some((candidate) => candidate.key === param);
}

/** Keyframes of one effect instance parameter, sorted by time. */
export function getEffectParamKeyframes(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
): Keyframe[] {
  return keyframeEngine.getKeyframesForProperty(
    keyframes as Keyframe[],
    effectInstanceKeyframeProperty(effectId, param),
  );
}

/** True when the instance parameter has at least one keyframe (stopwatch on). */
export function isEffectParamAnimated(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
): boolean {
  const property = effectInstanceKeyframeProperty(effectId, param);
  return keyframes.some((keyframe) => keyframe.property === property);
}

const TIME_EPSILON = 1e-4;

/** Keyframe sitting at the clip-local time within half a frame tolerance, if any. */
export function findEffectParamKeyframeAt(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
  time: number,
): Keyframe | undefined {
  return getEffectParamKeyframes(keyframes, effectId, param).find(
    (keyframe) => Math.abs(keyframe.time - time) <= TIME_EPSILON,
  );
}

/** Nearest keyframe strictly before / after `time` (prev/next navigation). */
export function adjacentEffectParamKeyframe(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
  time: number,
  direction: "prev" | "next",
): Keyframe | undefined {
  const sorted = getEffectParamKeyframes(keyframes, effectId, param);
  return direction === "prev"
    ? [...sorted].reverse().find((keyframe) => keyframe.time < time - TIME_EPSILON)
    : sorted.find((keyframe) => keyframe.time > time + TIME_EPSILON);
}

/** Keyframe list after inserting or replacing the keyframe at `time`. */
export function upsertEffectParamKeyframe(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
  keyframe: Pick<Keyframe, "time" | "value"> & Partial<Pick<Keyframe, "easing" | "id">>,
  makeId: () => string,
): Keyframe[] {
  const property = effectInstanceKeyframeProperty(effectId, param);
  const existing = findEffectParamKeyframeAt(keyframes, effectId, param, keyframe.time);
  if (existing) {
    return keyframes.map((candidate) =>
      candidate === existing
        ? { ...candidate, value: keyframe.value, ...(keyframe.easing ? { easing: keyframe.easing } : {}) }
        : candidate,
    );
  }
  return [
    ...keyframes,
    {
      id: keyframe.id ?? makeId(),
      time: keyframe.time,
      property,
      value: keyframe.value,
      easing: keyframe.easing ?? "linear",
    },
  ];
}

/** Keyframe list after removing the keyframe at `time` (no-op when absent). */
export function removeEffectParamKeyframe(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
  time: number,
): Keyframe[] {
  const existing = findEffectParamKeyframeAt(keyframes, effectId, param, time);
  return existing ? keyframes.filter((candidate) => candidate !== existing) : [...keyframes];
}

/** Keyframe list after dropping every keyframe of one parameter (stopwatch off). */
export function clearEffectParamKeyframes(
  keyframes: readonly Keyframe[],
  effectId: string,
  param: string,
): Keyframe[] {
  const property = effectInstanceKeyframeProperty(effectId, param);
  return keyframes.filter((keyframe) => keyframe.property !== property);
}

/** Copies the keyframes of `sourceId` onto `targetId` (effect duplication). */
export function cloneEffectInstanceKeyframes(
  keyframes: readonly Keyframe[],
  sourceId: string,
  targetId: string,
  makeId: () => string,
): Keyframe[] {
  const copies: Keyframe[] = [];
  for (const keyframe of keyframes) {
    const ref = parseEffectInstanceKeyframeProperty(keyframe.property);
    if (!ref || ref.effectId !== sourceId) continue;
    copies.push({
      ...keyframe,
      id: makeId(),
      property: effectInstanceKeyframeProperty(targetId, ref.param),
    });
  }
  return copies;
}

/**
 * Patches effect params with the instance-keyed keyframes sampled at the
 * clip-local time. Shared by preview, playback, transitions and export through
 * getAnimatedVideoEffects, so every consumer sees the same values.
 */
export function applyEffectInstanceKeyframes(
  effects: readonly Effect[],
  keyframes: readonly Keyframe[],
  localTime: number,
): Effect[] {
  const instanceKeyframes = keyframes.filter((keyframe) =>
    keyframe.property.startsWith(EFFECT_INSTANCE_KEYFRAME_PREFIX),
  );
  if (instanceKeyframes.length === 0) return effects as Effect[];
  return effects.map((effect) => {
    const patch: Record<string, number> = {};
    const own = instanceKeyframes.filter(
      (keyframe) => parseEffectInstanceKeyframeProperty(keyframe.property)?.effectId === effect.id,
    );
    if (own.length === 0) return effect;
    for (const param of new Set(own.map((keyframe) => parseEffectInstanceKeyframeProperty(keyframe.property)!.param))) {
      const group = getEffectParamKeyframes(own, effect.id, param);
      const sampled = keyframeEngine.getValueAtTime(group, localTime).value;
      if (typeof sampled === "number" && Number.isFinite(sampled)) patch[param] = sampled;
    }
    return Object.keys(patch).length === 0
      ? effect
      : { ...effect, params: { ...effect.params, ...patch } };
  });
}

/* -------------------------------------------------------------------------- */
/* Migration of type-keyed keyframes                                           */
/* -------------------------------------------------------------------------- */

interface LegacyBinding {
  readonly effectType: string;
  readonly param: string;
}

const LEGACY_BINDINGS: ReadonlyMap<string, LegacyBinding> = new Map<string, LegacyBinding>([
  ["blur", { effectType: "blur", param: "radius" }],
  ["effect.blur", { effectType: "blur", param: "radius" }],
  ["effect.brightness", { effectType: "brightness", param: "value" }],
  ["effect.contrast", { effectType: "contrast", param: "value" }],
  ["effect.saturation", { effectType: "saturation", param: "value" }],
  ["effect.temperature", { effectType: "temperature", param: "value" }],
  ...PRO_EFFECT_KEYFRAME_PROPERTIES.map(
    (property): [string, LegacyBinding] => [
      property.id,
      { effectType: property.type, param: property.key },
    ],
  ),
]);

/** Legacy type-keyed ids still accepted on input (agent tools, portable projects). */
export const LEGACY_EFFECT_KEYFRAME_PROPERTIES: readonly string[] = [...LEGACY_BINDINGS.keys()].filter(
  (property) => property !== "blur",
);

/** Effect type a legacy type-keyed property animates ("effect.blur" -> "blur"), or null for any other id. */
export function legacyEffectKeyframeType(property: string): string | null {
  return LEGACY_BINDINGS.get(property)?.effectType ?? null;
}

/** The instance a type-keyed legacy property animates on this effect stack, if any. */
export function legacyEffectKeyframeBinding(
  effects: readonly Pick<Effect, "id" | "type">[],
  property: string,
): { readonly effectId: string; readonly param: string } | null {
  const binding = LEGACY_BINDINGS.get(property);
  if (!binding) return null;
  const target = effects.find((effect) => effect.type === binding.effectType);
  return target ? { effectId: target.id, param: binding.param } : null;
}

/**
 * Maps a legacy type-keyed property onto the first matching effect instance
 * (`fx:<id>:<param>`). Anything else, or a legacy id whose effect is not on
 * the clip, is returned unchanged.
 */
export function toInstanceKeyframeProperty(
  effects: readonly Pick<Effect, "id" | "type">[],
  property: string,
): string {
  const target = legacyEffectKeyframeBinding(effects, property);
  return target ? effectInstanceKeyframeProperty(target.effectId, target.param) : property;
}

/**
 * Rewrites type-keyed keyframes (`effect.blur`, bare `blur`, `effect.<proType>.<param>`)
 * onto one specific effect instance as `fx:<effectId>:<param>`, so they are not
 * overridden by (and do not override) keyframes of other instances. Keyframes
 * that do not belong to the effect's type are returned unchanged.
 */
export function rekeyKeyframesToEffectInstance<T extends { readonly property: string }>(
  effect: Pick<Effect, "id" | "type">,
  keyframes: readonly T[],
): T[] {
  return keyframes.map((keyframe) => {
    const binding = LEGACY_BINDINGS.get(keyframe.property);
    return binding && binding.effectType === effect.type
      ? { ...keyframe, property: effectInstanceKeyframeProperty(effect.id, binding.param) }
      : keyframe;
  });
}

/** Regex alternatives (no anchors) for every effect property id accepted as input: instance ids plus legacy type-keyed ids. */
export const EFFECT_KEYFRAME_INPUT_ALTERNATIVES =
  "fx:[a-zA-Z0-9_.:-]{1,200}:[A-Za-z0-9_]{1,64}|" +
  LEGACY_EFFECT_KEYFRAME_PROPERTIES.map((property) => property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

export const EFFECT_KEYFRAME_INPUT_PATTERN = `^(?:${EFFECT_KEYFRAME_INPUT_ALTERNATIVES})$`;

/**
 * Rewrites type-keyed effect keyframes onto the effect instances of the clip.
 * Every effect of the animated type receives a copy (hsl-secondary: the first
 * only, mirroring the old sampler), so existing animation looks identical.
 * Keyframes whose effect type is not on the clip stay type-keyed: the sampler
 * still synthesises such effects. Idempotent; returns the same clip when
 * nothing needs to change.
 */
export function migrateClipEffectKeyframes<T extends Pick<Clip, "effects" | "keyframes">>(
  clip: T,
): T {
  const keyframes = clip.keyframes ?? [];
  const effects = clip.effects ?? [];
  if (keyframes.length === 0 || effects.length === 0) return clip;

  // The explicit effect.blur property wins over the old bare blur property.
  const hasExplicitBlur = keyframes.some((keyframe) => keyframe.property === "effect.blur");
  const kept: Keyframe[] = [];
  const added: Keyframe[] = [];
  let changed = false;
  let counter = 0;
  for (const keyframe of keyframes) {
    const binding = LEGACY_BINDINGS.get(keyframe.property);
    if (!binding) {
      kept.push(keyframe);
      continue;
    }
    let targets = effects.filter((effect) => effect.type === binding.effectType);
    if (binding.effectType === "hsl-secondary") targets = targets.slice(0, 1);
    if (targets.length === 0) {
      kept.push(keyframe);
      continue;
    }
    changed = true;
    if (keyframe.property === "blur" && hasExplicitBlur) continue;
    targets.forEach((effect, index) => {
      added.push({
        ...keyframe,
        id: index === 0 ? keyframe.id : `${keyframe.id}-fx${(counter += 1)}`,
        property: effectInstanceKeyframeProperty(effect.id, binding.param),
      });
    });
  }
  if (!changed) return clip;
  // Never let a migrated copy clobber a keyframe the user already created on the instance.
  const occupied = new Set(kept.map((keyframe) => `${keyframe.property}@${keyframe.time}`));
  const merged = [
    ...kept,
    ...added.filter((keyframe) => !occupied.has(`${keyframe.property}@${keyframe.time}`)),
  ];
  return { ...clip, keyframes: merged };
}

type KeyframedEffectOwner = Pick<Clip, "effects" | "keyframes">;

function migrateOwners<T extends KeyframedEffectOwner>(owners: readonly T[] | undefined): readonly T[] | undefined {
  if (!owners) return owners;
  let changed = false;
  const next = owners.map((owner) => {
    const migrated = migrateClipEffectKeyframes(owner);
    if (migrated !== owner) changed = true;
    return migrated;
  });
  return changed ? next : owners;
}

/**
 * Explicit migration: type-keyed effect keyframes become instance-keyed. Idempotent.
 * Runs on project load (normalizeProjectStoredFields).
 */
export function normalizeProjectEffectKeyframes(project: Project): Project {
  if (!Array.isArray(project.timeline?.tracks)) return project;
  const normalizeTimeline = <T extends { readonly tracks: Project["timeline"]["tracks"] }>(timeline: T): T => {
    const tracks = timeline.tracks.map((track) => {
      const clips = migrateOwners(track.clips);
      return clips === track.clips ? track : { ...track, clips: clips as typeof track.clips };
    });
    return tracks.some((track, index) => track !== timeline.tracks[index]) ? { ...timeline, tracks } : timeline;
  };
  const timeline = normalizeTimeline(project.timeline);
  let sequencesChanged = false;
  const sequences = Array.isArray(project.sequences)
    ? project.sequences.map((sequence) => {
        if (!Array.isArray(sequence.timeline?.tracks)) return sequence;
        const next = normalizeTimeline(sequence.timeline);
        if (next === sequence.timeline) return sequence;
        sequencesChanged = true;
        return { ...sequence, timeline: next };
      })
    : project.sequences;
  if (timeline === project.timeline && !sequencesChanged) return project;
  return { ...project, timeline, ...(sequencesChanged ? { sequences } : {}) };
}
