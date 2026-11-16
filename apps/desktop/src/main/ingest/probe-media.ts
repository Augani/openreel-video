import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../sidecar/ffmpeg-path";

export interface MediaProbe {
  /** Seconds; absent for stills and unreadable durations. */
  duration?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
  /** Clockwise degrees (0, 90, 180, 270) the stored frame must be turned to show upright, from display-matrix / rotate metadata. */
  rotation?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Demuxer ffmpeg picked (`mxf`, `mov,mp4,m4a,3gp,3g2,mj2`, ...). */
  container?: string;
  /** Every audio stream, in file order. MXF carries one mono PCM stream per channel. */
  audioStreams?: AudioStreamProbe[];
  /** Interlaced picture (ffmpeg prints "top first" / "bottom first"), as in XDCAM HD422 1080i. */
  interlaced?: boolean;
  /** `upper` (top field first) or `lower` (bottom field first), when ffmpeg prints it for an interlaced stream. */
  fieldOrder?: "upper" | "lower";
  /** Sample (pixel) aspect ratio the stream reports (`SAR 4:3`), only when not square. */
  pixelAspectRatio?: number;
  /** Start timecode of the file (MOV timecode track, MXF timecode component): HH:MM:SS:FF, `;` before the frames for drop frame. */
  startTimecode?: string;
}

export interface AudioStreamProbe {
  codec: string;
  channels: number;
  sampleRate: number;
}

const CHANNELS_BY_LAYOUT: Record<string, number> = { mono: 1, stereo: 2, "2.1": 3, "3.0": 3, quad: 4, "4.0": 4, "5.0": 5, "5.1": 6, "5.1(side)": 6, "6.1": 7, "7.1": 8 };

function parseAudioStream(line: string): AudioStreamProbe {
  const codec = /Audio:\s+([A-Za-z0-9_]+)/.exec(line)?.[1] ?? "unknown";
  const sampleRate = Number(/(\d{4,6})\s*Hz/.exec(line)?.[1] ?? 0);
  const explicit = /(\d+)\s+channels?/.exec(line);
  const layout = /Hz,\s*([^,]+),/.exec(line)?.[1]?.trim();
  const channels = explicit ? Number(explicit[1]) : (layout && CHANNELS_BY_LAYOUT[layout]) || 1;
  return { codec, channels, sampleRate };
}

/** Any angle to the nearest quarter turn, 0..270. */
function normalizeClockwise(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return (((Math.round(degrees / 90) % 4) + 4) % 4) * 90;
}

/** Parse the stream summary `ffmpeg -hide_banner -i <file>` prints to stderr. */
export function parseFfmpegProbe(stderr: string): MediaProbe {
  const probe: MediaProbe = { hasVideo: false, hasAudio: false };
  const container = /Input #0,\s*([^,]+(?:,[a-z0-9_]+)*?),\s*from/.exec(stderr)?.[1];
  if (container) probe.container = container;
  const timecode = /^\s*timecode\s*:\s*(\d{2}:\d{2}:\d{2}[:;]\d{2,3})\s*$/im.exec(stderr)?.[1];
  if (timecode) probe.startTimecode = timecode;
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (dur) probe.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  let inVideoStream = false;
  for (const line of stderr.split(/\r?\n/)) {
    if (/Stream #\d+:\d+/.test(line)) inVideoStream = false;
    if (/Stream #\d+:\d+.*Audio:/.test(line)) {
      probe.hasAudio = true;
      (probe.audioStreams ??= []).push(parseAudioStream(line));
    }
    if (inVideoStream) {
      // `displaymatrix: rotation of -90.00 degrees` (`Display Matrix` in newer builds) is counter-clockwise; the older `rotate : 90` tag is clockwise.
      const matrix = /display\s?matrix:\s*rotation of\s*(-?[\d.]+)\s*degrees/i.exec(line);
      if (matrix) probe.rotation = normalizeClockwise(-Number(matrix[1]));
      const tag = /^\s*rotate\s*:\s*(-?[\d.]+)\s*$/.exec(line);
      if (tag && probe.rotation === undefined) probe.rotation = normalizeClockwise(Number(tag[1]));
      continue;
    }
    if (probe.hasVideo || !/Stream #\d+:\d+.*Video:/.test(line)) continue;
    // Attached pictures (cover art) are not video.
    if (/attached pic/i.test(line)) continue;
    probe.hasVideo = true;
    inVideoStream = true;
    probe.videoCodec = /Video:\s+([A-Za-z0-9_]+)/.exec(line)?.[1];
    if (/\b(?:top|bottom)(?: coded)? first\b/.test(line) || /\b(?:tff|bff)\b/.test(line)) probe.interlaced = true;
    if (/\b(?:top(?: coded)? first|tff)\b/.test(line)) probe.fieldOrder = "upper";
    else if (/\b(?:bottom(?: coded)? first|bff)\b/.test(line)) probe.fieldOrder = "lower";
    const sar = /\bSAR\s+(\d+):(\d+)/.exec(line);
    if (sar && Number(sar[1]) > 0 && Number(sar[2]) > 0 && sar[1] !== sar[2]) probe.pixelAspectRatio = Number(sar[1]) / Number(sar[2]);
    const size = /,\s*(\d{2,5})x(\d{2,5})/.exec(line);
    if (size) {
      probe.width = Number(size[1]);
      probe.height = Number(size[2]);
    }
    const fps = /([\d.]+)\s*fps/.exec(line) ?? /([\d.]+)\s*tbr/.exec(line);
    if (fps && Number(fps[1]) > 0) probe.frameRate = Number(fps[1]);
  }
  if (probe.rotation === 0) delete probe.rotation;
  return probe;
}

export function probeMediaFile(srcPath: string, signal?: AbortSignal): Promise<MediaProbe | null> {
  return new Promise((resolve) => {
    let stderr = "";
    let proc;
    try {
      proc = spawn(resolveFfmpegPath(), ["-hide_banner", "-nostdin", "-i", srcPath]);
    } catch {
      resolve(null);
      return;
    }
    const onAbort = (): void => {
      proc.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 65536) stderr = stderr.slice(0, 65536);
    });
    proc.on("error", () => resolve(null));
    // With no output file ffmpeg exits non-zero after printing the stream info; parse regardless.
    proc.on("close", () => {
      signal?.removeEventListener("abort", onAbort);
      const probe = parseFfmpegProbe(stderr);
      resolve(probe.hasVideo || probe.hasAudio ? probe : null);
    });
  });
}
