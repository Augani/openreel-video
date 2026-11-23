/**
 * The heavy engine surface, and the ONLY module that statically imports it
 * for the startup path. Never import this file statically from an entry-path
 * module: go through `./lazy-engines` (memoised dynamic import) instead. The
 * bundle budget (bundle-budgets.json) catches a regression.
 */
// Records where Enhance Speech finds its model and the onnxruntime WASM (URLs only; nothing is fetched until a job runs).
import "./enhance-model-config";
// Hosted audio plugins: installs the desktop render host (a no-op in the browser).
import "./native-plugin-backend";

export {
  ActionExecutor,
  VideoEngine,
  AudioEngine,
  PlaybackController,
  PhotoEngine,
  ExportEngine,
  ChromaKeyEngine,
  MaskEngine,
  NestedSequenceEngine,
  AdjustmentLayerEngine,
  getVideoEngine,
  getAudioEngine,
  getPlaybackController,
  getPhotoEngine,
  getExportEngine,
  getRecommendedCacheBudget,
  getMediaMemoryBudget,
  getMemoryGovernor,
  subscribeMediaMemoryBudget,
  titleEngine,
  graphicsEngine,
  getSpeedEngine,
  getAdjustmentLayerEngine,
  getNestedSequenceEngine,
  textAnimationEngine,
  splitCaptionIntoSingleLineCues,
  motionEngine,
  getMotionPreset,
  registerProjectGeneratedShaders,
  VideoEffectsEngine,
  EchoCompositor,
  ColorGradingEngine,
  lutFromJson,
  isWebGPUSupported,
  createTransitionEngine,
  initializeMediaImportService,
  getWaveformGenerator,
  normalizeProjectStoredFields,
  normalizeGeneratedShaders,
  normalizeProjectMotionFields,
  normalizeProjectAudioRacks,
  normalizeProjectIrisAnimations,
  reflowMotionAutoLayoutGroups,
  withEffectDefaults,
  prepareUltraKey,
  ultraKeyBaseMatte,
  getDefaultEffectParams,
  isProEffectType,
  withBurnInText,
  BURN_IN_SAMPLE_SOURCE,
  PRO_EFFECT_DEFAULTS,
  withVrSequenceLayout,
  resolveEditingTemplate,
  getBuiltInEditingTemplate,
  getBuiltInEditingTemplates,
} from "@openreel/core";
// Both pull the pro-effect spec tables, so they ship with the engines rather than the startup entry.
export {
  cloneEffectInstanceKeyframes,
  rekeyKeyframesToEffectInstance,
} from "@openreel/core/video/effect-instance-keyframes";
