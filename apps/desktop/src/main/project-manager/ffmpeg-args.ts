import type { DesktopProxyCodec } from "../../../../../packages/core/src/types/project";
import {
  type ConcretePresetId,
  h264MaxRateBits,
  presetInfo,
} from "../../../../../packages/core/src/project-manager/presets";
import type { Segment } from "../../../../../packages/core/src/project-manager/segments";

/** A fraction ffmpeg reads exactly (`30000/1001`), so a 29.97 file keeps its true frame grid. */
export function frameRateArg(fps: number): string {
  for (const base of [24, 30, 48, 60, 120]) {
    if (Math.abs(fps - (base * 1000) / 1001) < 1e-6) return `${base * 1000}/1001`;
  }
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(6);
}

const sec = (value: number): string => Math.max(0, value).toFixed(6);

/** Picture and sound encoder arguments of a preset, and the container they go in. */
export interface CodecArgs {
  video: string[];
  audio: string[];
  format: "mov" | "mp4" | "wav";
}

export function presetCodecArgs(
  preset: ConcretePresetId,
  frame: { width: number; height: number; fps: number },
  conformAudio: boolean,
): CodecArgs {
  const info = presetInfo(preset);
  const pcm = conformAudio ? ["-c:a", "pcm_s24le", "-ar", "48000"] : ["-c:a", "pcm_s16le"];
  if (info.codec === "prores") {
    return { video: ["-c:v", "prores_ks", "-profile:v", info.profile ?? "2", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"], audio: pcm, format: "mov" };
  }
  if (info.codec === "dnxhd") {
    return { video: ["-c:v", "dnxhd", "-profile:v", info.profile ?? "dnxhr_hq", "-pix_fmt", "yuv422p"], audio: pcm, format: "mov" };
  }
  const maxrate = h264MaxRateBits(frame.width, frame.height, frame.fps || 24);
  return {
    video: ["-c:v", "libx264", "-preset", "medium", "-crf", "14", "-maxrate", String(maxrate), "-bufsize", String(maxrate * 2), "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
    audio: ["-c:a", "aac", "-b:a", "256k", ...(conformAudio ? ["-ar", "48000"] : [])],
    format: "mp4",
  };
}

/** The encoders of a proxy file (the same codecs the proxy queue writes), for a proxy trimmed to match its media. */
export function proxyCodecArgs(codec: DesktopProxyCodec): CodecArgs {
  const prores = { "prores-proxy": "0", "prores-lt": "1", "prores-422": "2" } as const;
  if (codec === "prores-proxy" || codec === "prores-lt" || codec === "prores-422") return { video: ["-c:v", "prores_ks", "-profile:v", prores[codec], "-vendor", "apl0", "-pix_fmt", "yuv422p10le"], audio: ["-c:a", "pcm_s16le"], format: "mov" };
  if (codec === "dnxhr-lb" || codec === "dnxhr-sq") return { video: ["-c:v", "dnxhd", "-profile:v", codec === "dnxhr-lb" ? "dnxhr_lb" : "dnxhr_sq", "-pix_fmt", "yuv422p"], audio: ["-c:a", "pcm_s16le"], format: "mov" };
  return { video: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-g", "12", "-bf", "0", "-pix_fmt", "yuv420p", "-movflags", "+faststart"], audio: ["-c:a", "aac", "-b:a", "128k"], format: "mp4" };
}

export interface ConsolidateSpec {
  srcPath: string;
  outPath: string;
  codec: CodecArgs;
  /** Kept stretches of the source; null converts the whole file. */
  segments: Segment[] | null;
  fps: number;
  hasVideo: boolean;
  /** Audio streams of the source to carry over (a WAV takes the first only). */
  audioStreams: number;
  threads: number;
}

/**
 * One ffmpeg command that writes a (possibly trimmed) copy of a file.
 *
 * A trimmed copy opens the source once per kept stretch with an input-side seek and joins the stretches with the
 * concat filter. Each stretch is seeked a quarter frame early and cut back to exactly N frames (and the matching
 * N / fps seconds of audio) by filters, so a file whose true frame times differ from the rounded rate by a hair
 * still starts on the intended frame and every stretch is a whole number of frames.
 */
export function buildConsolidateArgs(spec: ConsolidateSpec): string[] {
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
  const audioCount = spec.codec.format === "wav" ? Math.min(1, spec.audioStreams) : spec.audioStreams;
  const video = spec.hasVideo && spec.codec.format !== "wav";
  const maps: string[] = [];

  if (!spec.segments) {
    args.push("-i", spec.srcPath, "-threads", String(Math.max(1, spec.threads)));
    if (video) maps.push("-map", "0:v:0");
    for (let a = 0; a < audioCount; a++) maps.push("-map", `0:a:${a}`);
  } else {
    const q = spec.fps > 0 ? 0.25 / spec.fps : 0;
    const parts: string[] = [];
    const labels: string[] = [];
    spec.segments.forEach((segment, i) => {
      const length = segment.srcEnd - segment.srcStart;
      const frames = spec.fps > 0 ? Math.round(length * spec.fps) : 0;
      const start = Math.max(0, segment.srcStart - q);
      const lead = segment.srcStart - start;
      args.push("-ss", sec(start), "-t", sec(length + lead + (spec.fps > 0 ? 0.5 / spec.fps : 0)), "-i", spec.srcPath);
      if (video) {
        parts.push(`[${i}:v:0]${frames > 0 ? `trim=end_frame=${frames},` : ""}setpts=PTS-STARTPTS[v${i}]`);
        labels.push(`[v${i}]`);
      }
      for (let a = 0; a < audioCount; a++) {
        parts.push(`[${i}:a:${a}]atrim=start=${sec(lead)}:end=${sec(lead + length)},asetpts=PTS-STARTPTS[a${i}_${a}]`);
        labels.push(`[a${i}_${a}]`);
      }
    });
    const outs = [...(video ? ["[v]"] : []), ...Array.from({ length: audioCount }, (_, a) => `[a${a}]`)];
    parts.push(`${labels.join("")}concat=n=${spec.segments.length}:v=${video ? 1 : 0}:a=${audioCount}${outs.join("")}`);
    args.push("-filter_complex", parts.join(";"), "-threads", String(Math.max(1, spec.threads)));
    for (const out of outs) maps.push("-map", out);
  }
  args.push(...maps);
  if (video) args.push(...spec.codec.video, ...(spec.segments && spec.fps > 0 ? ["-r", frameRateArg(spec.fps)] : []));
  if (audioCount > 0) args.push(...spec.codec.audio);
  if (spec.codec.format !== "wav") args.push("-f", spec.codec.format);
  else args.push("-f", "wav");
  args.push(spec.outPath, "-progress", "pipe:1", "-nostats");
  return args;
}
