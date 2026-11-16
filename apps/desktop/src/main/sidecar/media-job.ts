import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { parseProgressBlock } from "./export-job";

export const PROXY_SCALE = { low: 540, medium: 720, high: 1080 } as const;
const PROXY_CRF = { low: 32, medium: 28, high: 23 } as const;
const PROXY_BITRATE_KBPS = { low: 1500, medium: 3000, high: 6000 } as const;
const PROXY_PRESET = { low: "ultrafast", medium: "fast", high: "medium" } as const;

export type ProxyPreset = keyof typeof PROXY_SCALE;
export type TranscodeContainer = "mp4" | "webm" | "mov";

/** Rate-control and GOP args shared by proxy and transcode; hardware encoders take bitrate, libx264 takes CRF/preset. */
function h264VideoArgs(encoder: string, bitrateKbps: number, software?: { crf: number; preset: string }): string[] {
  const args = ["-c:v", encoder];
  if (encoder === "libx264" && software) {
    args.push("-preset", software.preset, "-crf", String(software.crf));
  } else {
    args.push("-b:v", `${bitrateKbps}k`);
  }
  args.push("-g", "30", "-pix_fmt", "yuv420p", "-threads", "0");
  return args;
}

/**
 * Whether a preview-proxy job asks ffmpeg for hardware decode. On macOS `-hwaccel auto` (VideoToolbox) copies every
 * 4K frame back to system memory for the CPU scaler and ran 1.8-2.5x slower than frame-threaded software decode
 * (M2 Pro, 30 s 4K H.264/HEVC to a 720p proxy: 5.7 s vs 2.6 s, 10.6 s vs 5.6 s on a noisy 60 Mbps source). The proxy
 * gates how soon scrubbing becomes cheap, so it wins; other platforms keep hardware decode (unmeasured).
 */
export function proxyUsesHwDecode(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "darwin";
}

export function buildProxyArgs(
  srcPath: string,
  outPath: string,
  preset: ProxyPreset,
  encoder = "libx264",
  hwDecode: boolean = proxyUsesHwDecode(),
): string[] {
  return [
    "-y",
    ...(hwDecode ? ["-hwaccel", "auto"] : []),
    "-i", srcPath,
    "-vf", `scale=-2:${PROXY_SCALE[preset]}`,
    ...h264VideoArgs(encoder, PROXY_BITRATE_KBPS[preset], { crf: PROXY_CRF[preset], preset: PROXY_PRESET[preset] }),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-progress", "pipe:2",
    outPath,
  ];
}

export function buildTranscodeArgs(
  srcPath: string,
  outPath: string,
  opts: { container: TranscodeContainer; videoBitrateKbps: number; audioBitrateKbps: number },
  encoder = "libx264",
): string[] {
  const isWebm = opts.container === "webm";
  const acodec = isWebm ? "libopus" : "aac";
  return [
    "-y",
    "-hwaccel", "auto",
    "-i", srcPath,
    ...(isWebm
      ? ["-c:v", "libvpx-vp9", "-b:v", `${opts.videoBitrateKbps}k`, "-threads", "0"]
      : h264VideoArgs(encoder, opts.videoBitrateKbps)),
    "-c:a", acodec,
    "-b:a", `${opts.audioBitrateKbps}k`,
    ...(opts.container === "mp4" ? ["-movflags", "+faststart"] : []),
    "-progress", "pipe:2",
    outPath,
  ];
}

export function buildExtractAudioArgs(srcPath: string, outPath: string, streamIndex?: number, channels = 2): string[] {
  return [
    "-y",
    "-i", srcPath,
    "-map", `0:a:${streamIndex ?? 0}`,
    "-vn",
    "-c:a", "pcm_f32le",
    "-ar", "48000",
    "-ac", String(channels),
    "-progress", "pipe:2",
    outPath,
  ];
}

/** Same args without `-hwaccel auto` (decode acceleration can fail on odd streams). */
export function withoutHwaccel(args: string[]): string[] {
  const i = args.indexOf("-hwaccel");
  return i < 0 ? args : [...args.slice(0, i), ...args.slice(i + 2)];
}

/**
 * Run ffmpeg. On a non-zero exit retry once: with `softwareArgs` (the same job on
 * libx264) when `args` used a hardware encoder, since stripping `-hwaccel` alone
 * would rerun the same failing encoder; otherwise with `-hwaccel` removed.
 */
export async function runWithHwaccelFallback(args: string[], softwareArgs?: string[]): Promise<void> {
  try {
    await new MediaJob(args).run();
  } catch (e) {
    const fallback = withoutHwaccel(softwareArgs ?? args);
    if (!softwareArgs && fallback.length === args.length) throw e;
    await new MediaJob(fallback).run();
  }
}

export class MediaJob {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stderr = "";

  constructor(
    private readonly args: string[],
    private readonly onProgress?: (frame: number) => void,
  ) {}

  run(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(resolveFfmpegPath(), this.args);
      this.proc.stderr.on("data", (chunk: Buffer) => {
        this.stderr += chunk.toString();
        if (this.stderr.length > 16384) this.stderr = this.stderr.slice(-4096);
        const parsed = parseProgressBlock(this.stderr);
        if (parsed && this.onProgress) this.onProgress(parsed.frame);
      });
      this.proc.on("error", (e) => reject(e));
      this.proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)),
      );
    });
  }

  cancel(): void {
    this.proc?.kill("SIGKILL");
  }
}
