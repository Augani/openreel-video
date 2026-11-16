// Engine
export { getMediaEngine, initializeMediaEngine } from "./mediabunny-engine";

// FFmpeg Fallback
export { FFmpegFallback, getFFmpegFallback } from "./ffmpeg-fallback";

// Native media bridge (desktop) + shared audio-extract helper
export {
  nativeMediaAvailable,
  proxyViaNative,
  probeAudioStreamCountViaNative,
} from "./native-media-bridge";
export { extractAudioWav } from "./extract-audio";
export {
  classifyProMedia,
  isCameraRawName,
  proMediaProxyNotice,
  proMediaWebMessage,
  PRO_MEDIA_PROXY_PREFIX,
} from "./pro-media";
export type { ProMediaInfo, ProMediaKind } from "./pro-media";
export {
  decodeAudioBufferStreaming,
  type StreamingAudioDecodeResult,
} from "./decode-audio-streaming";

// Media Import Service
export {
  MediaImportService,
  initializeMediaImportService,
  CODEC_UNSUPPORTED_WARNING,
} from "./media-import-service";

// Waveform Generator
export { WaveformGenerator, getWaveformGenerator } from "./waveform-generator";

export type {
  ProcessedMedia,
  MediaTrackInfo,
  WaveformData,
  ExportProgress,
} from "./types";

// Scene detection
export {
  detectScenes,
  findCuts,
  computeFrameSignature,
  signatureDistance,
  sensitivityToThresholds,
  buildSceneRanges,
  createAbortError,
} from "./scene-detection";
export type {
  FrameLike,
  FrameSampler,
  SceneCut,
  SceneRange,
  SceneDetectionOptions,
  SceneDetectionProgress,
  SceneDetectionResult,
  FrameSignature,
} from "./scene-detection";

// Seek anchors (low-res frame index for instant click-seek)
export {
  planAnchorTimes,
  sampleSeekAnchors,
  DEFAULT_MAX_ANCHORS,
  DEFAULT_MIN_SPACING,
} from "./seek-anchor-sampler";
export type {
  SeekAnchor,
  SeekAnchorPlanOptions,
  SampleSeekAnchorsOptions,
  SampleSeekAnchorsResult,
} from "./seek-anchor-sampler";

// Native (desktop) decode for codecs WebCodecs cannot play
export {
  registerNativeFrameProvider,
  hasNativeFrameProvider,
  claimNativeSource,
  probeFootageShape,
  getNativeFrameCodes,
  isNativeContainerName,
  isNativeContainerFile,
  NativeCanvasSink,
  NativeExportFrameDecoder,
} from "./native-frame-source";
export type {
  NativeFrameProvider,
  FootageShapeProbe,
  NativeSourceInfo,
  NativeFrame,
  NativeFrameRequest,
  NativeFrameQuality,
  ExportFrameDecoderLike,
} from "./native-frame-source";
