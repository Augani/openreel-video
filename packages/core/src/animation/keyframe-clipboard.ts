import type { Keyframe } from "../types/timeline";
import { effectInstanceKeyframeProperty, parseEffectInstanceKeyframeProperty } from "../video/effect-instance-keyframes";

export interface CopiedKeyframes {
  /** Keyframes with times rebased so the earliest copied key is at 0. */
  readonly keyframes: readonly Keyframe[];
  readonly properties: readonly string[];
}

export function copyKeyframeSet(selected: readonly Keyframe[]): CopiedKeyframes {
  const sorted = [...selected].sort((a, b) => a.time - b.time);
  const origin = sorted[0]?.time ?? 0;
  return {
    keyframes: sorted.map((key) => ({ ...key, time: key.time - origin })),
    properties: Array.from(new Set(sorted.map((key) => key.property))),
  };
}

const kindOf = (value: unknown) => (typeof value === "number" ? "number" : typeof value);
const SAME_TIME = 1e-6;

/**
 * Paste copied keys onto `existing` with the first key landing at `time`
 * (clip-local). When exactly one property was copied and `targetProperty` is given,
 * the keys are retargeted to it (same-typed values only). Existing keys of the
 * target property at the same instant are replaced. Returns the full new list.
 */
export function pasteKeyframeSet(
  existing: readonly Keyframe[],
  copied: CopiedKeyframes,
  options: { time: number; targetProperty?: string; maxTime?: number; newId: () => string },
): Keyframe[] {
  const retarget = options.targetProperty && copied.properties.length === 1 ? options.targetProperty : undefined;
  const targetKind = retarget
    ? kindOf(existing.find((key) => key.property === retarget)?.value ?? copied.keyframes[0]?.value)
    : undefined;
  const pasted: Keyframe[] = [];
  for (const key of copied.keyframes) {
    if (retarget && targetKind !== kindOf(key.value)) continue;
    let time = Math.max(0, options.time + key.time);
    if (options.maxTime !== undefined) time = Math.min(time, options.maxTime);
    pasted.push({ ...key, id: options.newId(), property: retarget ?? key.property, time });
  }
  const kept = existing.filter(
    (key) => !pasted.some((p) => p.property === key.property && Math.abs(p.time - key.time) < SAME_TIME),
  );
  return [...kept, ...pasted];
}

export interface KeyframeEffectRef {
  readonly id: string;
  readonly type: string;
}

/**
 * Effect parameter keys belong to an effect INSTANCE (`fx:<effectId>:<param>`), so keys copied from
 * another clip would point at an effect the target does not have. Each such key is moved onto the
 * target's effect of the same type when there is exactly one; a key that already points at an effect
 * of the target (same clip, or a duplicate that kept ids) stays; otherwise it is dropped and counted.
 * Transform keys (position, scale, rotation, opacity) always paste as they are.
 */
export function retargetCopiedKeyframes(
  keyframes: readonly Keyframe[],
  sourceEffects: readonly KeyframeEffectRef[],
  targetEffects: readonly KeyframeEffectRef[],
): { keyframes: Keyframe[]; dropped: number } {
  const out: Keyframe[] = [];
  let dropped = 0;
  for (const key of keyframes) {
    const ref = parseEffectInstanceKeyframeProperty(key.property);
    if (!ref) { out.push(key); continue; }
    if (targetEffects.some((effect) => effect.id === ref.effectId)) { out.push(key); continue; }
    const type = sourceEffects.find((effect) => effect.id === ref.effectId)?.type;
    const candidates = type ? targetEffects.filter((effect) => effect.type === type) : [];
    if (candidates.length === 1) out.push({ ...key, property: effectInstanceKeyframeProperty(candidates[0].id, ref.param) });
    else dropped++;
  }
  return { keyframes: out, dropped };
}
