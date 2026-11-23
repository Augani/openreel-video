import { desktopProxyDimensions } from "../../../../../packages/core/src/media/desktop-ingest";
import type { DesktopProxyProfile } from "../../../../../packages/core/src/types/project";

export interface ProxyArgsSpec {
  srcPath: string;
  /** Primary output (ProRes / DNxHR .mov or H.264 .mp4), usually a `.part` name; the muxer is given explicitly. */
  outPath: string;
  /** Second output for the H.264 preview twin of an intermediate (ProRes / DNxHR) proxy. */
  previewOutPath?: string;
  profile: DesktopProxyProfile;
  srcWidth: number;
  srcHeight: number;
  /** x264 / prores_ks worker threads. Kept below the core count so editing stays responsive. */
  threads: number;
  /** Decode acceleration; dropped on the retry after a failed run. */
  hwaccel?: boolean;
  /** Burn-in: the text of the clip-name overlay (the media's name). */
  clipName?: string;
  /** Burn-in: source start timecode `HH:MM:SS:FF` (`;` before the frames = drop frame); absent = 00:00:00:00. */
  startTimecode?: string;
  /** Burn-in: source frame rate, for the running timecode. */
  frameRate?: number;
  /** Burn-in: a font file for drawtext (the build has no usable default font on every machine). */
  fontFile?: string;
}

const H264_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-g", "12", "-bf", "0"];
const H264_AUDIO = ["-c:a", "aac", "-b:a", "128k"];
const PCM_AUDIO = ["-c:a", "pcm_s16le"];

const PRORES_PROFILE = { "prores-proxy": "0", "prores-lt": "1", "prores-422": "2" } as const;
type ProresCodec = keyof typeof PRORES_PROFILE;
const isProres = (codec: DesktopProxyProfile["codec"]): codec is ProresCodec => codec in PRORES_PROFILE;

/** ProRes 422 family: prores_ks profile 0 Proxy / 1 LT / 2 Standard, 10-bit 4:2:2, PCM audio. DNxHR LB / SQ: dnxhd encoder, 8-bit 4:2:2, PCM audio. */
function intermediateVideoArgs(codec: DesktopProxyProfile["codec"]): { video: string[]; pixFmt: string } {
  if (isProres(codec)) return { video: ["-c:v", "prores_ks", "-profile:v", PRORES_PROFILE[codec], "-vendor", "apl0"], pixFmt: "yuv422p10le" };
  return { video: ["-c:v", "dnxhd", "-profile:v", codec === "dnxhr-sq" ? "dnxhr_sq" : "dnxhr_lb"], pixFmt: "yuv422p" };
}

/**
 * Escape one drawtext option value: two parsing levels (filter graph, then the filter's options) both treat
 * `\`, `'` and `:` specially. Apostrophes become typographic ones, backslashes slashes, and control characters
 * are dropped, so the value can sit inside single quotes.
 */
