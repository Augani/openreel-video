/** The raw 4:2:0 (I420) pipe of the native export: layout helpers and the rules for when it may be used. */
import { rawInputPixelFormat, type NativeColorOutput } from "./color-output-args";

interface PipeArgs {
  width: number;
  height: number;
  color?: NativeColorOutput;
  rawYuv420?: boolean;
}

/** Pixel format of the raw frames on the pipe. */
export function pipePixelFormat(a: Pick<PipeArgs, "color" | "rawYuv420">): string {
  return a.color ? rawInputPixelFormat(a.color) : a.rawYuv420 ? "yuv420p" : "rgba";
}

/** Bytes of one frame on the pipe for the formats this file knows (undefined for the colour-managed planes). */
export function pipeFrameBytes(a: PipeArgs): number | undefined {
  if (a.color) return undefined;
  return a.rawYuv420 ? (a.width * a.height * 3) / 2 : a.width * a.height * 4;
}

/**
 * The raw I420 pipe is for the plain default export only. Anything that re-reads the pipe as RGBA (two-pass
 * intermediate, OP-Atom), converts it itself (colour-managed, alpha, ProRes / DNxHR / broadcast pixel formats) or
 * needs odd sizes is refused, so frames of the wrong layout can never reach ffmpeg.
 */
export function assertRawYuv420Allowed(a: { codec: string; color?: NativeColorOutput; alpha?: boolean; width: number; height: number; rateControl?: string; format: string; scan?: unknown; mxfPattern?: string }): void {
  if (a.codec !== "h264" && a.codec !== "hevc") throw new Error("Raw 4:2:0 frames are for H.264 and H.265 exports only.");
  if (a.color || a.alpha) throw new Error("Raw 4:2:0 frames cannot carry colour-managed or alpha output.");
  if (a.rateControl === "vbr2") throw new Error("Raw 4:2:0 frames cannot be combined with two-pass VBR.");
  if (a.format === "mxf" || a.scan || a.mxfPattern) throw new Error("Raw 4:2:0 frames cannot be combined with broadcast delivery.");
  if (a.width % 2 !== 0 || a.height % 2 !== 0) throw new Error("Raw 4:2:0 frames need even frame dimensions.");
}

