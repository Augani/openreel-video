import type { Clip, Effect, Keyframe } from "@openreel/core";
import { keyframeEngine } from "@openreel/core/video/keyframe-engine";
import { PRO_EFFECT_NEUTRAL_PARAMS } from "@openreel/core";
import { getEffectParamKeyframes, isEffectParamAnimated, upsertEffectParamKeyframe } from "@openreel/core/video/effect-instance-keyframes";
import { useProjectStore } from "../stores/project-store";

/** Corner Pin corners are percent of the canvas, ordered top left, top right, bottom right, bottom left. */
export const CORNER_PIN_KEYS = ["x0", "y0", "x1", "y1", "x2", "y2", "x3", "y3"] as const;
export const CORNER_PIN_LIMITS = { min: -100, max: 200 } as const;

const clamp = (v: number) => Math.round(Math.max(CORNER_PIN_LIMITS.min, Math.min(CORNER_PIN_LIMITS.max, v)) * 100) / 100;

/** The eight corner values at a clip-local time: interpolated when a corner is keyframed, else the stored value. */
export function cornerPinPercentAt(keyframes: readonly Keyframe[], effect: Pick<Effect, "id" | "params">, localTime: number): number[] {
  const neutral = PRO_EFFECT_NEUTRAL_PARAMS["corner-pin"] as Record<string, number>;
  return CORNER_PIN_KEYS.map((key) => {
    const group = getEffectParamKeyframes(keyframes, effect.id, key);
    if (group.length > 0) {
      const sampled = keyframeEngine.getValueAtTime(group, localTime).value;
      if (typeof sampled === "number" && Number.isFinite(sampled)) return sampled;
    }
    const stored = effect.params[key];
    return typeof stored === "number" && Number.isFinite(stored) ? stored : neutral[key];
  });
}

export interface CornerPinEdit {
  /** Static parameter writes for corners that are not animated. */
  params: Record<string, number>;
  /** The full keyframe list when any moved corner is animated (a keyframe is written at the playhead). */
  keyframes: Keyframe[] | null;
}

/**
 * Plan moving one corner to (xPct, yPct): an animated coordinate gets a keyframe at the playhead (so the corner
 * stays where it was at other times), a static one changes its stored value. Pure.
 */
export function planCornerPinMove(clip: Pick<Clip, "keyframes">, effect: Pick<Effect, "id" | "params">, corner: number, xPct: number, yPct: number, localTime: number, makeId: () => string): CornerPinEdit {
  const values: Array<[string, number]> = [[`x${corner}`, clamp(xPct)], [`y${corner}`, clamp(yPct)]];
  const params: Record<string, number> = {};
  let keyframes: Keyframe[] | null = null;
  for (const [key, value] of values) {
    if (isEffectParamAnimated(clip.keyframes, effect.id, key)) keyframes = upsertEffectParamKeyframe(keyframes ?? clip.keyframes, effect.id, key, { time: localTime, value }, makeId);
    else params[key] = value;
  }
  return { params, keyframes };
}

/** Apply a corner move from the Program monitor as one undo step. */
export async function moveCornerPinCorner(clipId: string, effectId: string, corner: number, xPct: number, yPct: number, localTime: number): Promise<void> {
  const store = useProjectStore.getState();
  const clip = store.project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  const effect = clip?.effects.find((e) => e.id === effectId);
  if (!clip || !effect || effect.type !== "corner-pin") return;
  const plan = planCornerPinMove(clip, effect, corner, xPct, yPct, localTime, () => `keyframe-${crypto.randomUUID()}`);
  store.beginHistoryGroup("Move Corner Pin corner");
  try {
    if (Object.keys(plan.params).length) await useProjectStore.getState().updateVideoEffect(clipId, effectId, plan.params);
    if (plan.keyframes) useProjectStore.getState().updateClipKeyframes(clipId, plan.keyframes);
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
}
