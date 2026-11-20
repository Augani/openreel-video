import type { LoudnessTargetSettings } from "../audio/loudness/loudness-normalizer";
import type { LoudnessExportReport } from "./loudness-export";
import type { ProxyExportReport } from "../media/proxy-workflow";
import type { CaptionExportSettings } from "../captions/caption-export";
import type { TimecodeBurnInSettings } from "../video/burn-in";
import type { BroadcastCodec, BroadcastDeliverySettings } from "./broadcast";
export type UpscaleQuality = "fast" | "balanced" | "quality";

export interface UpscalingSettings {
  enabled: boolean;
  quality: UpscaleQuality;
  sharpening: number;
}

/** DNxHR flavours: LB (proxy), SQ, HQ (8-bit 4:2:2), HQX (10-bit 4:2:2), 444 (10-bit 4:4:4). */
export type DnxhrProfile = "lb" | "sq" | "hq" | "hqx" | "444";

/** HDR transfer function of the exported file. `none` (or absent) is SDR. */
export type HdrTransfer = "none" | "pq" | "hlg";

export type BitrateMode = "cbr" | "vbr" | "vbr1" | "vbr2";
export type RateControl = "quality" | "vbr" | "vbr2";

/** The rate control a settings object asks for: an explicit `rateControl`, else the one `bitrateMode` names, else constant quality. */
export function effectiveRateControl(settings: { rateControl?: RateControl; bitrateMode?: BitrateMode }): RateControl {
  if (settings.rateControl) return settings.rateControl;
  if (settings.bitrateMode === "vbr2") return "vbr2";
  if (settings.bitrateMode === "vbr1") return "vbr";
  return "quality";
}

export interface VideoExportSettings {
  /** "mkv" (Matroska) is desktop only; it carries H.264 / H.265 / AV1 / VP9 with AAC, Opus or Dolby Digital audio. */
  format: "mp4" | "webm" | "mov" | "mxf" | "mkv";
  codec: "h264" | "h265" | "vp8" | "vp9" | "av1" | "prores" | "dnxhr" | BroadcastCodec;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  /** DNxHR flavour (codec "dnxhr", MOV or MXF, desktop only). HQ when omitted. */
  dnxhrProfile?: DnxhrProfile;
  /**
   * Broadcast delivery (desktop only): XDCAM HD422 / AVC-Intra 100 scan, MXF OP-Atom, mono audio
   * tracks and the file's start timecode. Absent = none of it.
   */
  broadcast?: BroadcastDeliverySettings;
  /**
   * ProRes 4444 / 4444 XQ: export over a transparent background and write the alpha channel
   * (yuva444p10le). Desktop only; ignored by every other codec.
   */
  alpha?: boolean;
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  /**
   * Preset-level bitrate mode. "cbr" / "vbr" are the legacy values (the browser maps them to WebCodecs
   * constant / variable). "vbr1" is one-pass VBR and "vbr2" two-pass VBR; they imply `rateControl`
   * "vbr" / "vbr2" when that is absent (see `effectiveRateControl`).
   */
  bitrateMode: BitrateMode;
  /**
   * Rate control. "quality" (default) is constant quality (CRF) on the desktop software encoders and
   * ignores `bitrate`; "vbr" is one-pass variable bitrate that averages `bitrate` kbps with peaks held
   * under `maxBitrate` (kbps, default 1.5x the target). The desktop ffmpeg path applies both; the
   * browser WebCodecs path applies the target only (its encoder takes no peak cap). "vbr2" is true
   * two-pass VBR and exists on the desktop app only, for H.264 / H.265 (libx264 / libx265): pass 1 analyses
   * the frames (and keeps them losslessly), pass 2 encodes to the target. The browser has no real two-pass
   * (frames are streamed to WebCodecs once), so the export dialog disables it there.
   */
  rateControl?: RateControl;
  maxBitrate?: number;
  encodeMode?: "fast" | "balanced" | "smallest";
  /** Encoder picker: Auto (hardware when it works), Hardware (never falls back) or Software. Absent = Auto. */
  encoderChoice?: "auto" | "hardware" | "software";
  quality: number;
  keyframeInterval: number;
  audioSettings: AudioExportSettings;
  colorDepth?: 8 | 10 | 12;
  /**
   * HDR output on the browser (WebCodecs) path: BT.2020 primaries with a PQ or
   * HLG transfer, 10-bit HEVC, tagged in the container. Needs MP4/MOV + H.265
   * and a browser with a 10-bit HEVC encoder. Absent or "none" is SDR.
   */
  hdr?: HdrTransfer;
  pixelFormat?: "yuv420" | "yuv422" | "yuv444" | "rgb";
  upscaling?: UpscalingSettings;
  /** Timeline seconds; the Out point is exclusive. Omit to export everything. */
  range?: { startTime: number; endTime: number };
  /**
   * Stream-copy untouched runs of the sources instead of re-encoding them
   * (MP4/MOV; H.264 on the WebCodecs backend, H.264/HEVC/ProRes on the desktop
   * native ffmpeg backend). On unless explicitly false.
   */
  smartRender?: boolean;
  /**
   * Per caption track: burn into the picture, sidecar format, embedded subtitle
   * track. Omitted = every caption is burned in and nothing else is written.
   */
  captions?: CaptionExportSettings;
  /**
   * One-click "Burn in timecode": the sequence timecode (or the topmost clip's source timecode) is drawn into
   * every exported frame, over all tracks and captions. Frames are always re-rendered (no stream copy).
   */
  burnInTimecode?: TimecodeBurnInSettings;
}

