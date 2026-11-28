import { createMediaImageBitmap, type Project } from "@openreel/core";
import { requestThumbnail } from "../../services/preview-thumbnail-worker";
import { containWithin, decodeVideoBackdrop } from "./playhead-video-frame";
import { selectPreviewSource } from "./panels/effect-previews/source-selection";

/** Longest side of a decoded playhead frame: crisp for a 2x library card of any aspect, bounded for memory. */
export const PLAYHEAD_FRAME_MAX = 1280;

/**
 * The real frame of the footage under the playhead, at the footage's own aspect (never cropped), as a canvas. The
 * same source choice the effect cards make (topmost under the playhead, else nearest). Null when the browser
 * cannot decode it (native-only codecs, missing blob): the caller keeps the media thumbnail then.
 */
export async function decodePlayheadFrame(
  project: Pick<Project, "timeline" | "mediaLibrary">,
  playhead: number,
  max: number = PLAYHEAD_FRAME_MAX,
  signal?: AbortSignal,
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
  if (signal?.aborted) return null;
  const reply = await requestThumbnail(
    { type: "backdrop", blob: media.blob, time: source.posterSourceTime, max }, { signal },
  ).catch(() => null);
  if (signal?.aborted) {
    if (reply?.type === "backdrop") reply.bitmap?.close();
    return null;
  }
  const frame = reply?.type === "backdrop" && reply.bitmap
    ? reply.bitmap : await decodeVideoBackdrop(media.blob, source.posterSourceTime, max, signal);
  if (!frame) return null;
  try {
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext("2d")?.drawImage(frame, 0, 0);
    return canvas;
  } finally {
    frame.close();
  }
}
