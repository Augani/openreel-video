import { DOLBY_VIDEO_DESKTOP_ONLY_REASON, dolbyContainerProblem, isDolbyFormat } from "./dolby";
import { browserAudioCodec } from "./browser-audio-codec";
import { CODEC_MAP, type VideoExportSettings } from "./types";
import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import { getCompoundClipId } from "../timeline/timeline-items";
import { broadcastDeliveryProblem, isBroadcastCodec } from "./broadcast";

type MediaBunnyModule = typeof import("mediabunny");

interface BrowserExportCapability {
  supported: boolean;
  reason: string | null;
  audioCodec?: string;
}

export function getVideoExportValidationError(settings: VideoExportSettings, duration: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0) return "Add a clip, text, or graphics to the timeline before exporting.";
  if (![settings.width, settings.height].every((value) => Number.isInteger(value) && value > 0)) return "Choose a valid width and height for your video.";
  if (!Number.isFinite(settings.frameRate) || settings.frameRate <= 0) return "Choose a valid frame rate for your video.";
  // ProRes and DNxHR rates come from the profile, not a target bitrate.
  const profileRated = settings.codec === "prores" || settings.codec === "dnxhr" || isBroadcastCodec(settings.codec);
  if (!profileRated && (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0)) return "Choose a valid video bitrate.";
  if (settings.maxBitrate !== undefined) {
    if (!Number.isFinite(settings.maxBitrate) || settings.maxBitrate <= 0) return "Choose a valid maximum bitrate.";
    if (!profileRated && settings.maxBitrate < settings.bitrate) return "The maximum bitrate cannot be lower than the target bitrate.";
  }
  if (isDolbyFormat(settings.audioSettings?.format)) {
    const dolbyProblem = dolbyContainerProblem(settings.format);
    if (dolbyProblem) return dolbyProblem;
  }
  return broadcastDeliveryProblem(settings);
}

/**
 * Check the originals, even when preview playback uses a proxy. A nest / compound clip points at a
 * sequence (`compound:<id>`), not at a media item: its own media is whatever the sequence holds,
 * so it is followed (recursively) instead of being reported as missing.
 */
export function getMissingExportMedia(project: Project, range?: VideoExportSettings["range"]): string[] {
  const definitions = new Map((project.compoundClips ?? []).map((definition) => [definition.id, definition]));
  const referenced = new Set<string>();
  const visited = new Set<string>();
  const collect = (clips: ReadonlyArray<{ mediaId: string; metadata?: unknown }>): void => {
    for (const clip of clips) {
      const compoundId = getCompoundClipId(clip as Pick<Clip, "mediaId" | "metadata">);
      if (compoundId === null) {
        referenced.add(clip.mediaId);
        continue;
      }
      if (visited.has(compoundId)) continue;
      visited.add(compoundId);
      const content = definitions.get(compoundId)?.content;
      // An unknown definition cannot be checked here; the renderer reports it.
      if (!content) continue;
      collect([...(content.clips ?? []), ...(content.tracks ?? []).flatMap((track) => track.clips)]);
    }
  };
  collect(project.timeline.tracks.flatMap((track) => track.clips
    .filter((clip) => !range || (clip.startTime < range.endTime && clip.startTime + clip.duration > range.startTime))));
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
  if (settings.codec === "prores" || settings.codec === "dnxhr" || isBroadcastCodec(settings.codec) || settings.format === "mxf" || (settings.colorDepth ?? 8) > 8 || (settings.pixelFormat && settings.pixelFormat !== "yuv420")) {
    return { supported: false, reason: "ProRes, DNxHR, XDCAM HD422, AVC-Intra, MXF, timecode tracks, transparency, and high bit depth export require the desktop encoder. Choose H.264 for browser export." };
  }
  if (settings.format === "mkv") return { supported: false, reason: "MKV export needs the desktop app. Choose MP4, MOV or WebM." };
  if (isDolbyFormat(settings.audioSettings?.format)) return { supported: false, reason: DOLBY_VIDEO_DESKTOP_ONLY_REASON };
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
    const audioCodec = await browserAudioCodec(library, settings, format.getSupportedAudioCodecs());
    if (!audioCodec) return { supported: false, reason: `This browser cannot encode audio for ${settings.format.toUpperCase()}. Try WebM with Opus audio or another browser.` };
    return { supported: true, reason: null, audioCodec: audioCodec.codec };
  } catch (error) {
    return { supported: false, reason: `Could not check browser export support: ${error instanceof Error ? error.message : "encoder unavailable"}` };
  }
}
