import type { AutomationPoint, Clip } from "../../types/timeline";

/** Clip volume is bounded to 0..4 (+12 dB) by the action validator. */
export const MAX_CLIP_VOLUME = 4;

export interface ClipNormalizationInput {
  /** Integrated loudness of the clip as it currently sounds (LUFS). */
  readonly integrated: number;
  /** True peak of the clip as it currently sounds (dBTP). */
  readonly truePeak: number;
}

export type ClipGainAction =
  | { type: "audio/setVolume"; params: { clipId: string; volume: number } }
  | { type: "audio/addAutomation"; params: { clipId: string; points: AutomationPoint[] } };

export interface ClipNormalizationPlan {
  /** Gain that was asked for to land on the target, dB. */
  readonly requestedGainDb: number;
  /** Gain the +12 dB clip-volume ceiling allows, dB. */
  readonly appliedGainDb: number;
  /** The +12 dB ceiling stopped the clip from reaching the target. */
  readonly clamped: boolean;
  /** Expected integrated loudness once applied. */
  readonly resultingLufs: number;
  /** Expected true peak once applied. */
  readonly resultingTruePeakDb: number;
  /** The clip is silent, so there is nothing to normalize. */
  readonly silent: boolean;
  /** The single action that applies it (one undo step). */
  readonly action?: ClipGainAction;
}

/**
 * Pure planning for "Normalize loudness" on a clip: the one action that sets
 * the clip gain so its measured integrated loudness lands on `targetLufs`.
 * Clips with volume automation have the automation scaled instead, because the
 * automation lane replaces the scalar volume during playback and export.
 */
export function planClipNormalization(
  clip: Pick<Clip, "id" | "volume" | "automation">,
  measured: ClipNormalizationInput,
  targetLufs: number,
): ClipNormalizationPlan {
  if (!Number.isFinite(measured.integrated)) {
    return {
      requestedGainDb: 0,
      appliedGainDb: 0,
      clamped: false,
      resultingLufs: measured.integrated,
      resultingTruePeakDb: measured.truePeak,
      silent: true,
    };
  }
  const requestedGainDb = targetLufs - measured.integrated;
  const lane = clip.automation?.volume;
  const hasLane = !!lane && lane.length > 0;
  const base = hasLane ? Math.max(...lane.map((p) => p.value)) : clip.volume;
  let scale = Math.pow(10, requestedGainDb / 20);
  let clamped = false;
  if (base > 0 && base * scale > MAX_CLIP_VOLUME) {
    scale = MAX_CLIP_VOLUME / base;
    clamped = true;
  }
  const appliedGainDb = 20 * Math.log10(scale);
  const action: ClipGainAction = hasLane
    ? {
        type: "audio/addAutomation",
        params: {
          clipId: clip.id,
          points: lane.map((p) => ({ ...p, value: Math.min(MAX_CLIP_VOLUME, p.value * scale) })),
        },
      }
    : { type: "audio/setVolume", params: { clipId: clip.id, volume: Math.min(MAX_CLIP_VOLUME, clip.volume * scale) } };
  return {
    requestedGainDb,
    appliedGainDb,
    clamped,
    resultingLufs: measured.integrated + appliedGainDb,
    resultingTruePeakDb: measured.truePeak + appliedGainDb,
    silent: false,
    action,
  };
}
