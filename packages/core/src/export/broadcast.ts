import { resolveFrameRate, secondsToFrames, framesToTimecode, timecodeToFrames, framesToSeconds } from "../interchange/timecode";

/**
 * Broadcast delivery (desktop ffmpeg sidecar only): XDCAM HD422 and AVC-Intra 100 in MXF,
 * MXF OP-Atom, per-channel mono PCM audio tracks and a start timecode. Everything here is
 * pure so the export dialog, the engine and the tests share one set of rules.
 */

/** Broadcast mezzanine codecs. Both are intra-friendly 4:2:2 and need the desktop encoder. */
export type BroadcastCodec = "xdcamhd422" | "avcintra100";
export const BROADCAST_CODECS: readonly BroadcastCodec[] = ["xdcamhd422", "avcintra100"];

export const isBroadcastCodec = (codec: string | undefined): codec is BroadcastCodec =>
  codec === "xdcamhd422" || codec === "avcintra100";

export const BROADCAST_CODEC_LABELS: Record<BroadcastCodec, string> = {
  xdcamhd422: "XDCAM HD422 (MPEG-2 4:2:2, 50 Mb/s)",
  avcintra100: "AVC-Intra 100 (H.264 High 4:2:2 Intra)",
};

/** OP1a: one file with picture and every audio track. OP-Atom: one file per essence track. */
export type MxfOperationalPattern = "op1a" | "opatom";

/**
 * Picture scan. "interlaced-tff" flags the frames as top-field-first interlaced (1080i). The timeline is
 * rendered progressive and delivered as segmented frames (25p as 50i, 29.97p as 59.94i), the
 * usual workflow for 1080i delivery from a progressive edit.
 */
export type BroadcastScan = "progressive" | "interlaced-tff";

/** What fills the audio tracks after the stereo mix on tracks 1 and 2. */
export type BroadcastExtraTracks = "silence" | "stems";

export const BROADCAST_AUDIO_TRACK_OPTIONS = [2, 4, 8, 16] as const;
export const MAX_BROADCAST_AUDIO_TRACKS = 16;

export interface BroadcastDeliverySettings {
  /** Picture scan; progressive when omitted. */
  scan?: BroadcastScan;
  /** MXF wrapper; OP1a when omitted. Ignored for MOV. */
  mxfPattern?: MxfOperationalPattern;
  /**
   * Number of mono PCM audio tracks (one mono stream per channel). Tracks 1 and 2 carry the
   * stereo mix (L, R). Omitted = the classic stereo mix as it is.
   */
  audioTracks?: number;
  /** Tracks 3 and up: silence, or the Dialogue / Music / FX / Ambience stems (mono) in order. */
  extraTracks?: BroadcastExtraTracks;
  /** Start timecode of the file, HH:MM:SS:FF (`;` before the frames for drop frame). Omitted = the sequence's. */
  startTimecode?: string;
}

/** The fields of the export settings the broadcast rules look at. */
export interface BroadcastCheckInput {
  codec: string;
  format: string;
  width: number;
  height: number;
  frameRate: number;
  broadcast?: BroadcastDeliverySettings;
  audioSettings?: { loudness?: { enabled?: boolean } | undefined };
}

/** True when the audio is delivered as N mono tracks instead of one stereo stream. */
export const wantsMonoTracks = (broadcast: BroadcastDeliverySettings | undefined): boolean =>
  !!broadcast && typeof broadcast.audioTracks === "number" && broadcast.audioTracks > 0;

export function broadcastAudioTrackCount(broadcast: BroadcastDeliverySettings | undefined): number {
  if (!wantsMonoTracks(broadcast)) return 0;
  return Math.max(2, Math.min(MAX_BROADCAST_AUDIO_TRACKS, Math.round(broadcast!.audioTracks!)));
}

/** HH:MM:SS:FF or HH:MM:SS;FF */
const TIMECODE_RE = /^(\d{2}):(\d{2}):(\d{2})[:;](\d{2,3})$/;

/**
 * The timecode in the form ffmpeg's `-timecode` takes for this frame rate: `;` before the frames only for
 * drop-frame rates (29.97 / 59.94 written with a semicolon), `:` otherwise. Null when it is not a valid
 * timecode for that rate.
 */
