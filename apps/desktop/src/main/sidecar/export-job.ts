import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { videoEncodeArgs, type EncodeMode, type ExportCodec } from "./encode-args";

export interface ExportArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: ExportCodec;
  encoder: string;
  mode: EncodeMode;
  quality: number;
  bitrateKbps: number;
  outputPath: string;
  audioWavPath: string;
  format: string;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}

export function parseProgressBlock(block: string): { frame: number; done: boolean } | null {
  const matches = [...block.matchAll(/frame=(\d+)/g)];
  if (matches.length === 0) return null;
  return { frame: Number(matches[matches.length - 1][1]), done: /progress=end/.test(block) };
}

export function buildFfmpegArgs(a: ExportArgs): string[] {
  return [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${a.width}x${a.height}`,
    "-r", String(a.frameRate),
    "-i", "pipe:0",
    "-i", a.audioWavPath,
    ...videoEncodeArgs({
      codec: a.codec,
      encoder: a.encoder,
      mode: a.mode,
      quality: a.quality,
      width: a.width,
      height: a.height,
      frameRate: a.frameRate,
      proresProfile: a.proresProfile,
    }),
    "-c:a", "aac",
    "-progress", "pipe:2",
    a.outputPath,
  ];
}

export class ExportJob {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private progressBuf = "";
  private stderrTail = "";
  private finished = false;

  constructor(
    private readonly args: ExportArgs,
    private readonly onFrame: (frame: number) => void,
    private readonly onDone: () => void,
    private readonly onError: (msg: string) => void,
  ) {}

  start(): void {
    this.proc = spawn(resolveFfmpegPath(), buildFfmpegArgs(this.args));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.progressBuf += text;
      this.stderrTail = (this.stderrTail + text).slice(-4096);
      const parsed = parseProgressBlock(this.progressBuf);
      if (parsed) this.onFrame(parsed.frame);
      if (this.progressBuf.length > 16384) {
        this.progressBuf = this.progressBuf.slice(-4096);
      }
    });
    // ffmpeg closes its stdin when it exits (an encoder/arg error, or -shortest
    // ending early). Without this handler the next frame write raises EPIPE as an
    // unhandled stream error and crashes the whole main process. Swallow it here;
    // the real outcome (and reason) is reported via the close handler below.
    this.proc.stdin.on("error", () => {
      this.finished = true;
    });
    this.proc.on("error", (e) => {
      this.finished = true;
      this.onError(e.message);
    });
    this.proc.on("close", (code) => {
      this.finished = true;
      if (code === 0) {
        this.onDone();
      } else {
        const detail = this.stderrTail.trim();
        this.onError(
          `ffmpeg exited with code ${code}${detail ? `: ${detail}` : ""}`,
        );
      }
    });
  }

  async writeFrame(frame: Uint8Array): Promise<void> {
    const proc = this.proc;
    if (!proc) throw new Error("job not started");
    if (this.finished || !proc.stdin.writable) {
      return;
    }
    if (proc.stdin.write(frame)) {
      return;
    }
    await new Promise<void>((resolve) => {
      const settle = (): void => {
        proc.stdin.off("drain", settle);
        proc.stdin.off("close", settle);
        proc.stdin.off("error", settle);
        resolve();
      };
      proc.stdin.once("drain", settle);
      proc.stdin.once("close", settle);
      proc.stdin.once("error", settle);
    });
  }

  endInput(): void {
    if (this.proc && this.proc.stdin.writable) {
      this.proc.stdin.end();
    }
  }

  cancel(): void {
    this.finished = true;
    this.proc?.kill("SIGKILL");
  }
}
