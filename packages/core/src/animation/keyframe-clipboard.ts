import type { Keyframe } from "../types/timeline";

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