export interface AudioExportSettings {
  /**
   * "ac3" / "eac3" are Dolby Digital / Dolby Digital Plus (stereo or 5.1, see ./dolby). As the audio-only format
   * they write a raw `.ac3` / `.ec3` stream; as a video export's audio format they are the audio track of an
   * MP4, MOV or MKV (desktop only).
   */
  format: "mp3" | "wav" | "aac" | "flac" | "ogg" | "ac3" | "eac3";
  sampleRate: 44100 | 48000 | 96000;
  bitDepth: 16 | 24 | 32;
  bitrate: number;
  channels: 1 | 2 | 6;
  /**
   * Channel layout of the delivered audio. Omitted = follow the sequence (a 5.1
   * sequence exports 6 channels, a stereo one is unchanged). "stereo" on a 5.1
   * sequence downmixes with the ITU-R BS.775 coefficients.
   */
  channelLayout?: "stereo" | "5.1";
  /**
   * Loudness-targeted delivery: measure the mixdown, apply the gain that lands
   * on `targetLufs` and keep true peaks under the ceiling. Omitted = off.
   */
  loudness?: LoudnessTargetSettings;
  /**
   * AC-3 / E-AC-3 only: dialogue-normalisation metadata in dB, -31 (default, the decoder leaves the level alone)
   * to -1. Omitted = the loudness target when loudness normalisation is on, else -31.
   */
  dialnorm?: number;
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
  /** Present when loudness normalization ran. */
  loudness?: LoudnessExportReport;
  /**
   * HDR10 (PQ) exports rendered in the float HDR working mode: MaxCLL and MaxFALL measured from the frames that
   * were encoded, in nits. The container declares its own values (see docs/colour-management.md).
   */
  hdrLightLevel?: { maxCll: number; maxFall: number; frames: number };
  /** Frames served from the preview render cache instead of being re-rendered. */
  framesFromCache?: number;
  /** Present when a smart-render plan ran (copied or not). */
  smartRender?: SmartRenderReport;
  /** States which media the export read: always the full-resolution originals, never proxies. */
  sourceMedia?: ProxyExportReport;
  /** Caption tracks embedded in the file, and why any requested track was not. */
  embeddedCaptions?: { tracks: number; warnings: string[] };
}

/** What smart rendering did, for the export report and queue job. */
export interface SmartRenderReport {
  /** True when at least one run was stream-copied. */
  active: boolean;
  /** Which muxer spliced the runs (absent on reports from before the native engine existed). */
  engine?: "webcodecs" | "native";
  copiedFrames: number;
  totalFrames: number;
  /** 0..100 */
  copiedPercent: number;
  /** Number of stream-copied runs. */
  copiedRuns: number;
  /** Human-readable reasons nothing (or less) could be copied. */
  reasons: string[];
  /** "Smart render: 62% copied" */
  summary: string;
}

/** Cached preview frames an export may reuse (see the render cache). */
export interface ExportFrameSource {
  /**
   * Decoded cached frame at project time `time` at the export resolution, or
   * undefined when the frame must be rendered. The caller owns the bitmap.
   */
  takeFrame(time: number): Promise<ImageBitmap | undefined>;
}

export interface ExportVideoOptions {
  cachedFrames?: ExportFrameSource;
  /**
   * Per-run encoder preference for the browser (WebCodecs) backend, used by the queue's automatic re-run after a
   * hardware session failed. Only takes effect when the export's encoderChoice is auto/undefined; scoped to this
   * run, never stored globally.
   */
  encoderPreference?: "prefer-hardware" | "prefer-software";
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

export const CODEC_MAP = {
  h264: "avc",
  h265: "hevc",
  vp8: "vp8",
  vp9: "vp9",
  av1: "av1",
  prores: "prores",
} as const;

/**
 * Whether two-pass VBR is real for these settings. It is true two-pass (ffmpeg -pass 1 / -pass 2) on
 * the desktop app's libx264 / libx265 only; the browser streams frames to WebCodecs once and cannot do it.
 */
export function twoPassAvailability(
  native: boolean,
  settings: { codec: VideoExportSettings["codec"]; hdr?: VideoExportSettings["hdr"] },
  /** The project's working colour space: a Rec.2020 project is colour-managed even for SDR output. */
  workingColorSpace?: "rec709" | "rec2020",
): { available: true } | { available: false; reason: string } {
  if (!native) return { available: false, reason: "needs the desktop app (the browser encoder takes frames once)" };
  if (settings.codec !== "h264" && settings.codec !== "h265") return { available: false, reason: "H.264 and H.265 only" };
  if (settings.hdr && settings.hdr !== "none") return { available: false, reason: "not available with HDR output" };
  if (workingColorSpace === "rec2020") return { available: false, reason: "not available with a Rec.2020 sequence (colour-managed output)" };
  return { available: true };
}

/** ProRes 4444 / 4444 XQ with the alpha option on: the render keeps transparency and the file carries it. */
export function exportWritesAlpha(settings: Pick<VideoExportSettings, "codec" | "proresProfile" | "alpha">): boolean {
  return settings.codec === "prores" && settings.alpha === true && (settings.proresProfile === "4444" || settings.proresProfile === "4444xq");
}