export function normalizeStartTimecode(timecode: string, frameRate: number): string | null {
  const match = TIMECODE_RE.exec(timecode.trim());
  if (!match) return null;
  const wantsDrop = timecode.trim().includes(";");
  const rate = resolveFrameRate(frameRate, { dropFrame: wantsDrop });
  const text = `${match[1]}:${match[2]}:${match[3]}${rate.dropFrame ? ";" : ":"}${match[4]}`;
  try {
    timecodeToFrames(text, rate);
  } catch {
    return null;
  }
  if (Number(match[1]) > 23) return null;
  return text;
}

/**
 * Timecode of the first frame of an export: the sequence start plus the In point when only a range is
 * exported. Null when `start` is not a valid timecode.
 */
export function exportStartTimecode(start: string, frameRate: number, rangeStartSeconds = 0): string | null {
  const normalized = normalizeStartTimecode(start, frameRate);
  if (!normalized) return null;
  if (!(rangeStartSeconds > 0)) return normalized;
  const rate = resolveFrameRate(frameRate, { dropFrame: normalized.includes(";") });
  const frames = timecodeToFrames(normalized, rate) + secondsToFrames(rangeStartSeconds, rate);
  return framesToTimecode(frames, rate);
}

/** Seconds (a time of day) of a timecode; used for a media item's embedded start timecode. */
export function timecodeToSeconds(timecode: string, frameRate: number): number | null {
  const normalized = normalizeStartTimecode(timecode, frameRate);
  if (!normalized) return null;
  const rate = resolveFrameRate(frameRate, { dropFrame: normalized.includes(";") });
  return framesToSeconds(timecodeToFrames(normalized, rate), rate);
}

/** Timecode text of a time of day in seconds, `;` for 29.97 / 59.94 drop frame when `dropFrame` is set. */
export function secondsToStartTimecode(seconds: number, frameRate: number, dropFrame = false): string {
  const rate = resolveFrameRate(frameRate, { dropFrame });
  return framesToTimecode(Math.max(0, secondsToFrames(seconds, rate)), rate);
}

const SIZE_OK = (w: number, h: number): boolean => (w === 1920 && h === 1080) || (w === 1280 && h === 720);
const RATE_OK = (fps: number): boolean => [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].some((r) => Math.abs(r - fps) < 0.02);

/**
 * Why these settings cannot be delivered, or null. XDCAM HD422 and AVC-Intra 100 are fixed-format
 * broadcast codecs: 1920x1080 or 1280x720, a broadcast frame rate, MXF or MOV.
 */
export function broadcastDeliveryProblem(input: BroadcastCheckInput): string | null {
  const broadcast = input.broadcast;
  const codecIsBroadcast = isBroadcastCodec(input.codec);
  if (codecIsBroadcast) {
    const label = input.codec === "xdcamhd422" ? "XDCAM HD422" : "AVC-Intra 100";
    if (input.format !== "mxf" && input.format !== "mov") return `${label} is delivered in MXF (or MOV).`;
    if (!SIZE_OK(input.width, input.height)) return `${label} is 1920x1080 or 1280x720. Choose one of those sizes.`;
    if (!RATE_OK(input.frameRate)) return `${label} needs a broadcast frame rate (23.976, 24, 25, 29.97, 30, 50, 59.94 or 60).`;
    if (input.height === 720 && broadcast?.scan === "interlaced-tff") return `${label} is progressive at 720p.`;
    if (input.codec === "xdcamhd422" && input.frameRate > 30.01 && input.height === 1080) return "XDCAM HD422 at 1080 runs up to 30 fps. Use 720p for 50 or 60 fps.";
    if (input.codec === "avcintra100" && input.frameRate > 30.01 && input.height === 1080) return "AVC-Intra 100 at 1080 runs up to 30 fps. Use 720p for 50 or 60 fps.";
  }
  if (!broadcast) return null;
  if (broadcast.mxfPattern === "opatom" && input.format !== "mxf") return "MXF OP-Atom needs the MXF format.";
  if (broadcast.scan === "interlaced-tff" && !codecIsBroadcast) return "Interlaced delivery is available with XDCAM HD422 and AVC-Intra 100.";
  if (broadcast.audioTracks !== undefined) {
    if (!Number.isInteger(broadcast.audioTracks) || broadcast.audioTracks < 2 || broadcast.audioTracks > MAX_BROADCAST_AUDIO_TRACKS) {
      return `Choose 2 to ${MAX_BROADCAST_AUDIO_TRACKS} audio tracks.`;
    }
    if (input.format !== "mxf" && input.format !== "mov") return "Mono audio tracks are written in MXF or MOV.";
    if (broadcast.extraTracks === "stems" && broadcast.audioTracks > 2 && input.audioSettings?.loudness?.enabled) {
      return "Loudness normalization applies to the stereo mix only; use silent extra tracks with it, or turn it off to export stems.";
    }
  }
  if (broadcast.startTimecode !== undefined && broadcast.startTimecode !== "") {
    if (input.format !== "mxf" && input.format !== "mov") return "A start timecode is written in MXF or MOV.";
    if (!normalizeStartTimecode(broadcast.startTimecode, input.frameRate)) return `"${broadcast.startTimecode}" is not a valid timecode at ${input.frameRate} fps (HH:MM:SS:FF).`;
  }
  return null;
}

