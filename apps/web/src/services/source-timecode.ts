import { sourceTimecodeAt, timecodeToSeconds, type Clip, type MediaItem } from "@openreel/core";
import { pathOfBlob } from "./native-decode";

/** Containers that carry a start timecode track (QuickTime / MP4 family, MXF). */
const TIMECODE_CONTAINER = /\.(mov|mxf|mp4|m4v)$/i;

export interface SourceTimecodeMetadata {
  startTimecode?: number;
  startTimecodeText?: string;
}

/**
 * Desktop: the embedded start timecode of a MOV / MXF / MP4 file (read by the ffmpeg sidecar probe), as the media
 * metadata fields. Empty on the web build, for other containers and when the file has none.
 */
export async function sourceTimecodeMetadata(file: Blob): Promise<SourceTimecodeMetadata> {
  try {
    const bridge = typeof window === "undefined" ? undefined : window.openreel;
    if (bridge?.platform !== "desktop" || !bridge.media?.nativeProbe) return {};
    const name = (file as File).name ?? "";
    if (!TIMECODE_CONTAINER.test(name)) return {};
    const path = pathOfBlob(bridge, file);
    if (!path) return {};
    const probe = await bridge.media.nativeProbe({ path });
    if (!probe?.startTimecode) return {};
    const seconds = timecodeToSeconds(probe.startTimecode, probe.frameRate);
    if (seconds === null) return {};
    return { startTimecode: seconds, startTimecodeText: probe.startTimecode };
  } catch {
    return {};
  }
}

/**
 * "10:00:05:00 -> 10:00:09:12": the source timecode of a clip's In and Out, from its media's embedded start timecode.
 * Undefined when the media has none (or the clip is not file-backed).
 */
export function clipSourceTimecodeRange(
  media: Pick<MediaItem, "metadata"> | undefined,
  clip: Pick<Clip, "inPoint" | "outPoint">,
): string | undefined {
  const start = media?.metadata.startTimecode;
  const text = media?.metadata.startTimecodeText;
  if (!media || typeof start !== "number" || !text) return undefined;
  const fps = media.metadata.frameRate > 0 ? media.metadata.frameRate : 25;
  const drop = text.includes(";");
  return `${sourceTimecodeAt(start, clip.inPoint, fps, drop)} \u2192 ${sourceTimecodeAt(start, clip.outPoint, fps, drop)}`;
}
