import type { Clip, Effect } from "../types/timeline";
import { keyframeEngine } from "./keyframe-engine";
import { IRIS_SHAPES } from "./clip-iris";
import { applyEffectInstanceKeyframes, EFFECT_INSTANCE_KEYFRAME_PREFIX } from "./effect-instance-keyframes";
import { hasAnimatedColorGrading } from "./animated-color-grading";
import {
  PRO_EFFECT_KEYFRAME_PROPERTIES,
  PRO_EFFECT_DEFAULTS,
  isProEffectNeutral,
  isProEffectType,
  isTimeVaryingProEffect,
  withProEffectTime,
  type ProEffectType,
} from "./pro-effects";
import {
  hasBurnInEffects,
  isBurnInEffectType,
  isBurnInNeutral,
  withBurnInText,
  type BurnInSource,
} from "./burn-in";
import { isPluginEffectType, pluginIdFromEffectType } from "../plugins/manifest";
import { getPluginRegistry } from "../plugins/registry";
import { hasPluginKeyframes, hasTimeDrivenPluginEffects, samplePluginEffects } from "../plugins/plugin-keyframes";

export type VideoEffectSource = Pick<Clip, "id"> & Partial<Pick<Clip, "effects" | "keyframes" | "transform" | "mediaId" | "startTime" | "inPoint">>;
const effectPropertyMap: ReadonlyArray<{ keyframeProp: string; effectType: string; paramKey: string }> = [
  // Older entry/exit presets stored bare blur; the explicit effect property wins when both are present.
  { keyframeProp: "blur", effectType: "blur", paramKey: "radius" },
  { keyframeProp: "effect.brightness", effectType: "brightness", paramKey: "value" },
  { keyframeProp: "effect.contrast", effectType: "contrast", paramKey: "value" },
  { keyframeProp: "effect.saturation", effectType: "saturation", paramKey: "value" },
  { keyframeProp: "effect.temperature", effectType: "temperature", paramKey: "value" },
  { keyframeProp: "effect.blur", effectType: "blur", paramKey: "radius" },
];
const animatedProperties = new Set(effectPropertyMap.map(entry => entry.keyframeProp));
for (const shape of IRIS_SHAPES) animatedProperties.add(`effect.iris-${shape}`);
for (const property of PRO_EFFECT_KEYFRAME_PROPERTIES) animatedProperties.add(property.id);

/** Samples every keyframed pro-effect parameter (effect.<type>.<param>) at a clip-local time. */
function sampleProEffectKeyframes(
  keyframes: NonNullable<VideoEffectSource["keyframes"]>,
  localTime: number,
): Map<ProEffectType, Record<string, number>> {
  const sampled = new Map<ProEffectType, Record<string, number>>();
  for (const property of PRO_EFFECT_KEYFRAME_PROPERTIES) {
    const group = keyframeEngine.getKeyframesForProperty(keyframes, property.id);
    if (group.length === 0) continue;
    const value = keyframeEngine.getValueAtTime(group, localTime).value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const params = sampled.get(property.type) ?? {};
    params[property.key] = value;
    sampled.set(property.type, params);
  }
  return sampled;
}

export function getAnimatedIrisEffects(clip: VideoEffectSource, localTime: number): Effect[] {
  const keys = clip.keyframes ?? [];
  const irisKeys = keys.filter(key => key.property.startsWith("effect.iris-"));
  if (!irisKeys.length) return [];
  const position = clip.mediaId ? { x: 0.5, y: 0.5 } : clip.transform?.position ?? { x: 0.5, y: 0.5 };
  const center = { ...position };
  if (!clip.mediaId) for (const axis of ["x", "y"] as const) {
    const positionKeys = keyframeEngine.getKeyframesForProperty(keys, `position.${axis}`);
    if (positionKeys.length) {
      const sampled = keyframeEngine.getValueAtTime(positionKeys, localTime).value;
      if (typeof sampled === "number" && Number.isFinite(sampled)) center[axis] = sampled;
    }
  }
  const effects: Effect[] = [];
  for (const irisShape of IRIS_SHAPES) {
    const group = keyframeEngine.getKeyframesForProperty(irisKeys, `effect.iris-${irisShape}`);
    if (!group.length) continue;
    const sampled = keyframeEngine.getValueAtTime(group, localTime).value;
    if (typeof sampled !== "number" || !Number.isFinite(sampled) || sampled >= 1) continue;
    effects.push({ id: `kf-synth-${clip.id}-iris-${irisShape}`, type: "mask", enabled: true,
      params: { irisShape, progress: Math.max(0, sampled), centerX: center.x, centerY: center.y } });
  }
  return effects;
}

/** A completed zero-radius blur is visually neutral; retain canonical metadata outside this render predicate. */
export function isRenderableVideoEffect(effect: Effect): boolean {
  // A plugin effect whose plugin is not installed is a kept placeholder: nothing to render.
  if (isPluginEffectType(effect.type)) {
    const id = pluginIdFromEffectType(effect.type);
    return effect.enabled && !!id && !!getPluginRegistry().get(id) && !getPluginRegistry().isBypassed(id);
  }
  if (isProEffectType(effect.type) && isProEffectNeutral(effect.type, effect.params)) return false;
  if (isBurnInEffectType(effect.type) && isBurnInNeutral(effect.type, effect.params)) return false;
  return effect.enabled && !(effect.type === "blur" && typeof effect.params.radius === "number" && effect.params.radius <= 0);
}

