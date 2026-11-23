/**
 * The "reduceReverb" clip audio effect: late-reverberation suppression for dialogue (Premiere's Essential Sound > Reduce Reverb,
 * Audition's DeReverb) with an Amount and a Sensitivity.
 *
 * Like spectral repair and Enhance Speech it works on the whole decoded source, not on the live chain: the processed source is
 * computed once off the main thread and cached, and the preview and the export both play that same buffer. The order is fixed:
 * spectral repair, then Reduce Reverb, then Enhance Speech, then hosted plugins, then the live chain. Reduce Reverb goes before the
 * denoiser on purpose: the dereverberation relies on the reverb still being a linear smear of the voice, which the non-linear denoiser
 * breaks, and measured on the synthetic rooms (`reverb-quality.test.ts`) that order scores equal or better on SI-SDR with less level loss.
 */
import type { Action } from "../../types/actions";
import type { Clip, Effect } from "../../types/timeline";
import { DEFAULT_REDUCE_REVERB_AMOUNT, DEFAULT_REDUCE_REVERB_SENSITIVITY, sanitizeReverbPercent, type ReduceReverbParams } from "./reverb-params";

export const REDUCE_REVERB_EFFECT_TYPE = "reduceReverb";

interface EffectLike {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

export const isReduceReverbEffect = (effect: Pick<Effect, "type">): boolean => effect.type === REDUCE_REVERB_EFFECT_TYPE;

export const sanitizeReduceReverbAmount = (raw: unknown): number => sanitizeReverbPercent(raw, DEFAULT_REDUCE_REVERB_AMOUNT);
export const sanitizeReduceReverbSensitivity = (raw: unknown): number => sanitizeReverbPercent(raw, DEFAULT_REDUCE_REVERB_SENSITIVITY);

export const sanitizeReduceReverbParams = (raw: Readonly<Record<string, unknown>> | undefined): ReduceReverbParams => ({
  amount: sanitizeReduceReverbAmount(raw?.amount),
  sensitivity: sanitizeReduceReverbSensitivity(raw?.sensitivity),
});

/** The parameters the clip's chain asks for (the last enabled "reduceReverb" effect wins), or null when there is none or Amount is 0. */
export function getReduceReverbParams(effects: readonly EffectLike[] | undefined): ReduceReverbParams | null {
  let found: ReduceReverbParams | null = null;
  for (const effect of effects ?? []) {
    if (effect.type !== REDUCE_REVERB_EFFECT_TYPE || effect.enabled === false) continue;
    found = sanitizeReduceReverbParams(effect.params);
  }
  return found && found.amount > 0 ? found : null;
}

export const hasReduceReverb = (effects: readonly EffectLike[] | undefined): boolean => getReduceReverbParams(effects) !== null;

/** The effects with Reduce Reverb removed, so the live chain never sees it. */
export const withoutReduceReverb = <T extends Pick<Effect, "type">>(effects: readonly T[]): T[] => effects.filter((effect) => effect.type !== REDUCE_REVERB_EFFECT_TYPE);

export const createReduceReverbEffect = (id: string, amount = DEFAULT_REDUCE_REVERB_AMOUNT, sensitivity = DEFAULT_REDUCE_REVERB_SENSITIVITY): Effect => ({
  id,
  type: REDUCE_REVERB_EFFECT_TYPE,
  enabled: true,
  params: { amount: sanitizeReduceReverbAmount(amount), sensitivity: sanitizeReduceReverbSensitivity(sensitivity) },
});

export const findReduceReverbEffect = (clip: Pick<Clip, "audioEffects"> | undefined): Effect | undefined =>
  (clip?.audioEffects ?? []).find((effect) => effect.type === REDUCE_REVERB_EFFECT_TYPE);

export interface ReduceReverbActionIds {
  readonly actionId: string;
  readonly effectId: string;
}

/**
 * The single undoable action that sets the clip's Reduce Reverb: add the effect when the clip has none, replace it when it has
 * one, null when nothing would change. `change` null removes the effect; fields not given keep their current value.
 */
export function planReduceReverbAction(
  clip: Pick<Clip, "id" | "audioEffects">,
  change: { readonly amount?: number; readonly sensitivity?: number } | null,
  ids: ReduceReverbActionIds,
  timestamp = Date.now(),
): Action | null {
  const existing = findReduceReverbEffect(clip);
  if (change === null) {
    return existing ? { id: ids.actionId, timestamp, type: "audio/removeEffect", params: { clipId: clip.id, effectId: existing.id } } : null;
  }
  if (!existing) {
    return { id: ids.actionId, timestamp, type: "audio/addEffect", params: { clipId: clip.id, effect: createReduceReverbEffect(ids.effectId, change.amount, change.sensitivity) } };
  }
  const current = sanitizeReduceReverbParams(existing.params);
  const amount = change.amount === undefined ? current.amount : sanitizeReduceReverbAmount(change.amount);
  const sensitivity = change.sensitivity === undefined ? current.sensitivity : sanitizeReduceReverbSensitivity(change.sensitivity);
  if (existing.enabled && amount === current.amount && sensitivity === current.sensitivity && existing.params.amount === amount && existing.params.sensitivity === sensitivity) return null;
  return {
    id: ids.actionId,
    timestamp,
    type: "audio/replaceEffect",
    params: { clipId: clip.id, effectId: existing.id, effect: { ...existing, enabled: true, params: { ...existing.params, amount, sensitivity } } },
  };
}