export function escapeDrawtextValue(value: string): string {
  const safe = value.replace(/[\u0000-\u001f]+/g, " ").replace(/\\/g, "/").replace(/'/g, "\u2019");
  return safe.replace(/:/g, "\\:");
}

/** Frame rate as ffmpeg reads it: NTSC rates as exact fractions. */
export function drawtextRate(fps: number | undefined): string {
  if (!fps || !(fps > 0)) return "25";
  for (const base of [24, 30, 48, 60, 120]) if (Math.abs(fps - (base * 1000) / 1001) < 0.01) return `${base * 1000}/1001`;
  return String(Math.round(fps * 1000) / 1000);
}

/** drawtext filters for the burn-in option (clip name top-left, timecode bottom-left), or none. */
export function burnInFilters(spec: ProxyArgsSpec, height: number): string[] {
  const burn = spec.profile.burnIn;
  if (!burn?.clipName && !burn?.timecode) return [];
  if (!spec.fontFile) throw new Error("No font was found for the burn-in text on this computer.");
  const size = Math.max(10, Math.round(height / 28));
  const margin = Math.max(6, Math.round(size / 2));
  const common = `fontfile='${escapeDrawtextValue(spec.fontFile.replace(/\\/g, "/"))}':expansion=none:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size / 4)}`;
  const out: string[] = [];
  if (burn.clipName) out.push(`drawtext=${common}:text='${escapeDrawtextValue(spec.clipName ?? "")}':x=${margin}:y=${margin}`);
  if (burn.timecode) {
    const rate = drawtextRate(spec.frameRate);
    let start = /^\d{2}:\d{2}:\d{2}[:;]\d{2,3}$/.test(spec.startTimecode ?? "") ? spec.startTimecode! : "00:00:00:00";
    // ffmpeg refuses a drop-frame timecode unless the rate is 30000/1001 or 60000/1001 (a mislabelled source must not fail the whole proxy).
    if (!/^(30000|60000|120000)\/1001$/.test(rate)) start = start.replace(/;/, ":");
    out.push(`drawtext=${common}:timecode='${escapeDrawtextValue(start)}':rate=${rate}:x=${margin}:y=h-th-${margin}`);
  }
  return out;
}

/** ffmpeg arguments for one proxy job: a single decode feeding one or two outputs. */
export function buildProxyArgs(spec: ProxyArgsSpec): string[] {
  const { profile } = spec;
  const { width, height } = desktopProxyDimensions(spec.srcWidth, spec.srcHeight, profile.size, profile.customWidth);
  if (!(width > 0) || !(height > 0)) throw new Error("The source frame size is unknown, so a proxy cannot be sized.");
  const chain = [`scale=${width}:${height}:flags=bicubic`, ...burnInFilters(spec, height)].join(",");
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
  if (spec.hwaccel !== false) args.push("-hwaccel", "auto");
  args.push("-i", spec.srcPath, "-threads", String(Math.max(1, spec.threads)));
  const stripAudio = profile.audio === "strip";
  const audioMap = (): string[] => (stripAudio ? ["-an"] : ["-map", "0:a:0?"]);
  if (profile.codec === "h264") {
    args.push("-vf", `${chain},format=yuv420p`, "-map", "0:v:0", ...audioMap(), ...H264_ARGS, ...(stripAudio ? [] : H264_AUDIO), "-movflags", "+faststart", "-f", "mp4", spec.outPath);
  } else {
    const inter = intermediateVideoArgs(profile.codec);
    const interAudio = stripAudio ? [] : PCM_AUDIO;
    if (spec.previewOutPath) {
      args.push(
        "-filter_complex",
        `[0:v:0]${chain},split=2[a][b];[a]format=${inter.pixFmt}[p];[b]format=yuv420p[h]`,
        "-map", "[p]", ...audioMap(), ...inter.video, ...interAudio, "-f", "mov", spec.outPath,
        "-map", "[h]", ...audioMap(), ...H264_ARGS, ...(stripAudio ? [] : H264_AUDIO), "-movflags", "+faststart", "-f", "mp4", spec.previewOutPath,
      );
    } else {
      args.push("-vf", `${chain},format=${inter.pixFmt}`, "-map", "0:v:0", ...audioMap(), ...inter.video, ...interAudio, "-f", "mov", spec.outPath);
    }
  }
  // Machine-readable progress on stdout; stderr stays for errors.
  args.push("-progress", "pipe:1", "-nostats");
  return args;
}

/** `out_time_us` / `out_time_ms` (both microseconds in ffmpeg) of the last progress block, in seconds. */
export function parseProgressSeconds(text: string): number | null {
  const matches = [...text.matchAll(/out_time_(?:us|ms)=(-?\d+)/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const micros = Number(last[1]);
  return Number.isFinite(micros) && micros >= 0 ? micros / 1_000_000 : null;
}
