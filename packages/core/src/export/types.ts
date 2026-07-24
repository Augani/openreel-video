export type UpscaleQuality = "fast" | "balanced" | "quality";

export interface UpscalingSettings {
  enabled: boolean;
  quality: UpscaleQuality;
  sharpening: number;
}

export const DEFAULT_UPSCALING_SETTINGS: UpscalingSettings = {
  enabled: false,
  quality: "balanced",
  sharpening: 0.3,
};

export interface VideoExportSettings {
  format: "mp4" | "webm" | "mov";
  codec: "h264" | "h265" | "vp8" | "vp9" | "av1" | "prores";
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  bitrateMode: "cbr" | "vbr";
  encodeMode?: "fast" | "balanced" | "smallest";
  quality: number;
  keyframeInterval: number;
  audioSettings: AudioExportSettings;
  colorDepth?: 8 | 10 | 12;
  pixelFormat?: "yuv420" | "yuv422" | "yuv444" | "rgb";
  upscaling?: UpscalingSettings;
}

export interface AudioExportSettings {
  format: "mp3" | "wav" | "aac" | "flac" | "ogg";
  sampleRate: 44100 | 48000 | 96000;
  bitDepth: 16 | 24 | 32;
  bitrate: number;
  channels: 1 | 2;
}

export interface ImageExportSettings {
  format: "jpg" | "png" | "webp";
  quality: number;
  width: number;
  height: number;
}

export interface SequenceExportSettings extends ImageExportSettings {
  startFrame: number;
  endFrame: number;
  namingPattern: string;
}

export interface ExportProgress {
  readonly phase:
    | "preparing"
    | "rendering"
    | "encoding"
    | "muxing"
    | "complete";
  readonly progress: number;
  readonly estimatedTimeRemaining: number;
  readonly currentFrame: number;
  readonly totalFrames: number;
  readonly bytesWritten: number;
  readonly currentBitrate: number;
}

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  settings: VideoExportSettings | AudioExportSettings | ImageExportSettings;
  category: "social" | "broadcast" | "web" | "archive" | "custom";
}

export interface ExportError {
  code: ExportErrorCode;
  message: string;
  phase: ExportProgress["phase"];
  frameNumber?: number;
  recoverable: boolean;
}

export type ExportErrorCode =
  | "ENCODER_INIT_FAILED"
  | "FRAME_ENCODE_FAILED"
  | "AUDIO_ENCODE_FAILED"
  | "MUXER_ERROR"
  | "DISK_FULL"
  | "CANCELLED"
  | "TIMEOUT"
  | "MEMORY_EXCEEDED"
  | "UNSUPPORTED_CODEC"
  | "INVALID_SETTINGS";

export interface ExportResult {
  success: boolean;
  blob?: Blob;
  error?: ExportError;
  stats?: ExportStats;
}

export interface ExportStats {
  duration: number;
  framesRendered: number;
  averageSpeed: number;
  fileSize: number;
  averageBitrate: number;
}

export const DEFAULT_VIDEO_SETTINGS: VideoExportSettings = {
  format: "mp4",
  codec: "h264",
  width: 1920,
  height: 1080,
  frameRate: 30,
  bitrate: 5000, // 5 Mbps - good quality for 1080p web video
  bitrateMode: "cbr",
  encodeMode: "balanced",
  quality: 80,
  keyframeInterval: 60, // 2 seconds at 30fps
  audioSettings: {
    format: "aac",
    sampleRate: 48000,
    bitDepth: 16,
    bitrate: 192,
    channels: 2,
  },
};

export const DEFAULT_AUDIO_SETTINGS: AudioExportSettings = {
  format: "mp3",
  sampleRate: 48000,
  bitDepth: 16,
  bitrate: 320,
  channels: 2,
};

export const DEFAULT_IMAGE_SETTINGS: ImageExportSettings = {
  format: "jpg",
  quality: 90,
  width: 1920,
  height: 1080,
};

export const VIDEO_QUALITY_PRESETS = {
  "4k-high": {
    width: 3840,
    height: 2160,
    bitrate: 80000,
    frameRate: 30,
    quality: 95,
  },
  "4k": {
    width: 3840,
    height: 2160,
    bitrate: 50000,
    frameRate: 30,
    quality: 90,
  },
  "4k-60": {
    width: 3840,
    height: 2160,
    bitrate: 65000,
    frameRate: 60,
    quality: 90,
  },
  "1080p-high": {
    width: 1920,
    height: 1080,
    bitrate: 25000,
    frameRate: 30,
    quality: 95,
  },
  "1080p": {
    width: 1920,
    height: 1080,
    bitrate: 15000,
    frameRate: 30,
    quality: 85,
  },
  "1080p-60": {
    width: 1920,
    height: 1080,
    bitrate: 24000,
    frameRate: 60,
    quality: 90,
  },
  "720p": {
    width: 1280,
    height: 720,
    bitrate: 8000,
    frameRate: 30,
    quality: 80,
  },
  "480p": {
    width: 854,
    height: 480,
    bitrate: 4000,
    frameRate: 30,
    quality: 75,
  },
} as const;

export const PRORES_BITRATES = {
  proxy: { "1080p": 45000, "4k": 180000 },
  lt: { "1080p": 100000, "4k": 400000 },
  standard: { "1080p": 150000, "4k": 600000 },
  hq: { "1080p": 220000, "4k": 880000 },
  "4444": { "1080p": 330000, "4k": 1320000 },
  "4444xq": { "1080p": 500000, "4k": 2000000 },
} as const;

export const CODEC_MAP = {
  h264: "avc",
  h265: "hevc",
  vp8: "vp8",
  vp9: "vp9",
  av1: "av1",
  prores: "prores",
} as const;
