/**
 * Bridge modules for connecting UI stores to core engines
 *
 * Bridges provide the integration layer between React/Zustand UI state
 * and the @openreel/core engine implementations.
 */

export {
  PlaybackBridge,
  getPlaybackBridge,
  initializePlaybackBridge,
  disposePlaybackBridge,
} from "./playback-bridge";

export {
  RenderBridge,
  getRenderBridge,
  initializeRenderBridge,
  disposeRenderBridge,
  type RenderStats,
} from "./render-bridge";

export {
  MediaBridge,
  getMediaBridge,
  initializeMediaBridge,
  disposeMediaBridge,
  type MediaBridgeImportResult,
  type ImportProgressCallback,
  type WaveformProgressCallback,
} from "./media-bridge";

export {
  AudioBridge,
  getAudioBridge,
  initializeAudioBridge,
  disposeAudioBridge,
  clampVolume,
  clampPan,
  applyVolume,
  calculatePanGains,
  applyPan,
  interpolateVolume,
  interpolatePan,
  getClipVolumeAtTime,
  getClipPanAtTime,
  VOLUME_MIN,
  VOLUME_MAX,
  PAN_MIN,
  PAN_MAX,
} from "./audio-bridge";

export {
  EffectsBridge,
  getEffectsBridge,
  initializeEffectsBridge,
  disposeEffectsBridge,
  type VideoEffect,
  type VideoEffectType,
  type ColorGradingSettings,
  type EffectResult,
  type SerializedEffect,
  type SerializedColorGrading,
} from "./effects-bridge";

export {
  AudioBridgeEffects,
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  disposeAudioBridgeEffects,
  createEQEffect,
  createCompressorEffect,
  createReverbEffect,
  createDelayEffect,
  createNoiseReductionEffect,
  validateEQBand,
  validateCompressor,
  validateReverb,
  validateDelay,
  validateNoiseReduction,
  DEFAULT_EQ_BANDS,
  DEFAULT_COMPRESSOR,
  DEFAULT_REVERB,
  DEFAULT_DELAY,
  DEFAULT_NOISE_REDUCTION,
  type EQBandConfig,
  type CompressorConfig,
  type ReverbConfig,
  type DelayConfig,
  type NoiseReductionConfig,
  type NoiseProfileData,
  type AudioEffectResult,
} from "./audio-bridge-effects";

export {
  TextBridge,
  getTextBridge,
  initializeTextBridge,
  disposeTextBridge,
  type TextOperationResult,
  type CreateTextClipOptions,
  type UpdateTextStyleOptions,
  type TextAnimationOptions,
} from "./text-bridge";

export {
  GraphicsBridge,
  getGraphicsBridge,
  initializeGraphicsBridge,
  disposeGraphicsBridge,
  type GraphicsOperationResult,
  type CreateShapeOptions,
  type UpdateShapeStyleOptions,
  type ImportSVGOptions,
  type AddStickerOptions,
  type AddEmojiOptions,
} from "./graphics-bridge";

export {
  PhotoBridge,
  getPhotoBridge,
  initializePhotoBridge,
  disposePhotoBridge,
  type PhotoOperationResult,
  type AddLayerOptions,
  type RetouchingOptions,
  type BrushConfig,
} from "./photo-bridge";

export {
  TransitionBridge,
  getTransitionBridge,
  initializeTransitionBridge,
  disposeTransitionBridge,
  type TransitionOperationResult,
  type TransitionConfig,
  type TransitionTypeInfo,
} from "./transition-bridge";

export {
  getMotionTrackingBridge,
  resetMotionTrackingBridge,
  type MotionTrackingState,
  type MotionTrackingStateListener,
} from "./motion-tracking-bridge";

export {
  getBeatSyncBridge,
  initializeBeatSyncBridge,
  DEFAULT_BEAT_SYNC_OPTIONS,
  type BeatSyncState,
  type BeatSyncOptions,
} from "./beat-sync-bridge";

export {
  SilenceCutBridge,
  getSilenceCutBridge,
  disposeSilenceCutBridge,
  DEFAULT_SILENCE_SETTINGS,
  type SilenceSettings,
  type SilentRegion,
  type SilenceAnalysisResult,
  type SilenceProgressCallback,
} from "./silence-cut-bridge";
