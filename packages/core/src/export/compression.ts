import type { VideoExportSettings } from "./types";

export type CompressionQuality = "light" | "balanced" | "strong";

export type CompressionTarget =
  | { mode: "quality"; quality: CompressionQuality }
  | { mode: "size"; targetBytes: number };

export interface CompressionSource {
  durationSec: number;
  width: number;
  height: number;
  frameRate?: number;
  hasAudio: boolean;
}

export interface CompressionPlan {
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  frameRate: number;
  codec: "h264";
  container: "mp4";
}

export interface SizePreset {
  id: string;
  label: string;
  bytes: number;
}

const MB = 1024 * 1024;

export const COMPRESSION_SIZE_PRESETS: readonly SizePreset[] = [
  { id: "email", label: "Email (25 MB)", bytes: 25 * MB },
  { id: "whatsapp", label: "WhatsApp (16 MB)", bytes: 16 * MB },
  { id: "discord", label: "Discord (10 MB)", bytes: 10 * MB },
];

const CONTAINER_OVERHEAD = 1.02;
const MIN_VIDEO_KBPS = 150;
const MIN_AUDIO_KBPS = 48;
const MAX_AUDIO_KBPS = 160;
const BITRATE_FLOOR_BPP = 0.035;

interface QualityProfile {
  maxLongEdge: number;
  bpp: number;
  audioKbps: number;
}

const QUALITY_PROFILES: Record<CompressionQuality, QualityProfile> = {
  light: { maxLongEdge: 1920, bpp: 0.11, audioKbps: 160 },
  balanced: { maxLongEdge: 1280, bpp: 0.075, audioKbps: 128 },
  strong: { maxLongEdge: 854, bpp: 0.05, audioKbps: 96 },
};

const RESOLUTION_TIERS = [3840, 2560, 1920, 1280, 960, 854, 640];

function evenRound(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function fitWithin(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxLongEdge ? maxLongEdge / longest : 1;
  return {
    width: Math.max(2, evenRound(width * scale)),
    height: Math.max(2, evenRound(height * scale)),
  };
}

function resolveFrameRate(frameRate?: number): number {
  return frameRate && frameRate > 0 ? Math.min(frameRate, 60) : 30;
}

function videoKbpsFor(
  width: number,
  height: number,
  frameRate: number,
  bpp: number,
): number {
  return Math.round((width * height * frameRate * bpp) / 1000);
}

/**
 * Produce an encode plan (resolution + bitrates, all kbps) that shrinks
 * `source` to the requested quality tier or an exact target byte size.
 */
export function computeCompressionPlan(
  source: CompressionSource,
  target: CompressionTarget,
): CompressionPlan {
  const frameRate = resolveFrameRate(source.frameRate);
  const srcWidth = Math.max(2, Math.round(source.width));
  const srcHeight = Math.max(2, Math.round(source.height));

  if (target.mode === "quality") {
    const profile = QUALITY_PROFILES[target.quality];
    const { width, height } = fitWithin(
      srcWidth,
      srcHeight,
      profile.maxLongEdge,
    );
    return {
      width,
      height,
      videoBitrateKbps: Math.max(
        MIN_VIDEO_KBPS,
        videoKbpsFor(width, height, frameRate, profile.bpp),
      ),
      audioBitrateKbps: source.hasAudio ? profile.audioKbps : 0,
      frameRate,
      codec: "h264",
      container: "mp4",
    };
  }

  const durationSec = Math.max(0.1, source.durationSec);
  const totalKbps = (target.targetBytes * 8) / durationSec / 1000;
  const audioBitrateKbps = source.hasAudio
    ? Math.round(
        Math.min(MAX_AUDIO_KBPS, Math.max(MIN_AUDIO_KBPS, totalKbps * 0.15)),
      )
    : 0;
  const videoBitrateKbps = Math.max(
    MIN_VIDEO_KBPS,
    Math.round(totalKbps / CONTAINER_OVERHEAD - audioBitrateKbps),
  );

  const longest = Math.max(srcWidth, srcHeight);
  let resolution = fitWithin(srcWidth, srcHeight, longest);
  for (const tier of RESOLUTION_TIERS) {
    if (tier > longest) continue;
    resolution = fitWithin(srcWidth, srcHeight, tier);
    const bpp =
      (videoBitrateKbps * 1000) /
      (resolution.width * resolution.height * frameRate);
    if (bpp >= BITRATE_FLOOR_BPP) break;
  }

  return {
    width: resolution.width,
    height: resolution.height,
    videoBitrateKbps,
    audioBitrateKbps,
    frameRate,
    codec: "h264",
    container: "mp4",
  };
}

/** Estimated output size in bytes for a plan over `durationSec` seconds. */
export function estimateCompressedBytes(
  plan: CompressionPlan,
  durationSec: number,
): number {
  const durationGuard = Math.max(0.1, durationSec);
  const totalKbps = plan.videoBitrateKbps + plan.audioBitrateKbps;
  return Math.round(
    ((totalKbps * 1000) / 8) * durationGuard * CONTAINER_OVERHEAD,
  );
}

/** Map a compression plan onto the editor's VideoExportSettings shape. */
export function compressionPlanToExportSettings(
  plan: CompressionPlan,
): VideoExportSettings {
  return {
    format: "mp4",
    codec: "h264",
    width: plan.width,
    height: plan.height,
    frameRate: plan.frameRate,
    bitrate: plan.videoBitrateKbps,
    bitrateMode: "vbr",
    encodeMode: "smallest",
    quality: 75,
    keyframeInterval: Math.max(1, Math.round(plan.frameRate * 2)),
    audioSettings: {
      format: "aac",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: plan.audioBitrateKbps,
      channels: 2,
    },
  };
}
