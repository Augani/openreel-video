import { spawn } from "node:child_process";
import path from "node:path";
import { resolveFfmpegPath } from "./ffmpeg-path";

/**
 * Source paths come from the renderer and go straight to `ffmpeg -i`, which
 * also opens URLs and pseudo-protocols ("http://", "concat:", "subfile,,"...).
 * Only an absolute local file path is accepted.
 */
export function assertLocalSourcePath(sourcePath: string): string {
  if (sourcePath.includes("\0") || !path.isAbsolute(sourcePath)) {
    throw new Error("Smart render source must be an absolute file path");
  }
  return sourcePath;
}

/** What ffmpeg decodes from the first frame of a source's video stream. */
export interface SourceProbe {
  codec: string;
  /** Decoder pixel format without the colour suffix ("yuv420p", "yuv420p10le"). */
  pixelFormat: string;
  /** Names exactly as ffmpeg prints (and accepts for -colorspace etc.); absent when the stream does not say. */
  color: { range?: string; matrix?: string; primaries?: string; transfer?: string };
}

const known = (value: string | undefined): string | undefined =>
  value && value !== "unknown" && value !== "unspecified" ? value : undefined;

/** Parse the stderr of `ffmpeg -i file -frames:v 1 -vf showinfo -f null -`. Null when there is no video stream. */
export function parseSourceProbe(stderr: string): SourceProbe | null {
  const stream = /Stream #\d+:\d+[^\n]*?: Video: ([A-Za-z0-9_]+)[^,\n]*(?:\([^)]*\))*[^,\n]*, ([A-Za-z0-9_]+)(?:\(([^)]*)\))?/.exec(stderr);
  if (!stream) return null;
  const info = /color_range:(\S+) color_space:(\S+) color_primaries:(\S+) color_trc:(\S+)/.exec(stderr);
  return {
    codec: stream[1],
    pixelFormat: stream[2],
    color: {
      range: known(info?.[1]),
      matrix: known(info?.[2]),
      primaries: known(info?.[3]),
      transfer: known(info?.[4]),
    },
  };
}

/** Decode one frame of the first video stream and report how ffmpeg sees its format and colour. */
export function probeSource(sourcePath: string): Promise<SourceProbe | null> {
  return new Promise((resolve) => {
    try {
      assertLocalSourcePath(sourcePath);
    } catch {
      resolve(null);
      return;
    }
    let stderr = "";
    const proc = spawn(resolveFfmpegPath(), ["-hide_banner", "-i", sourcePath, "-map", "0:v:0", "-frames:v", "1", "-vf", "showinfo", "-f", "null", "-"]);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 262144) stderr = stderr.slice(-65536);
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => resolve(parseSourceProbe(stderr)));
  });
}

/** The picture types of a run of frames in display order, and the presentation time of the first one. */
export interface GopTypesProbe {
  /** One letter per frame ("I", "P", "B"), display order. */
  types: string;
  /** Presentation time of the first decoded frame, seconds. */
  firstTime: number;
}

/** Parse the `showinfo` lines of `ffmpeg ... -vf showinfo` into display-ordered picture types. Null when there are none. */
export function parseGopTypes(stderr: string): GopTypesProbe | null {
  let types = "";
  let firstTime: number | null = null;
  for (const match of stderr.matchAll(/showinfo[^\n]*? pts_time:\s*(-?[\d.]+)[^\n]*? type:([A-Za-z?])/g)) {
    if (firstTime === null) firstTime = Number(match[1]);
    types += match[2];
  }
  return firstTime === null || !Number.isFinite(firstTime) ? null : { types, firstTime };
}

/**
 * Decode `frames` frames starting at the key frame at `startTime` (a presentation time in the file's own timeline) and
 * report their picture types in display order. Used to find where a stream copy may stop inside a GOP.
 * The seek lands a hair before the key frame and ffmpeg discards the frames in front of it (accurate seek), and
 * `-copyts` keeps the file's own presentation times, so the first frame out is that key frame and `firstTime`
 * says so (the caller compares it with the time it asked for).
 */
export function probeGopTypes(sourcePath: string, startTime: number, frames: number): Promise<GopTypesProbe | null> {
  return new Promise((resolve) => {
    try {
      assertLocalSourcePath(sourcePath);
    } catch {
      resolve(null);
      return;
    }
    if (!(frames > 0) || !(startTime >= 0)) {
      resolve(null);
      return;
    }
    let stderr = "";
    const proc = spawn(resolveFfmpegPath(), [
      "-hide_banner",
      "-copyts",
      "-seek_timestamp", "1",
      "-ss", Math.max(0, startTime - 0.002).toFixed(6),
      "-i", sourcePath,
      "-map", "0:v:0",
      "-frames:v", String(Math.floor(frames)),
      "-vf", "showinfo",
      "-an", "-sn", "-dn",
      "-f", "null", "-",
    ]);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => resolve(parseGopTypes(stderr)));
  });
}
