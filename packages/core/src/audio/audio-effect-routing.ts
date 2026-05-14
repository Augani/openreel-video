import type { AudioEffectParams } from "../types/effects";
import type { Effect } from "../types/timeline";

export interface SerializedNoiseProfile {
  readonly frequencyBins: number[];
  readonly magnitudes: number[];
  readonly standardDeviations?: number[];
  readonly sampleRate: number;
  readonly fftSize?: number;
}

const isFiniteNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === "number" && Number.isFinite(entry));

const isValidFftSize = (value: unknown, binCount: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value > 0 &&
  (value & (value - 1)) === 0 &&
  value / 2 === binCount;

export const isSerializedNoiseProfile = (
  value: unknown,
): value is SerializedNoiseProfile => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const profile = value as Record<string, unknown>;

  return (
    isFiniteNumberArray(profile.frequencyBins) &&
    isFiniteNumberArray(profile.magnitudes) &&
    profile.frequencyBins.length === profile.magnitudes.length &&
    (profile.standardDeviations === undefined ||
      (isFiniteNumberArray(profile.standardDeviations) &&
        profile.standardDeviations.length === profile.magnitudes.length)) &&
    typeof profile.sampleRate === "number" &&
    Number.isFinite(profile.sampleRate) &&
    (profile.fftSize === undefined ||
      isValidFftSize(profile.fftSize, profile.magnitudes.length))
  );
};

export const getPreviewAudioEffects = (effects: readonly Effect[]): Effect[] =>
  effects.filter((effect) => effect.metadata?.previewBypass !== true);

export const getPanFromAudioEffects = (effects: readonly Effect[]): number => {
  const panEffect = effects.find(
    (effect) =>
      effect.type === "pan" &&
      typeof (effect.params as AudioEffectParams["pan"]).value === "number",
  );

  if (!panEffect) {
    return 0;
  }

  return Math.max(
    -1,
    Math.min(1, (panEffect.params as AudioEffectParams["pan"]).value),
  );
};

export const splitProfileAwareNoiseReductionEffects = (
  effects: readonly Effect[],
): {
  profileAwareNoiseEffects: Effect[];
  realtimeEffects: Effect[];
} => {
  const profileAwareNoiseEffects: Effect[] = [];
  const realtimeEffects: Effect[] = [];

  for (const effect of effects) {
    if (
      effect.type === "noiseReduction" &&
      isSerializedNoiseProfile(
        (effect.params as Partial<AudioEffectParams["noiseReduction"]>).profile,
      )
    ) {
      profileAwareNoiseEffects.push(effect);
      continue;
    }

    realtimeEffects.push(effect);
  }

  return {
    profileAwareNoiseEffects,
    realtimeEffects,
  };
};