import type { Effect } from "@openreel/core";

/**
 * Noise reduction parameters
 * Apply noise reduction to reduce background noise
 */
interface NoiseReductionParams {
  /** Threshold in dB below which audio is considered noise (-60 to 0) */
  threshold: number;
  /** Amount of reduction to apply (0 to 1) */
  reduction: number;
  /** Attack time in milliseconds (0 to 100) */
  attack?: number;
  /** Release time in milliseconds (0 to 500) */
  release?: number;
}

/**
 * Normalization parameters
 * Apply audio normalization to adjust levels
 */
interface NormalizationParams {
  /** Target loudness in LUFS (-24 to 0) */
  targetLoudness: number;
  /** Peak ceiling in dB (-6 to 0) */
  peakCeiling?: number;
  /** Enable true peak limiting */
  truePeak?: boolean;
}

/**
 * Default noise reduction parameters
 */
const DEFAULT_NOISE_REDUCTION: NoiseReductionParams = {
  threshold: -40,
  reduction: 0.5,
  attack: 10,
  release: 100,
};

/**
 * Default normalization parameters
 */
const DEFAULT_NORMALIZATION: NormalizationParams = {
  targetLoudness: -14,
  peakCeiling: -1,
  truePeak: true,
};

/**
 * Validate noise reduction parameters
 *
 * Ensure valid noise reduction parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Noise reduction parameters to validate
 * @returns Validated and clamped parameters
 */
function validateNoiseReductionParams(
  params: Partial<NoiseReductionParams>,
): NoiseReductionParams {
  return {
    threshold: Math.max(
      -60,
      Math.min(0, params.threshold ?? DEFAULT_NOISE_REDUCTION.threshold),
    ),
    reduction: Math.max(
      0,
      Math.min(1, params.reduction ?? DEFAULT_NOISE_REDUCTION.reduction),
    ),
    attack: Math.max(
      0,
      Math.min(100, params.attack ?? DEFAULT_NOISE_REDUCTION.attack!),
    ),
    release: Math.max(
      0,
      Math.min(500, params.release ?? DEFAULT_NOISE_REDUCTION.release!),
    ),
  };
}

/**
 * Validate normalization parameters
 *
 * Ensure valid normalization parameters
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Normalization parameters to validate
 * @returns Validated and clamped parameters
 */
function validateNormalizationParams(
  params: Partial<NormalizationParams>,
): NormalizationParams {
  return {
    targetLoudness: Math.max(
      -24,
      Math.min(
        0,
        params.targetLoudness ?? DEFAULT_NORMALIZATION.targetLoudness,
      ),
    ),
    peakCeiling: Math.max(
      -6,
      Math.min(0, params.peakCeiling ?? DEFAULT_NORMALIZATION.peakCeiling!),
    ),
    truePeak: params.truePeak ?? DEFAULT_NORMALIZATION.truePeak!,
  };
}

/**
 * Create a noise reduction effect
 *
 * Apply noise reduction to reduce background noise
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * @param params - Noise reduction parameters
 * @returns Effect object for noise reduction
 */
export function createNoiseReductionEffect(
  params: Partial<NoiseReductionParams> = {},
): Effect {
  const validated = validateNoiseReductionParams(params);
  return {
    id: `noise-reduction-${Date.now()}`,
    type: "noiseReduction",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Create a normalization effect using compressor
 *
 * Apply audio normalization to adjust levels
 * Feature: core-ui-integration, Property 40: Audio Effect Processing
 *
 * Normalization is implemented using a compressor with makeup gain
 * to achieve target loudness while respecting peak ceiling.
 *
 * @param params - Normalization parameters
 * @returns Effect object for normalization
 */
export function createNormalizationEffect(
  params: Partial<NormalizationParams> = {},
): Effect {
  const validated = validateNormalizationParams(params);

  // Calculate compressor settings based on target loudness
  // Lower target loudness = more compression needed
  const compressionRatio = Math.max(
    2,
    Math.min(8, -validated.targetLoudness / 4),
  );
  const threshold = validated.targetLoudness + 6; // Threshold above target

  return {
    id: `normalization-${Date.now()}`,
    type: "compressor",
    params: {
      threshold: Math.max(-60, Math.min(0, threshold)),
      ratio: compressionRatio,
      attack: 0.01,
      release: 0.1,
      knee: 6,
      makeupGain: Math.abs(validated.targetLoudness) / 2,
    },
    enabled: true,
  };
}
