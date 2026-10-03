import { CODEC_MAP, type VideoExportSettings } from "./types";
import type { Project } from "../types/project";

type MediaBunnyModule = typeof import("mediabunny");

export interface BrowserExportCapability {
  supported: boolean;
  reason: string | null;
  audioCodec?: string;
}

export function getVideoExportValidationError(settings: VideoExportSettings, duration: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0) return "Add a clip, text, or graphics to the timeline before exporting.";
  if (![settings.width, settings.height].every((value) => Number.isInteger(value) && value > 0)) return "Choose a valid width and height for your video.";
  if (!Number.isFinite(settings.frameRate) || settings.frameRate <= 0) return "Choose a valid frame rate for your video.";
  if (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0) return "Choose a valid video bitrate.";
  return null;
}

/** Check the originals, even when preview playback uses a proxy. */
export function getMissingExportMedia(project: Project): string[] {
  const referenced = new Set(project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.mediaId)));
  return [...referenced].flatMap((id) => {
    const item = project.mediaLibrary.items.find((candidate) => candidate.id === id);
    if (!item) return [id];
    if (["video", "audio", "image"].includes(item.type) && (!item.blob || item.isPlaceholder)) return [item.name || id];
    return [];
  });
}

/** Probe the selected codec and container, without silently changing the video codec. */
export async function checkBrowserExportCapability(
  settings: VideoExportSettings,
  mediaBunny?: MediaBunnyModule,
  includeAudio = true,
): Promise<BrowserExportCapability> {
  if (settings.codec === "prores" || (settings.colorDepth ?? 8) > 8 || (settings.pixelFormat && settings.pixelFormat !== "yuv420")) {
    return { supported: false, reason: "ProRes, transparency, and high bit depth export require the desktop encoder. Choose H.264 for browser export." };
  }
  try {
    const library = mediaBunny ?? await import("mediabunny");
    const format = settings.format === "webm" ? new library.WebMOutputFormat() : settings.format === "mov" ? new library.MovOutputFormat() : new library.Mp4OutputFormat();
    const codec = CODEC_MAP[settings.codec];
    if (!format.getSupportedVideoCodecs().includes(codec)) {
      return { supported: false, reason: `${settings.codec.toUpperCase()} cannot be exported in ${settings.format.toUpperCase()}. Choose VP9 for WebM or H.264 for MP4.` };
    }
    const video = await library.getFirstEncodableVideoCodec([codec], {
      width: settings.width, height: settings.height, bitrate: settings.bitrate * 1000,
    });
    if (video !== codec) return { supported: false, reason: `This browser cannot encode ${settings.codec.toUpperCase()} at ${settings.width}×${settings.height}. Try H.264 / MP4, VP9 / WebM, or a smaller resolution.` };
    if (!includeAudio) return { supported: true, reason: null };
    const audioCodec = await library.getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
      numberOfChannels: settings.audioSettings.channels,
      sampleRate: settings.audioSettings.sampleRate,
      bitrate: settings.audioSettings.bitrate * 1000,
    });
    if (!audioCodec) return { supported: false, reason: `This browser cannot encode audio for ${settings.format.toUpperCase()}. Try WebM with Opus audio or another browser.` };
    return { supported: true, reason: null, audioCodec };
  } catch (error) {
    return { supported: false, reason: `Could not check browser export support: ${error instanceof Error ? error.message : "encoder unavailable"}` };
  }
}
