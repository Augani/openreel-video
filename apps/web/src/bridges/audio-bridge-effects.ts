import type { Effect } from "@openreel/core";
import { AudioEffectsEngine, getAudioEffectsEngine } from "@openreel/core";
import type { EQBand } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * EQ band configuration for UI
 */
export interface EQBandConfig {
  type: EQBand["type"];
  frequency: number;
  gain: number;
  q: number;
}

/**
 * Compressor parameters
 */
export interface CompressorConfig {
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee?: number;
}

/**
 * Reverb parameters
 */
export interface ReverbConfig {
  roomSize: number;
  damping: number;
  wetLevel: number;
  dryLevel?: number;
  preDelay?: number;
}

/**
 * Delay parameters
 */
export interface DelayConfig {
  time: number;
  feedback: number;
  wetLevel: number;
}

export interface SerializedNoiseProfile {
  frequencyBins: number[];
  magnitudes: number[];
  sampleRate: number;
}

export const NOISE_REDUCTION_FOCUS_OPTIONS = [
  "balanced",
  "speech",
  "heavy",
  "wind",
  "hum",
] as const;

export type NoiseReductionFocus =
  (typeof NOISE_REDUCTION_FOCUS_OPTIONS)[number];

/**
 * Noise reduction parameters
 */
export interface NoiseReductionConfig {
  threshold: number;
  reduction: number;
  attack?: number;
  release?: number;
  focus?: NoiseReductionFocus;
  profile?: SerializedNoiseProfile;
}

/**
 * Noise profile data
 */
export interface NoiseProfileData {
  id: string;
  frequencyBins: Float32Array;
  magnitudes: Float32Array;
  sampleRate: number;
  createdAt: number;
}

/**
 * Audio effect application result
 */
export interface AudioEffectResult {
  success: boolean;
  effectId?: string;
  error?: string;
}

/**
 * Default EQ bands (5-band parametric)
 */
export const DEFAULT_EQ_BANDS: EQBandConfig[] = [
  { type: "lowshelf", frequency: 60, gain: 0, q: 0.707 },
  { type: "peaking", frequency: 250, gain: 0, q: 1.4 },
  { type: "peaking", frequency: 1000, gain: 0, q: 1.4 },
  { type: "peaking", frequency: 4000, gain: 0, q: 1.4 },
  { type: "highshelf", frequency: 16000, gain: 0, q: 0.707 },
];

/**
 * Default compressor settings
 */
export const DEFAULT_COMPRESSOR: CompressorConfig = {
  threshold: -20,
  ratio: 4,
  attack: 0.01,
  release: 0.1,
  knee: 6,
};

/**
 * Default reverb settings
 */
export const DEFAULT_REVERB: ReverbConfig = {
  roomSize: 0.5,
  damping: 0.5,
  wetLevel: 0.3,
  dryLevel: 1,
  preDelay: 0,
};

/**
 * Default delay settings
 */
export const DEFAULT_DELAY: DelayConfig = {
  time: 0.25,
  feedback: 0.3,
  wetLevel: 0.25,
};

/**
 * Default noise reduction settings
 */
export const DEFAULT_NOISE_REDUCTION: NoiseReductionConfig = {
  threshold: -40,
  reduction: 0.5,
  attack: 10,
  release: 100,
  focus: "balanced",
};

const isSerializedNoiseProfile = (
  profile: unknown,
): profile is SerializedNoiseProfile => {
  if (!profile || typeof profile !== "object") {
    return false;
  }

  const candidate = profile as Record<string, unknown>;

  return (
    Array.isArray(candidate.frequencyBins) &&
    candidate.frequencyBins.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    Array.isArray(candidate.magnitudes) &&
    candidate.magnitudes.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    candidate.frequencyBins.length === candidate.magnitudes.length &&
    typeof candidate.sampleRate === "number" &&
    Number.isFinite(candidate.sampleRate)
  );
};

/**
 * Validate EQ band parameters
 *
 * Ensure valid EQ parameters
 *
 * @param band - EQ band to validate
 * @returns Validated band with clamped values
 */
