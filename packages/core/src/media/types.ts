import type { SourceColorSpace } from "../color/source-color";
import type { VrProperties } from "../vr/vr-properties";
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
  /** Video-specific capability; audio decode support must not validate a proxy. */
  canDecodeVideo?: boolean;
  videoBitrate?: number;
  audioBitrate?: number;
  /** Number of audio tracks in the file (may be > 1 for multi-track video/audio files) */
  audioTrackCount?: number;
  /** Channels of each audio track, in track order (a file may mix mono and stereo tracks); `channels` is the first / widest. */
  audioStreamChannels?: readonly number[];
  /** Colour space the video track's container tags declare; absent when untagged. */
  sourceColor?: SourceColorSpace;
  /** Immersive video detected in the file: spherical metadata (`source: "metadata"`) or a 2:1 picture (`source: "aspect"`, a hint only). */
  vr?: VrProperties;
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
  /** Maximum seconds between video keyframes (short intervals improve seeking). */
  keyFrameInterval?: number;
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
