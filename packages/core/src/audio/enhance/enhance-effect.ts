/**
 * The "enhanceSpeech" clip audio effect: ML dialogue enhancement (noise and room reverb removal) with a Mix amount.
 *
 * Like spectral repair it works on the whole decoded source, not on the live chain: the enhanced source is computed
 * once off the main thread and cached, and the preview and the export both play that same buffer. Mix is applied to
 * the cached result (wet = enhanced, dry = original), so moving it never re-runs the model.
 */
import type { Action } from "../../types/actions";
import type { Clip, Effect } from "../../types/timeline";

export const ENHANCE_SPEECH_EFFECT_TYPE = "enhanceSpeech";
export const DEFAULT_ENHANCE_MIX = 100;
/** Speech / Background balance: 100 = speech only (what every project saved before the control existed renders), 50 = the original mix, 0 = background only. */
export const DEFAULT_ENHANCE_BALANCE = 100;

interface EffectLike {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

export const isEnhanceSpeechEffect = (effect: Pick<Effect, "type">): boolean => effect.type === ENHANCE_SPEECH_EFFECT_TYPE;

/** Mix as a percentage in [0, 100]; anything unusable becomes the default (fully enhanced). */
export function sanitizeEnhanceMix(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_ENHANCE_MIX;
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/** Speech / Background balance as a percentage in [0, 100]; anything unusable becomes the default (speech only). */
export function sanitizeEnhanceBalance(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_ENHANCE_BALANCE;
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

/**
 * The gains the two stems get at a balance. 100: speech 1, background 0 (the enhanced signal itself). Down to 50 the background
 * comes back to unity (the original mix); below 50 the speech is turned down to nothing at 0 (background only).
 */
export function speechBackgroundGains(balance: unknown): { speech: number; background: number } {
  const b = sanitizeEnhanceBalance(balance);
  return b >= 50 ? { speech: 1, background: (100 - b) / 50 } : { speech: b / 50, background: 1 };
}

/** The mix (0..100) the clip's chain asks for: the last enabled "enhanceSpeech" effect wins; 0 when there is none. */
export function getEnhanceSpeechMix(effects: readonly EffectLike[] | undefined): number {
  let mix = 0;
  for (const effect of effects ?? []) {
    if (effect.type !== ENHANCE_SPEECH_EFFECT_TYPE || effect.enabled === false) continue;
    mix = sanitizeEnhanceMix(effect.params?.mix);
  }
  return mix;
}

/** The Speech / Background balance (0..100) of the last enabled "enhanceSpeech" effect; 100 when none or when it was never set. */
export function getEnhanceSpeechBalance(effects: readonly EffectLike[] | undefined): number {
  let balance = DEFAULT_ENHANCE_BALANCE;
  for (const effect of effects ?? []) {
    if (effect.type !== ENHANCE_SPEECH_EFFECT_TYPE || effect.enabled === false) continue;
    balance = sanitizeEnhanceBalance(effect.params?.balance);
  }
  return balance;
}

export const hasEnhanceSpeech = (effects: readonly EffectLike[] | undefined): boolean => getEnhanceSpeechMix(effects) > 0;

/** The enhance-speech effect in the chain with the effect removed, so the live chain never sees it. */
export const withoutEnhanceSpeech = <T extends Pick<Effect, "type">>(effects: readonly T[]): T[] => effects.filter((effect) => effect.type !== ENHANCE_SPEECH_EFFECT_TYPE);

/** `balance` is stored only when it is not the default, so a project that never touches it keeps exactly the params it always had. */
export const createEnhanceSpeechEffect = (id: string, mix = DEFAULT_ENHANCE_MIX, balance = DEFAULT_ENHANCE_BALANCE): Effect => ({
  id,
  type: ENHANCE_SPEECH_EFFECT_TYPE,
  enabled: true,
  params: sanitizeEnhanceBalance(balance) < DEFAULT_ENHANCE_BALANCE ? { mix: sanitizeEnhanceMix(mix), balance: sanitizeEnhanceBalance(balance) } : { mix: sanitizeEnhanceMix(mix) },
});

export const findEnhanceSpeechEffect = (clip: Pick<Clip, "audioEffects"> | undefined): Effect | undefined =>
  (clip?.audioEffects ?? []).find((effect) => effect.type === ENHANCE_SPEECH_EFFECT_TYPE);

/**
 * Dry/wet blend of two equally shaped channel sets. mix 0 returns `dry`, 100 returns `wet` (the very arrays), anything
 * between is the linear blend. Pure and deterministic, so the preview and the export produce the same samples.
 */
export function mixDryWet(dry: readonly Float32Array[], wet: readonly Float32Array[], mixPercent: number): Float32Array[] {
  const amount = sanitizeEnhanceMix(mixPercent) / 100;
  return dry.map((channel, c) => {
    const processed = wet[c] ?? wet[0];
    if (amount >= 1) return processed;
    if (amount <= 0) return channel;
    const out = new Float32Array(channel.length);
    const n = Math.min(channel.length, processed.length);
    for (let i = 0; i < n; i += 1) out[i] = channel[i] + (processed[i] - channel[i]) * amount;
    return out;
  });
}

/**
 * Remixes the enhanced (speech) and the original into speech and background and blends them back at the balance's gains.
 * background = dry - wet, sample for sample: the enhancement is aligned with its source (same length, zero delay), so the
 * difference is what the network took out. Balance 100 returns `wet` itself (the very arrays), so the default is bit-identical
 * to an enhancement without the control. Pure and deterministic.
 */
export function remixSpeechBackground(dry: readonly Float32Array[], wet: readonly Float32Array[], balance: number): Float32Array[] {
  const gains = speechBackgroundGains(balance);
  if (gains.speech === 1 && gains.background === 0) return dry.map((_, c) => wet[c] ?? wet[0]);
  return dry.map((channel, c) => {
    const speech = wet[c] ?? wet[0];
    const out = new Float32Array(channel.length);
    const n = Math.min(channel.length, speech.length);
    for (let i = 0; i < n; i += 1) out[i] = gains.speech * speech[i] + gains.background * (channel[i] - speech[i]);
    return out;
  });
}

export interface EnhanceActionIds {
  readonly actionId: string;
  readonly effectId: string;
}

/**
 * The single undoable action that makes the clip's Enhance Speech mix `mix`: add the effect when the clip has none,
 * replace it when it has one, null when nothing would change. `mix` null removes the effect.
 */
export function planEnhanceSpeechAction(
  clip: Pick<Clip, "id" | "audioEffects">,
  mix: number | null,
  ids: EnhanceActionIds,
  timestamp = Date.now(),
): Action | null {
  return planEnhanceSpeechChange(clip, { mix }, ids, timestamp);
}

/**
 * The single undoable action that sets the Mix and/or the Speech / Background balance of the clip's Enhance Speech (adding the
 * effect when the clip has none). `mix: null` removes the effect. Whatever is not given keeps its current value; null when nothing
 * would change.
 */
export function planEnhanceSpeechChange(
  clip: Pick<Clip, "id" | "audioEffects">,
  change: { readonly mix?: number | null; readonly balance?: number },
  ids: EnhanceActionIds,
  timestamp = Date.now(),
): Action | null {
  const mix = change.mix === undefined ? undefined : change.mix;
  const existing = findEnhanceSpeechEffect(clip);
  if (mix === null) {
    return existing ? { id: ids.actionId, timestamp, type: "audio/removeEffect", params: { clipId: clip.id, effectId: existing.id } } : null;
  }
  if (!existing) {
    const next = mix === undefined ? DEFAULT_ENHANCE_MIX : sanitizeEnhanceMix(mix);
    const balance = change.balance === undefined ? DEFAULT_ENHANCE_BALANCE : sanitizeEnhanceBalance(change.balance);
    return { id: ids.actionId, timestamp, type: "audio/addEffect", params: { clipId: clip.id, effect: createEnhanceSpeechEffect(ids.effectId, next, balance) } };
  }
  const nextMix = mix === undefined ? sanitizeEnhanceMix(existing.params.mix) : sanitizeEnhanceMix(mix);
  const nextBalance = change.balance === undefined ? sanitizeEnhanceBalance(existing.params.balance) : sanitizeEnhanceBalance(change.balance);
  if (existing.enabled && sanitizeEnhanceMix(existing.params.mix) === nextMix && sanitizeEnhanceBalance(existing.params.balance) === nextBalance) return null;
  // A balance at its default is not stored, so a project that never used the control is not rewritten.
  const { balance: _previous, ...rest } = existing.params as Record<string, unknown>;
  void _previous;
  const params = { ...rest, mix: nextMix, ...(nextBalance < DEFAULT_ENHANCE_BALANCE ? { balance: nextBalance } : {}) };
  return {
    id: ids.actionId,
    timestamp,
    type: "audio/replaceEffect",
    params: { clipId: clip.id, effectId: existing.id, effect: { ...existing, enabled: true, params } },
  };
}
