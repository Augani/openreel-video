import { safeZipName, zipStore } from "./zip";

/**
 * Image-sequence helpers (PNG / JPEG frames): frame numbering from a pattern, the exported frame
 * range from the sequence length and an optional in/out range, and the zip the frames travel in.
 */

export type SequenceImageFormat = "png" | "jpg";

export interface SequenceRange {
  readonly startFrame: number;
  readonly endFrame: number;
}

/**
 * `frame_{0000}` -> `frame_0042`: the digits in braces set the zero padding; `{start}` is not supported.
 * A pattern without a `{000}` token gets `_0000` appended so names never collide.
 */
export function frameFileName(pattern: string, frameNumber: number, format: SequenceImageFormat, startNumber = 0): string {
  const number = Math.max(0, Math.floor(frameNumber)) + startNumber;
  const match = /\{(0+)\}/.exec(pattern);
  const width = match ? match[1].length : 4;
  const padded = String(number).padStart(width, "0");
  const base = match ? pattern.replace(match[0], padded) : `${pattern}_${padded}`;
  return `${safeZipName(base)}.${format === "jpg" ? "jpg" : "png"}`;
}

/** Frames to export, inclusive of the first and last. `range` is timeline seconds with an exclusive Out point. */
export function sequenceFrameRange(durationSec: number, fps: number, range?: { startTime: number; endTime: number }): SequenceRange {
  if (!(durationSec > 0) || !(fps > 0)) throw new Error("There is nothing to export: the timeline is empty.");
  const total = Math.max(1, Math.ceil(durationSec * fps - 1e-9));
  if (!range) return { startFrame: 0, endFrame: total - 1 };
  if (!(range.endTime > range.startTime) || range.startTime < 0) throw new Error("The export range must end after it starts.");
  const startFrame = Math.floor(range.startTime * fps + 1e-9);
  const endFrame = Math.min(total - 1, Math.ceil(range.endTime * fps - 1e-9) - 1);
  if (endFrame < startFrame) throw new Error("The export range holds no frames.");
  return { startFrame, endFrame };
}

/** Frames are held in memory until the zip is packed, so both the count and the encoded size are capped. */
export const MAX_SEQUENCE_FRAMES = 5000;
export const MAX_SEQUENCE_BYTES = 1024 * 1024 * 1024;

export function validateSequenceRange(range: SequenceRange): string | null {
  if (!Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrame) || range.startFrame < 0 || range.endFrame < range.startFrame)
    return "Choose a valid frame range.";
  if (range.endFrame - range.startFrame + 1 > MAX_SEQUENCE_FRAMES) return `An image sequence is limited to ${MAX_SEQUENCE_FRAMES} frames.`;
  return null;
}

/** Pack encoded frames (already in order) into one stored zip, named by `pattern`, numbered from the project frame index. */
export async function packImageSequence(
  frames: readonly Uint8Array[],
  options: { pattern: string; format: SequenceImageFormat; startFrame: number; startNumber?: number },
): Promise<Uint8Array> {
  return zipStore(
    frames.map((data, i) => ({
      name: frameFileName(options.pattern, options.startFrame + i, options.format, options.startNumber ?? 0),
      data,
    })),
  );
}