export function hasAnimatedVideoEffects(clip: Pick<VideoEffectSource, "keyframes"> & Partial<Pick<VideoEffectSource, "effects">>): boolean {
  return (
    (clip.keyframes?.some(keyframe => animatedProperties.has(keyframe.property) || keyframe.property.startsWith(EFFECT_INSTANCE_KEYFRAME_PREFIX)) ?? false) ||
    // Keyframed Basic Correction / vignette / white balance are sampled per frame as well.
    hasAnimatedColorGrading(clip) ||
    // Time-driven effects (VHS / glitch) change every frame even without keyframes.
    (clip.effects?.some(isTimeVaryingProEffect) ?? false) ||
    // Burn-ins (timecode, names) draw text resolved from the clip's position, so they are sampled per frame too.
    hasBurnInEffects(clip) ||
    // Keyframed plugin parameters and time driven plugins (grain, flicker) are sampled per frame.
    hasPluginKeyframes(clip) ||
    hasTimeDrivenPluginEffects(clip)
  );
}

/** Sample the same effect stack for preview, playback, transitions and export. */
export function getAnimatedVideoEffects(clip: VideoEffectSource, localTime: number, burnIn?: BurnInSource): Effect[] {
  // Time-driven pro effects get the clip-local time added last so preview,
  // playback and export agree; the array is returned unchanged otherwise.
  const sampled = samplePluginEffects(sampleKeyframedEffects(clip, localTime), clip.keyframes, localTime);
  const timed = withProEffectTime(sampled, localTime) as Effect[];
  // Burn-ins read the clip's place on the timeline and in its source, so they need the project's burn-in source.
  return withBurnInText(timed, clip, localTime, burnIn) as Effect[];
}

function sampleKeyframedEffects(clip: VideoEffectSource, localTime: number): Effect[] {
  // Type-keyed keyframes first (older projects), then instance-keyed ones, which win per parameter.
  return applyEffectInstanceKeyframes(sampleTypeKeyedEffects(clip, localTime), clip.keyframes ?? [], localTime);
}

function sampleTypeKeyedEffects(clip: VideoEffectSource, localTime: number): Effect[] {
  const keyframes = clip.keyframes ?? [];
  const baseEffects = clip.effects ?? [];

  if (keyframes.length === 0) {
    return baseEffects;
  }

  // Each entry maps a keyframe property → effect type and the actual
  // param key the renderer reads (see EFFECT_DEFINITIONS in types/effects.ts).
  const animatedByType = new Map<string, { paramKey: string; value: number }>();

  for (const { keyframeProp, effectType, paramKey } of effectPropertyMap) {
    const effectKfs = keyframeEngine.getKeyframesForProperty(
      keyframes,
      keyframeProp,
    );
    if (effectKfs.length === 0) continue;
    const result = keyframeEngine.getValueAtTime(effectKfs, localTime);
    if (typeof result.value === "number") {
      animatedByType.set(effectType, { paramKey, value: result.value });
    }
  }

  const irisEffects = getAnimatedIrisEffects(clip, localTime);
  const proAnimated = sampleProEffectKeyframes(keyframes, localTime);
  if (animatedByType.size === 0 && irisEffects.length === 0 && proAnimated.size === 0) {
    return baseEffects;
  }

  // Patch existing effects with interpolated values.
  const seen = new Set<string>();
  // Keyframe properties are per effect type, so on a stack of HSL secondaries
  // they drive the first one only (the others keep their stored values).
  let secondaryKeyed = false;
  const patched = baseEffects.map((effect) => {
    const animated = animatedByType.get(effect.type);
    let proParams = isProEffectType(effect.type) ? proAnimated.get(effect.type) : undefined;
    if (proParams && effect.type === "hsl-secondary") {
      if (secondaryKeyed) proParams = undefined;
      else secondaryKeyed = true;
    }
    if (!animated && !proParams) return effect;
    seen.add(effect.type);
    return {
      ...effect,
      params: {
        ...effect.params,
        ...(animated ? { [animated.paramKey]: animated.value } : {}),
        ...(proParams ?? {}),
      },
    };
  });

  // Pro effects animate several parameters each; synthesise missing ones from
  // the effect defaults (what adding the effect from the UI would give) with
  // the keyframed parameters overriding.
  for (const [effectType, params] of proAnimated) {
    if (seen.has(effectType)) continue;
    patched.push({
      id: `kf-synth-${clip.id}-${effectType}`,
      type: effectType,
      enabled: true,
      params: { ...PRO_EFFECT_DEFAULTS[effectType], ...params },
    });
  }

  // Synthesize effects that have keyframes but aren't on the clip yet,
  // so users can animate brightness/contrast/etc. without first adding the
  // effect manually.
  for (const [effectType, { paramKey, value }] of animatedByType) {
    if (seen.has(effectType)) continue;
    patched.push({
      id: `kf-synth-${clip.id}-${effectType}`,
      type: effectType as Effect["type"],
      enabled: true,
      params: { [paramKey]: value },
    } as Effect);
  }

  return irisEffects.length ? [...patched, ...irisEffects] : patched;
}
