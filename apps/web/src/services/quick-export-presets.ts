import { readBwfPrefs } from "./export-bwf-prefs";
import type { AudioExportSettings, VideoExportSettings } from "@openreel/core";

export type QuickExportPresetId = "mp4" | "4k" | "1080p-high" | "1080p-60" | "wav" | "bwf" | "ac3" | "eac3";
export type QuickVideoExportSettings = Pick<VideoExportSettings, "width" | "height" | "frameRate" | "format" | "codec"> & Partial<VideoExportSettings>;

type QuickExportPreset = {
  id: QuickExportPresetId;
  label: string;
  description: string;
} & (
  | { kind: "video"; settings: QuickVideoExportSettings }
  | { kind: "audio"; settings: Partial<AudioExportSettings>; /** File extension the save dialog offers. */ extension: "wav" | "ac3" | "ec3" }
);

/** The retained quick exports always cover the entire timeline. */
export function getQuickExportPresets(project: {
  width: number;
  height: number;
  frameRate: number;
}): QuickExportPreset[] {
  return [
    {
      id: "mp4", label: "MP4 Standard", kind: "video",
      description: `${project.width}×${project.height} · ${project.frameRate} fps · H.264`,
      settings: { width: project.width, height: project.height, frameRate: project.frameRate, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 },
    },
    ...(project.width / project.height < 0.9 ? [] : [{
      id: "4k" as const, label: "4K Standard", kind: "video" as const,
      description: "3840×2160 · 30 fps · H.264",
      settings: { width: 3840, height: 2160, frameRate: 30, format: "mp4" as const, codec: "h264" as const, bitrate: 50000, quality: 90 },
    }]),
    {
      id: "1080p-high", label: "1080p High Quality", kind: "video",
      description: "1920×1080 · 30 fps · 20 Mbps",
      settings: { width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000, quality: 95 },
    },
    {
      id: "1080p-60", label: "1080p 60fps", kind: "video",
      description: "1920×1080 · 60 fps · 25 Mbps",
      settings: { width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 25000, quality: 95 },
    },
    {
      id: "wav", label: "Audio Only (WAV)", kind: "audio",
      description: "48 kHz · stereo · 24-bit PCM",
      settings: { format: "wav", sampleRate: 48000, channels: 2, bitDepth: 24 },
      extension: "wav",
    },
    {
      id: "bwf", label: "Audio Only (Broadcast WAV)", kind: "audio",
      description: "48 kHz · stereo · 24-bit PCM · bext time reference and iXML track names",
      settings: bwfSettings(),
      extension: "wav",
    },
    {
      id: "ac3", label: "Audio Only (Dolby Digital)", kind: "audio",
      description: "48 kHz · .ac3 · stereo 192 kbps, or 5.1 at 448 kbps for a 5.1 sequence",
      settings: { format: "ac3", sampleRate: 48000, channels: 2, bitDepth: 24, bitrate: 192 },
      extension: "ac3",
    },
    {
      id: "eac3", label: "Audio Only (Dolby Digital Plus)", kind: "audio",
      description: "48 kHz · .ec3 · stereo 256 kbps, or 5.1 at 640 kbps for a 5.1 sequence",
      settings: { format: "eac3", sampleRate: 48000, channels: 2, bitDepth: 24, bitrate: 256 },
      extension: "ec3",
    },
  ];
}

/** Description and originator come from the export dialog's Broadcast WAV fields; empty ones fall back to the defaults. */
function bwfSettings(): Partial<AudioExportSettings> {
  const prefs = readBwfPrefs();
  const description = prefs.description.trim();
  const originator = prefs.originator.trim();
  return {
    format: "wav", sampleRate: 48000, channels: 2, bitDepth: 24,
    bwf: { enabled: true, ...(description ? { description } : {}), ...(originator ? { originator } : {}) },
  };
}