export function validateEQBand(band: Partial<EQBandConfig>): EQBandConfig {
  const validTypes: EQBand["type"][] = [
    "lowshelf",
    "highshelf",
    "peaking",
    "lowpass",
    "highpass",
    "notch",
  ];
  const type = validTypes.includes(band.type as EQBand["type"])
    ? (band.type as EQBand["type"])
    : "peaking";

  return {
    type,
    frequency: Math.max(20, Math.min(20000, band.frequency ?? 1000)),
    gain: Math.max(-24, Math.min(24, band.gain ?? 0)),
    q: Math.max(0.1, Math.min(18, band.q ?? 1)),
  };
}

/**
 * Validate compressor parameters
 *
 * Ensure valid compressor parameters
 *
 * @param config - Compressor config to validate
 * @returns Validated config with clamped values
 */
export function validateCompressor(
  config: Partial<CompressorConfig>,
): CompressorConfig {
  return {
    threshold: Math.max(-60, Math.min(0, config.threshold ?? -20)),
    ratio: Math.max(1, Math.min(20, config.ratio ?? 4)),
    attack: Math.max(0.001, Math.min(1, config.attack ?? 0.01)),
    release: Math.max(0.01, Math.min(3, config.release ?? 0.1)),
    knee: Math.max(0, Math.min(40, config.knee ?? 6)),
  };
}

/**
 * Validate reverb parameters
 *
 * Ensure valid reverb parameters
 *
 * @param config - Reverb config to validate
 * @returns Validated config with clamped values
 */
export function validateReverb(config: Partial<ReverbConfig>): ReverbConfig {
  return {
    roomSize: Math.max(0, Math.min(1, config.roomSize ?? 0.5)),
    damping: Math.max(0, Math.min(1, config.damping ?? 0.5)),
    wetLevel: Math.max(0, Math.min(1, config.wetLevel ?? 0.3)),
    dryLevel: Math.max(0, Math.min(1, config.dryLevel ?? 1)),
    preDelay: Math.max(0, Math.min(100, config.preDelay ?? 0)),
  };
}

/**
 * Validate delay parameters
 *
 * Ensure valid delay parameters
 *
 * @param config - Delay config to validate
 * @returns Validated config with clamped values
 */
export function validateDelay(config: Partial<DelayConfig>): DelayConfig {
  return {
    time: Math.max(0, Math.min(2, config.time ?? 0.25)),
    feedback: Math.max(0, Math.min(0.95, config.feedback ?? 0.3)),
    wetLevel: Math.max(0, Math.min(1, config.wetLevel ?? 0.25)),
  };
}

/**
 * Validate noise reduction parameters
 *
 * Ensure valid noise reduction parameters
 *
 * @param config - Noise reduction config to validate
 * @returns Validated config with clamped values
 */
export function validateNoiseReduction(
  config: Partial<NoiseReductionConfig>,
): NoiseReductionConfig {
  const focus = NOISE_REDUCTION_FOCUS_OPTIONS.includes(
    (config.focus ?? DEFAULT_NOISE_REDUCTION.focus) as NoiseReductionFocus,
  )
    ? (config.focus ?? DEFAULT_NOISE_REDUCTION.focus)
    : DEFAULT_NOISE_REDUCTION.focus;
  const profile = isSerializedNoiseProfile(config.profile)
    ? {
        frequencyBins: [...config.profile.frequencyBins],
        magnitudes: [...config.profile.magnitudes],
        sampleRate: config.profile.sampleRate,
      }
    : undefined;

  return {
    threshold: Math.max(-80, Math.min(0, config.threshold ?? -40)),
    reduction: Math.max(0, Math.min(1, config.reduction ?? 0.5)),
    attack: Math.max(0, Math.min(100, config.attack ?? 10)),
    release: Math.max(0, Math.min(500, config.release ?? 100)),
    focus,
    profile,
  };
}

/**
 * Create an EQ effect
 *
 * Apply EQ with frequency band adjustments
 *
 * @param bands - Array of EQ bands
 * @returns Effect object for EQ
 */
