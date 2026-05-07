export interface ProcessedMedia {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  blob: Blob;
  metadata: MediaTrackInfo;
  thumbnails: ThumbnailResult[];
  waveformData: WaveformData | null;
}

export interface MediaTrackInfo {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  sampleRate: number;
  channels: number;
  fileSize: number;
  mimeType: string;
  hasVideo: boolean;
  hasAudio: boolean;
  rotation: number;
  canDecode: boolean;
  videoBitrate?: number;
  audioBitrate?: number;
  /** Number of audio tracks in the file (may be > 1 for multi-track video/audio files) */
  audioTrackCount?: number;
}

export interface ThumbnailResult {
  timestamp: number;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  dataUrl?: string;
}

export interface VideoFrameResult {
  timestamp: number;
  duration: number;
  canvas: OffscreenCanvas | HTMLCanvasElement | ImageBitmap;
  width: number;
  height: number;
}

export interface WaveformData {
  peaks: Float32Array;
  rms: Float32Array;
  sampleRate: number;
  duration: number;
  samplesPerSecond: number;
}

export interface ExportSettings {
  format: "mp4" | "webm" | "mov" | "mp3" | "wav" | "aac";
  width?: number;
  height?: number;
  frameRate?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  sampleRate?: number;
  channels?: number;
  videoCodec?: "avc" | "hevc" | "vp9" | "av1";
  audioCodec?: "aac" | "opus" | "mp3";
  quality?: "low" | "medium" | "high" | "very-high";
}

export interface ExportProgress {
  phase: "preparing" | "rendering" | "encoding" | "muxing" | "complete";
  progress: number;
  currentFrame: number;
  totalFrames: number;
  estimatedTimeRemaining: number;
}

export const QUALITY_PRESETS = {
  "4k": { width: 3840, height: 2160, videoBitrate: 35_000_000 },
  "1080p": { width: 1920, height: 1080, videoBitrate: 8_000_000 },
  "720p": { width: 1280, height: 720, videoBitrate: 5_000_000 },
  "480p": { width: 854, height: 480, videoBitrate: 2_500_000 },
} as const;

export const AUDIO_QUALITY_PRESETS = {
  high: { bitrate: 320_000, sampleRate: 48000 },
  medium: { bitrate: 192_000, sampleRate: 44100 },
  low: { bitrate: 128_000, sampleRate: 44100 },
} as const;

export interface FrameCacheEntry {
  timestamp: number;
  image: ImageBitmap | OffscreenCanvas;
  width: number;
  height: number;
  lastAccessed: number;
}

export interface WaveformCacheEntry {
  mediaId: string;
  data: WaveformData;
  createdAt: number;
}

export interface MediaImportResult {
  success: boolean;
  media?: ProcessedMedia;
  error?: string;
  warnings?: string[];
}

export type VideoCodec = "avc" | "hevc" | "vp8" | "vp9" | "av1";

export type AudioCodec = "aac" | "opus" | "mp3" | "flac" | "pcm";

export interface CodecSupport {
  decode: boolean;
  encode: boolean;
  hardwareAccelerated: boolean;
}
