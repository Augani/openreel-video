// Engine
export {
  MediaBunnyEngine,
  getMediaEngine,
  initializeMediaEngine,
  SUPPORTED_VIDEO_FORMATS,
  SUPPORTED_AUDIO_FORMATS,
  SUPPORTED_IMAGE_FORMATS,
  isSupportedFormat,
  inferMediaType,
} from "./mediabunny-engine";

// FFmpeg Fallback
export {
  FFmpegFallback,
  getFFmpegFallback,
  shouldUseProxy,
  getRecommendedProxyPreset,
  PROXY_PRESETS,
  PROXY_THRESHOLDS,
} from "./ffmpeg-fallback";
export type { ProxySettings, TranscodeOptions } from "./ffmpeg-fallback";

// Media Import Service
export {
  MediaImportService,
  getMediaImportService,
  initializeMediaImportService,
} from "./media-import-service";
export type { MediaImportOptions } from "./media-import-service";

// Waveform Generator
export {
  WaveformGenerator,
  getWaveformGenerator,
  createWaveformGenerator,
  WAVEFORM_RESOLUTIONS,
} from "./waveform-generator";
export type {
  WaveformGeneratorOptions,
  MultiResolutionWaveform,
} from "./waveform-generator";

// Waveform Renderer
export {
  WaveformRenderer,
  createWaveformImage,
  createClipWaveformThumbnail,
} from "./waveform-renderer";
export type {
  WaveformStyle,
  WaveformRenderOptions,
  AmplitudeInfo,
} from "./waveform-renderer";
export type {
  ProcessedMedia,
  MediaTrackInfo,
  ThumbnailResult,
  VideoFrameResult,
  WaveformData,
  ExportSettings,
  ExportProgress,
  FrameCacheEntry,
  WaveformCacheEntry,
  MediaImportResult,
  VideoCodec,
  AudioCodec,
  CodecSupport,
} from "./types";

export { QUALITY_PRESETS, AUDIO_QUALITY_PRESETS } from "./types";

export {
  decodeGif,
  createGifFrameCache,
  getGifFrameAtTime,
  isAnimatedGif,
} from "./gif-decoder";
export type { GifFrame, DecodedGif, GifFrameCache } from "./gif-decoder";