/** What each channel of an N-track delivery carries: 0 and 1 the mix, then stems or silence. */
export type BroadcastChannelSource = { kind: "mix"; channel: 0 | 1 } | { kind: "stem"; index: number } | { kind: "silence" };

export function planBroadcastChannels(count: number, extra: BroadcastExtraTracks | undefined, stemCount: number): BroadcastChannelSource[] {
  const plan: BroadcastChannelSource[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) plan.push({ kind: "mix", channel: 0 });
    else if (i === 1) plan.push({ kind: "mix", channel: 1 });
    else if (extra === "stems" && i - 2 < stemCount) plan.push({ kind: "stem", index: i - 2 });
    else plan.push({ kind: "silence" });
  }
  return plan;
}

const monoOf = (channels: readonly Float32Array[]): Float32Array => {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  const scale = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] * scale;
  return out;
};

/**
 * Lay the stereo mix and the stems out as `plan.length` mono channels, all `frames` long. A mono mix feeds
 * both of tracks 1 and 2.
 */
export function layoutBroadcastChannels(
  plan: readonly BroadcastChannelSource[],
  mix: readonly Float32Array[],
  stems: readonly (readonly Float32Array[])[],
  frames: number,
): Float32Array[] {
  const monoStems = stems.map((stem) => monoOf(stem as Float32Array[]));
  return plan.map((source) => {
    if (source.kind === "mix") {
      const channel = mix[Math.min(source.channel, mix.length - 1)];
      if (channel.length === frames) return channel;
      const out = new Float32Array(frames);
      out.set(channel.subarray(0, Math.min(frames, channel.length)));
      return out;
    }
    if (source.kind === "stem") {
      const stem = monoStems[source.index];
      if (!stem) return new Float32Array(frames);
      if (stem.length === frames) return stem;
      const out = new Float32Array(frames);
      out.set(stem.subarray(0, Math.min(frames, stem.length)));
      return out;
    }
    return new Float32Array(frames);
  });
}

/**
 * Sequence timecode shown for a position: the sequence's start timecode plus the position, drop-frame aware.
 * Absent start = the plain 00:00:00:00 count.
 */
export function sequenceTimecodeAt(seconds: number, startTimecode: string | undefined, frameRate: number): string | null {
  if (!startTimecode) return null;
  const start = normalizeStartTimecode(startTimecode, frameRate);
  if (!start) return null;
  const rate = resolveFrameRate(frameRate, { dropFrame: start.includes(";") });
  const frames = timecodeToFrames(start, rate) + Math.max(0, secondsToFrames(seconds, rate));
  return framesToTimecode(frames, rate);
}

/** Inverse of `sequenceTimecodeAt`: the position in seconds of a typed sequence timecode, or null when it is invalid or before the start. */
export function sequencePositionOf(timecode: string, startTimecode: string | undefined, frameRate: number): number | null {
  if (!startTimecode) return null;
  const start = normalizeStartTimecode(startTimecode, frameRate);
  const typed = normalizeStartTimecode(timecode.replace(/\./g, ":"), frameRate);
  if (!start || !typed) return null;
  const rate = resolveFrameRate(frameRate, { dropFrame: start.includes(";") });
  let frames: number;
  try {
    frames = timecodeToFrames(typed.replace(/[:;](\d{2,3})$/, start.includes(";") ? ";$1" : ":$1"), rate) - timecodeToFrames(start, rate);
  } catch {
    return null;
  }
  return frames < 0 ? null : framesToSeconds(frames, rate);
}

/** Source timecode of a point `offsetSeconds` into a file whose start timecode is `startSeconds` (a time of day). */
export function sourceTimecodeAt(startSeconds: number, offsetSeconds: number, frameRate: number, dropFrame = false): string {
  return secondsToStartTimecode(startSeconds + offsetSeconds, frameRate, dropFrame);
}
