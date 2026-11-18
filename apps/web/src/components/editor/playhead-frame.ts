import { createMediaImageBitmap, type Project } from "@openreel/core";
import { selectPreviewSource } from "./panels/effect-previews/source-selection";

/** Longest side of a decoded playhead frame: crisp for a 2x library card of any aspect, bounded for memory. */
export const PLAYHEAD_FRAME_MAX = 1280;

function containWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The real frame of the footage under the playhead, at the footage's own aspect (never cropped), as a canvas. The
 * same source choice the effect cards make (topmost under the playhead, else nearest). Null when the browser
 * cannot decode it (native-only codecs, missing blob): the caller keeps the media thumbnail then.
 */
export async function decodePlayheadFrame(
  project: Pick<Project, "timeline" | "mediaLibrary">,
  playhead: number,
  max: number = PLAYHEAD_FRAME_MAX,
): Promise<HTMLCanvasElement | null> {
  const source = selectPreviewSource({
    tracks: project.timeline.tracks,
    media: project.mediaLibrary.items,
    selectedClipIds: [],
    playhead,
  });
  if (!source) return null;
  const media = project.mediaLibrary.items.find((item) => item.id === source.mediaId);
  if (!media?.blob || media.nativeSource) return null;
  const canvas = document.createElement("canvas");
  if (source.mediaType === "image") {
    const bitmap = await createMediaImageBitmap(media);
    try {
      const size = containWithin(bitmap.width, bitmap.height, max);
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
      return canvas;
    } finally {
      bitmap.close();
    }
  }
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(media.blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const size = containWithin(track.displayWidth, track.displayHeight, max);
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: "fill", poolSize: 1 });
    const wrapped = await sink.getCanvas(source.posterSourceTime);
    if (!wrapped) return null;
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(wrapped.canvas as HTMLCanvasElement, 0, 0, size.width, size.height);
    return canvas;
  } finally {
    input[Symbol.dispose]?.();
  }
}
