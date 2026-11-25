import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { parseProgressBlock, type ExportArgs } from "./export-job";
import { buildAssembleArgs, concatListFor } from "./smart-export";

/** One segment of a parallel export, in export frames. */
export interface SessionSegment {
  readonly index: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface SegmentSessionOptions {
  /** The resolved export arguments of the whole export (final output path, rendered audio WAV, encoder). */
  args: ExportArgs;
  segments: readonly SessionSegment[];
  /** Private scratch directory; the session removes it in `dispose`. */
  dir: string;
}

/**
 * Main-process bookkeeping of one parallel export: which segment each worker takes next, what file it writes,
 * proof that every segment holds exactly the frames it was given, and the final lossless join with the audio.
 */
export class SegmentSession {
  private nextIndex = 0;
  private readonly completed = new Map<number, number>();
  private readonly progress = new Map<number, number>();
  private joined = false;
  private active: ReturnType<typeof spawn> | null = null;
  private cancelled = false;

  constructor(private readonly opts: SegmentSessionOptions) {
    let expected = 0;
    for (const segment of opts.segments) {
      if (segment.startFrame !== expected || segment.endFrame <= segment.startFrame) {
        throw new Error(`The segments do not tile the export: segment ${segment.index} starts at ${segment.startFrame}, expected ${expected}.`);
      }
      expected = segment.endFrame;
    }
    if (expected !== opts.args.totalFrames) {
      throw new Error(`The segments cover ${expected} of ${opts.args.totalFrames} frames.`);
    }
  }

  get segments(): readonly SessionSegment[] {
    return this.opts.segments;
  }

  get totalFrames(): number {
    return this.opts.args.totalFrames ?? 0;
  }

  private get prores(): boolean {
    return this.opts.args.codec === "prores";
  }

  segmentPath(index: number): string {
    return join(this.opts.dir, `segment-${String(index).padStart(4, "0")}.${this.prores ? "mov" : "ts"}`);
  }

  /** The export arguments of one segment: the whole export's, writing its own piece. */
  argsFor(segment: SessionSegment): ExportArgs {
    return {
      ...this.opts.args,
      totalFrames: segment.endFrame - segment.startFrame,
      outputPath: this.segmentPath(segment.index),
      segment: { startFrame: segment.startFrame },
    };
  }

  /** The next segment nobody has taken, in timeline order, or null when all are handed out. */
  take(): SessionSegment | null {
    if (this.cancelled) return null;
    return this.opts.segments[this.nextIndex++] ?? null;
  }

  reportProgress(index: number, frames: number): void {
    const segment = this.opts.segments[index];
    if (!segment) return;
    this.progress.set(index, Math.min(segment.endFrame - segment.startFrame, Math.max(this.progress.get(index) ?? 0, frames)));
  }

  /** Frames finished across every segment (finished segments count in full). */
  get framesDone(): number {
    let total = 0;
    for (const segment of this.opts.segments) {
      total += this.completed.get(segment.index) ?? this.progress.get(segment.index) ?? 0;
    }
    return total;
  }

  /** A segment's encode ended: it must hold exactly the frames of its range. */
  complete(index: number, frames: number): void {
    const segment = this.opts.segments[index];
    if (!segment) throw new Error(`Unknown segment ${index}.`);
    const expected = segment.endFrame - segment.startFrame;
    if (frames !== expected) {
      throw new Error(`Segment ${index} (frames ${segment.startFrame}-${segment.endFrame - 1}) holds ${frames} of ${expected} frames.`);
    }
    this.completed.set(index, frames);
  }

  get allComplete(): boolean {
    return this.completed.size === this.opts.segments.length;
  }

  /**
   * Join the segments and write the output: the video is stream-copied (never re-encoded) and muxed with the
   * audio, which was rendered once for the whole timeline so there is no seam in it.
   */
  async assemble(onProgress?: (frame: number) => void): Promise<void> {
    if (this.joined) throw new Error("The segments were already joined.");
    if (!this.allComplete) throw new Error("Not every segment finished.");
    this.joined = true;
    const { args } = this.opts;
    let videoPath: string;
    if (this.prores) {
      videoPath = join(this.opts.dir, "concat.txt");
      await fs.writeFile(videoPath, concatListFor(this.opts.segments.map((segment) => this.segmentPath(segment.index))), "utf8");
    } else {
      videoPath = join(this.opts.dir, "joined.ts");
      const sink = createWriteStream(videoPath);
      try {
        for (const segment of this.opts.segments) {
          await pipeline(createReadStream(this.segmentPath(segment.index)), sink, { end: false });
        }
      } finally {
        await new Promise<void>((resolve) => sink.end(resolve));
      }
    }
    const ffArgs = buildAssembleArgs({
      videoPath,
      audioWavPath: args.audioWavPath,
      outputPath: args.outputPath,
      frameRate: args.frameRate,
      codec: this.prores ? "prores" : args.codec === "hevc" || args.codec === "h265" ? "hevc" : "avc",
      concatList: this.prores,
      audioCodec: this.prores ? "pcm_s24le" : "aac",
      audioBitrateKbps: args.audioBitrateKbps,
      format: args.format,
      // Chapters are muxed once, here, where the segments are joined: the segments themselves carry none.
      chaptersPath: args.chaptersPath,
    });
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(resolveFfmpegPath(), ffArgs, { stdio: ["ignore", "ignore", "pipe"] });
      this.active = proc;
      let tail = "";
      let progress = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        tail = (tail + text).slice(-4096);
        progress = (progress + text).slice(-8192);
        const parsed = parseProgressBlock(progress);
        if (parsed) onProgress?.(parsed.frame);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        this.active = null;
        if (this.cancelled) reject(new Error("Export cancelled"));
        else if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}${tail.trim() ? `: ${tail.trim()}` : ""}`));
      });
    });
  }

  cancel(): void {
    this.cancelled = true;
    try {
      this.active?.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }

  /** Remove the scratch directory (segments, joined stream, list). */
  async dispose(): Promise<void> {
    await fs.rm(this.opts.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
