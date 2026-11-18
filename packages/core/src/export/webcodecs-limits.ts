import type { VideoExportSettings } from "./types";

interface WebCodecsExportAdjustment {
  settings: VideoExportSettings;
  wasAdjusted: boolean;
  resolutionAdjusted: boolean;
  frameRateAdjusted: boolean;
}

/**
 * Applies the browser export safety limits without assuming a landscape frame.
 * The long and short edges are bounded independently so portrait exports retain
 * the same resolution class as equivalent landscape exports.
 */
export function resolveWebCodecsExportLimits(
  settings: VideoExportSettings,
  timelineDuration: number,
): WebCodecsExportAdjustment {
  const isMemoryIntensiveCodec =
    settings.codec === "vp9" ||
    settings.codec === "av1" ||
    settings.codec === "h265";
  const isLongVideo = timelineDuration > 120;
  const usesHdLimit = isMemoryIntensiveCodec || isLongVideo;
  const maxLongEdge = usesHdLimit ? 1920 : 3840;
  const maxShortEdge = usesHdLimit ? 1080 : 2160;
  const requestedLongEdge = Math.max(settings.width, settings.height);
  const requestedShortEdge = Math.min(settings.width, settings.height);
  const scale = Math.min(
    maxLongEdge / requestedLongEdge,
    maxShortEdge / requestedShortEdge,
    1,
  );

  const width = Math.max(2, Math.round((settings.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((settings.height * scale) / 2) * 2);
  const frameRate =
    isLongVideo && settings.frameRate > 30 ? 30 : settings.frameRate;
  const resolutionAdjusted =
    width !== settings.width || height !== settings.height;
  const frameRateAdjusted = frameRate !== settings.frameRate;

  return {
    settings: {
      ...settings,
      width,
      height,
      frameRate,
    },
    wasAdjusted: resolutionAdjusted || frameRateAdjusted,
    resolutionAdjusted,
    frameRateAdjusted,
  };
}
