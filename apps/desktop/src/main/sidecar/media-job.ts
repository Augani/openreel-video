import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { parseProgressBlock } from "./export-job";

export const PROXY_SCALE = { low: 540, medium: 720, high: 1080 } as const;
const PROXY_CRF = { low: 32, medium: 28, high: 23 } as const;
const PROXY_PRESET = { low: "ultrafast", medium: "fast", high: "medium" } as const;

export type ProxyPreset = keyof typeof PROXY_SCALE;
export type TranscodeContainer = "mp4" | "webm" | "mov";

export function buildProxyArgs(srcPath: string, outPath: string, preset: ProxyPreset): string[] {
  return [
    "-y",
    "-i", srcPath,
    "-vf", `scale=-2:${PROXY_SCALE[preset]}`,
    "-c:v", "libx264",
    "-preset", PROXY_PRESET[preset],
    "-crf", String(PROXY_CRF[preset]),
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
): string[] {
  const vcodec = opts.container === "webm" ? "libvpx-vp9" : "libx264";
  const acodec = opts.container === "webm" ? "libopus" : "aac";
  return [
    "-y",
    "-i", srcPath,
    "-c:v", vcodec,
    "-b:v", `${opts.videoBitrateKbps}k`,
    "-c:a", acodec,
    "-b:a", `${opts.audioBitrateKbps}k`,
    ...(opts.container === "mp4" ? ["-movflags", "+faststart"] : []),
    "-progress", "pipe:2",
    outPath,
  ];
}

export function buildExtractAudioArgs(srcPath: string, outPath: string, streamIndex?: number): string[] {
  return [
    "-y",
    "-i", srcPath,
    "-map", `0:a:${streamIndex ?? 0}`,
    "-vn",
    "-c:a", "pcm_f32le",
    "-ar", "48000",
    "-ac", "2",
    "-progress", "pipe:2",
    outPath,
  ];
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
