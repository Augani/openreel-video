export * from "./types";
export * from "./utils";
export * from "./actions";
export * from "./capabilities";
export * from "./storage";
export * from "./timeline";
export * from "./media";
export * from "./video";
export * from "./audio";
export * from "./playback";
export * from "./text";
export * from "./graphics";
export * from "./photo";
export * from "./editing-templates";
export * from "./template";
export * from "./motion";
export * from "./ai";
export * from "./animation";
export * from "./effects";
export * from "./device";
export {
  ExportEngine,
  getExportEngine,
  initializeExportEngine,
  downloadBlob,
  setEncoderBackendFactory,
  exportSettingsRequireNativeEncoder,
} from "./export/export-engine";

export type {
  EncoderBackend,
  EncoderBackendFactory,
} from "./export/encoder-backend";

export {
  WebCodecsBackend,
  type WebCodecsBackendOptions,
} from "./export/webcodecs-backend";

export type {
  VideoExportSettings,
  AudioExportSettings,
  ImageExportSettings,
  SequenceExportSettings,
  ExportProgress as VideoExportProgressInfo,
  ExportPreset,
  ExportResult,
  ExportStats,
  ExportError,
  ExportErrorCode,
  UpscalingSettings,
  UpscaleQuality,
} from "./export/types";

export {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
  CODEC_MAP,
  DEFAULT_UPSCALING_SETTINGS,
} from "./export/types";

export type {
  CompressionQuality,
  CompressionTarget,
  CompressionSource,
  CompressionPlan,
  SizePreset,
} from "./export/compression";

export {
  computeCompressionPlan,
  estimateCompressedBytes,
  compressionPlanToExportSettings,
  COMPRESSION_SIZE_PRESETS,
} from "./export/compression";