export function createEQEffect(bands: EQBandConfig[]): Effect {
  const validatedBands = bands.map(validateEQBand);
  return {
    id: `eq-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: "eq",
    params: { bands: validatedBands } as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Create a compressor effect
 *
 * Apply compressor with threshold, ratio, attack, release
 *
 * @param config - Compressor configuration
 * @returns Effect object for compressor
 */
export function createCompressorEffect(config: CompressorConfig): Effect {
  const validated = validateCompressor(config);
  return {
    id: `compressor-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: "compressor",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Create a reverb effect
 *
 * Apply reverb with room size, damping, wet/dry
 *
 * @param config - Reverb configuration
 * @returns Effect object for reverb
 */
export function createReverbEffect(config: ReverbConfig): Effect {
  const validated = validateReverb(config);
  return {
    id: `reverb-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: "reverb",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Create a delay effect
 *
 * Apply delay with time, feedback, wet level
 *
 * @param config - Delay configuration
 * @returns Effect object for delay
 */
export function createDelayEffect(config: DelayConfig): Effect {
  const validated = validateDelay(config);
  return {
    id: `delay-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: "delay",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * Create a noise reduction effect
 *
 * Apply noise reduction
 *
 * @param config - Noise reduction configuration
 * @returns Effect object for noise reduction
 */
export function createNoiseReductionEffect(
  config: NoiseReductionConfig,
): Effect {
  const validated = validateNoiseReduction(config);
  return {
    id: `noiseReduction-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`,
    type: "noiseReduction",
    params: validated as unknown as Record<string, unknown>,
    enabled: true,
  };
}

/**
 * AudioBridgeEffects class
 *
 * Provides methods for applying audio effects to clips through
 * the AudioEffectsEngine.
 *
 */
export class AudioBridgeEffects {
  private audioEffectsEngine: AudioEffectsEngine | null = null;
  private noiseProfiles: Map<string, NoiseProfileData> = new Map();
  private initialized = false;

  /**
   * Initialize the audio effects bridge
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.audioEffectsEngine = getAudioEffectsEngine();

    if (!this.audioEffectsEngine.isInitialized()) {
      await this.audioEffectsEngine.initialize();
    }

    this.initialized = true;
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the audio effects engine
   */
  getAudioEffectsEngine(): AudioEffectsEngine | null {
    return this.audioEffectsEngine;
  }

  /**
   * Apply EQ effect to a clip
   *
   * Apply EQ with frequency band adjustments
   *
   * @param clipId - ID of the clip
   * @param bands - Array of EQ bands
   * @returns Result of the operation
   */
  applyEQ(clipId: string, bands: EQBandConfig[]): AudioEffectResult {
    try {
      const effect = createEQEffect(bands);
      const projectStore = useProjectStore.getState();

      // Add effect to clip
      projectStore.addAudioEffect(clipId, effect);

      return { success: true, effectId: effect.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to apply EQ",
      };
    }
  }

  /**
   * Update EQ effect on a clip
   *
   * Update EQ parameters
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to update
   * @param bands - New EQ bands
   * @returns Result of the operation
   */
  updateEQ(
    clipId: string,
    effectId: string,
    bands: EQBandConfig[],
  ): AudioEffectResult {
    try {
      const validatedBands = bands.map(validateEQBand);
      const projectStore = useProjectStore.getState();

      projectStore.updateAudioEffect(clipId, effectId, {
        bands: validatedBands,
      });

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update EQ",
      };
    }
  }

  /**
   * Apply compressor effect to a clip
   *
   * Apply compressor with threshold, ratio, attack, release
   *
   * @param clipId - ID of the clip
   * @param config - Compressor configuration
   * @returns Result of the operation
   */
  applyCompressor(clipId: string, config: CompressorConfig): AudioEffectResult {
    try {
      const effect = createCompressorEffect(config);
      const projectStore = useProjectStore.getState();

      projectStore.addAudioEffect(clipId, effect);

      return { success: true, effectId: effect.id };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to apply compressor",
      };
    }
  }

  /**
   * Update compressor effect on a clip
   *
   * Update compressor parameters
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to update
   * @param config - New compressor configuration
   * @returns Result of the operation
   */
  updateCompressor(
    clipId: string,
    effectId: string,
    config: Partial<CompressorConfig>,
  ): AudioEffectResult {
    try {
      const validated = validateCompressor(config);
      const projectStore = useProjectStore.getState();

      projectStore.updateAudioEffect(
        clipId,
        effectId,
        validated as unknown as Record<string, unknown>,
      );

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update compressor",
      };
    }
  }

  /**
   * Apply reverb effect to a clip
   *
   * Apply reverb with room size, damping, wet/dry
   *
   * @param clipId - ID of the clip
   * @param config - Reverb configuration
   * @returns Result of the operation
   */
  applyReverb(clipId: string, config: ReverbConfig): AudioEffectResult {
    try {
      const effect = createReverbEffect(config);
      const projectStore = useProjectStore.getState();

      projectStore.addAudioEffect(clipId, effect);

      return { success: true, effectId: effect.id };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to apply reverb",
      };
    }
  }

  /**
   * Update reverb effect on a clip
   *
   * Update reverb parameters
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to update
   * @param config - New reverb configuration
   * @returns Result of the operation
   */
  updateReverb(
    clipId: string,
    effectId: string,
    config: Partial<ReverbConfig>,
  ): AudioEffectResult {
    try {
      const validated = validateReverb(config);
      const projectStore = useProjectStore.getState();

      projectStore.updateAudioEffect(
        clipId,
        effectId,
        validated as unknown as Record<string, unknown>,
      );

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update reverb",
      };
    }
  }

  /**
   * Apply delay effect to a clip
   *
   * Apply delay with time, feedback, wet level
   *
   * @param clipId - ID of the clip
   * @param config - Delay configuration
   * @returns Result of the operation
   */
  applyDelay(clipId: string, config: DelayConfig): AudioEffectResult {
    try {
      const effect = createDelayEffect(config);
      const projectStore = useProjectStore.getState();

      projectStore.addAudioEffect(clipId, effect);

      return { success: true, effectId: effect.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to apply delay",
      };
    }
  }

  /**
   * Update delay effect on a clip
   *
   * Update delay parameters
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to update
   * @param config - New delay configuration
   * @returns Result of the operation
   */
  updateDelay(
    clipId: string,
    effectId: string,
    config: Partial<DelayConfig>,
  ): AudioEffectResult {
    try {
      const validated = validateDelay(config);
      const projectStore = useProjectStore.getState();

      projectStore.updateAudioEffect(
        clipId,
        effectId,
        validated as unknown as Record<string, unknown>,
      );

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update delay",
      };
    }
  }

  /**
   * Apply noise reduction effect to a clip
   *
   * Apply noise reduction
   *
   * @param clipId - ID of the clip
   * @param config - Noise reduction configuration
   * @returns Result of the operation
   */
  applyNoiseReduction(
    clipId: string,
    config: NoiseReductionConfig,
  ): AudioEffectResult {
    try {
      const effect = createNoiseReductionEffect(config);
      const projectStore = useProjectStore.getState();

      projectStore.addAudioEffect(clipId, effect);

      return { success: true, effectId: effect.id };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply noise reduction",
      };
    }
  }

  /**
   * Update noise reduction effect on a clip
   *
   * Update noise reduction parameters
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to update
   * @param config - New noise reduction configuration
   * @returns Result of the operation
   */
  updateNoiseReduction(
    clipId: string,
    effectId: string,
    config: Partial<NoiseReductionConfig>,
  ): AudioEffectResult {
    try {
      const validated = validateNoiseReduction(config);
      const projectStore = useProjectStore.getState();

      projectStore.updateAudioEffect(
        clipId,
        effectId,
        validated as unknown as Record<string, unknown>,
      );

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update noise reduction",
      };
    }
  }

  /**
   * Learn noise profile from an audio buffer
   *
   * Learn noise profile from audio segment
   *
   * @param buffer - Audio buffer containing noise sample
   * @param profileId - Optional ID for the profile
   * @returns The learned noise profile data
   */
  async learnNoiseProfile(
    buffer: AudioBuffer,
    profileId?: string,
  ): Promise<NoiseProfileData> {
    if (!this.audioEffectsEngine) {
      throw new Error("AudioBridgeEffects not initialized");
    }

    const id =
      profileId ??
      `noise-profile-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const profile = await this.audioEffectsEngine.learnNoiseProfile(buffer, id);

    const profileData: NoiseProfileData = {
      id,
      frequencyBins: profile.frequencyBins,
      magnitudes: profile.magnitudes,
      sampleRate: profile.sampleRate,
      createdAt: Date.now(),
    };

    this.noiseProfiles.set(id, profileData);

    return profileData;
  }

  /**
   * Get a stored noise profile
   *
   * @param profileId - ID of the profile
   * @returns The noise profile data or undefined
   */
  getNoiseProfile(profileId: string): NoiseProfileData | undefined {
    return this.noiseProfiles.get(profileId);
  }

  /**
   * Get all stored noise profiles
   *
   * @returns Array of all noise profile data
   */
  getAllNoiseProfiles(): NoiseProfileData[] {
    return Array.from(this.noiseProfiles.values());
  }

  /**
   * Remove a noise profile
   *
   * @param profileId - ID of the profile to remove
   * @returns True if removed, false if not found
   */
  removeNoiseProfile(profileId: string): boolean {
    return this.noiseProfiles.delete(profileId);
  }

  /**
   * Remove an audio effect from a clip
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to remove
   * @returns Result of the operation
   */
  removeEffect(clipId: string, effectId: string): AudioEffectResult {
    try {
      const projectStore = useProjectStore.getState();
      projectStore.removeAudioEffect(clipId, effectId);

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to remove effect",
      };
    }
  }

  /**
   * Toggle an audio effect's enabled state
   *
   * @param clipId - ID of the clip
   * @param effectId - ID of the effect to toggle
   * @param enabled - New enabled state
   * @returns Result of the operation
   */
  toggleEffect(
    clipId: string,
    effectId: string,
    enabled: boolean,
  ): AudioEffectResult {
    try {
      const projectStore = useProjectStore.getState();
      projectStore.toggleAudioEffect(clipId, effectId, enabled);

      return { success: true, effectId };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to toggle effect",
      };
    }
  }

  /**
   * Process an audio buffer with effects
   *
   * Process audio with effects
   *
   * @param buffer - Input audio buffer
   * @param effects - Array of effects to apply
   * @returns Processed audio buffer
   */
  async processAudio(
    buffer: AudioBuffer,
    effects: Effect[],
  ): Promise<AudioBuffer> {
    if (!this.audioEffectsEngine) {
      throw new Error("AudioBridgeEffects not initialized");
    }

    const result = await this.audioEffectsEngine.applyEffectChain(
      buffer,
      effects,
    );
    return result.buffer;
  }

  /**
   * Dispose of the bridge and clean up resources
   */
  dispose(): void {
    this.noiseProfiles.clear();
    this.audioEffectsEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let audioBridgeEffectsInstance: AudioBridgeEffects | null = null;

/**
 * Get the shared AudioBridgeEffects instance
 */
export function getAudioBridgeEffects(): AudioBridgeEffects {
  if (!audioBridgeEffectsInstance) {
    audioBridgeEffectsInstance = new AudioBridgeEffects();
  }
  return audioBridgeEffectsInstance;
}

/**
 * Initialize the shared AudioBridgeEffects
 */
export async function initializeAudioBridgeEffects(): Promise<AudioBridgeEffects> {
  const bridge = getAudioBridgeEffects();
  await bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared AudioBridgeEffects
 */
export function disposeAudioBridgeEffects(): void {
  if (audioBridgeEffectsInstance) {
    audioBridgeEffectsInstance.dispose();
    audioBridgeEffectsInstance = null;
  }
}
