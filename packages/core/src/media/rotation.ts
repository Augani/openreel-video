/**
 * Source rotation metadata (iPhone portrait clips are stored landscape with a 90 degree flag).
 *
 * One convention everywhere: clockwise degrees to rotate the stored frame so it shows upright, the
 * same as mediabunny's `rotation` and the MP4 `tkhd` matrix as players read it. The WebCodecs paths
 * get this from mediabunny's CanvasSink / VideoSample.draw; the native decoder asks ffmpeg for the
 * same transform explicitly (see `ffmpegRotationFilters`), so the two backends agree.
 */

export type SourceRotation = 0 | 90 | 180 | 270;

/** Any angle (negative, > 360, fractional, NaN) to the nearest quarter turn in 0..270. */
export function normalizeRotation(degrees: number | undefined | null): SourceRotation {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return 0;
  const quarter = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return (quarter * 90) as SourceRotation;
}

/** Dimensions of the upright frame for a stored frame of `width` x `height`. */
export function rotatedSize(width: number, height: number, rotation: SourceRotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * ffmpeg filters that turn a stored frame upright. Use with `-noautorotate`, so the result does not
 * depend on the ffmpeg build's autorotate behaviour.
 */
export function ffmpegRotationFilters(rotation: SourceRotation): string[] {
  switch (rotation) {
    case 90:
      return ["transpose=1"]; // 90 degrees clockwise
    case 180:
      return ["hflip", "vflip"];
    case 270:
      return ["transpose=2"]; // 90 degrees counter-clockwise
    default:
      return [];
  }
}

/** The sample surface this needs (mediabunny's VideoSample). */
export interface DrawableVideoSample {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly rotation?: number;
  toVideoFrame?(): VideoFrame;
  draw(context: OffscreenCanvasRenderingContext2D, dx: number, dy: number): void;
}

/**
 * An upright bitmap of a decoded sample. `createImageBitmap(videoFrame)` ignores the sample's
 * rotation, so frames are drawn through `VideoSample.draw`, which applies it.
 */
export async function sampleToUprightBitmap(sample: DrawableVideoSample): Promise<ImageBitmap | null> {
  // Unrotated (the common case): the direct VideoFrame path, no 2D-canvas round trip on the hot decode loop.
  if (normalizeRotation(sample.rotation) === 0 && typeof sample.toVideoFrame === "function") {
    const frame = sample.toVideoFrame();
    try {
      return await createImageBitmap(frame);
    } finally {
      frame.close();
    }
  }
  const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  sample.draw(ctx, 0, 0);
  return createImageBitmap(canvas);
}
