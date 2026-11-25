/**
 * Native smart render: stream-copy the untouched GOP-aligned spans of the
 * sources and re-encode only the touched spans and boundary GOPs, then join
 * everything without re-encoding.
 *
 * Every run (a copied span or a re-encoded span) is written as MPEG-TS to one
 * shared video file, in timeline order, with its timestamps pinned to the
 * output frame grid by `-output_ts_offset`. MPEG-TS carries parameter sets
 * in-band at every key frame, so runs whose SPS/PPS differ (the encoder is not
 * the camera) join without a decoder reset problem, and a byte-wise append of
 * transport streams is a valid concatenation. One last stream-copy pass muxes
 * that video with the re-rendered audio into the MP4/MOV.
 */
import { dolbyTrackArgs, type DolbyAudioPlan } from "./dolby-args";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { captionMuxArgs, chapterMuxArgs, parseProgressBlock, threadQueueSize, type ExportArgs } from "./export-job";
import { videoEncodeArgs } from "./encode-args";
import { joinPcmTrack, validateAudioPlan, writeAacCopy, writePcmCopy, type SmartAudioCopyPlan } from "./smart-audio";

/** Added to every run's timestamps so negative DTS (B-frame delay) never reaches the TS muxer. */
export const TS_BASE_SECONDS = 2;

export interface SmartStreamColor {
  matrix?: string | null;
  transfer?: string | null;
  primaries?: string | null;
}

/** Parameters the re-encoded runs reproduce from the copied sources. */
export interface SmartStreamMatch {
  codec: "avc" | "hevc" | "prores";
  /** ProRes only: the profile the re-encoded runs use (equal to the copied sources'). */
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  profile?: number;
  level?: number;
  color?: SmartStreamColor;
  frameRate: number;
}

/** The output frame rate as an exact rational (NTSC rates are n*1000/1001, not 29.97). */
export function exactFrameRate(fps: number): { num: number; den: number } {
  for (const [num, den] of [[24000, 1001], [30000, 1001], [60000, 1001], [120000, 1001], [48000, 1001]] as const) {
    if (Math.abs(fps - num / den) < 0.005) return { num, den };
  }
  if (Number.isInteger(fps)) return { num: fps, den: 1 };
  return { num: Math.round(fps * 1000), den: 1000 };
}

export function frameRateArg(fps: number): string {
  const { num, den } = exactFrameRate(fps);
  return den === 1 ? String(num) : `${num}/${den}`;
}

/** MP4 track timescale in which every frame duration is a whole number of ticks. */
export function videoTrackTimescale(fps: number): number {
  const { num, den } = exactFrameRate(fps);
  return den === 1 ? num * 1000 : num;
}

/** Seconds with microsecond precision (ffmpeg parses time options to microseconds). */
export function seconds(value: number): string {
  return value.toFixed(6);
}

/** Output time of frame `index` on the grid. */
export function frameTime(index: number, fps: number): number {
  const { num, den } = exactFrameRate(fps);
  return (index * den) / num;
}

const AVC_PROFILE_NAME: Record<number, string> = { 66: "baseline", 77: "main", 88: "main", 100: "high" };

/** x264/VideoToolbox level string for a level_idc (31 -> "3.1"); null when it has no plain form. */
export function avcLevelString(levelIdc: number | undefined): string | null {
  if (levelIdc === undefined || levelIdc < 10 || levelIdc > 62) return null;
  return `${Math.floor(levelIdc / 10)}.${levelIdc % 10}`;
}

/** HEVC general_level_idc is level * 30 (93 -> 3.1). */
export function hevcLevelString(levelIdc: number | undefined): string | null {
  if (levelIdc === undefined || levelIdc < 30 || levelIdc > 186) return null;
  const level = levelIdc / 30;
  return Number.isInteger(level) ? level.toFixed(0) : level.toFixed(1);
}

const SCALE_MATRIX: Record<string, string> = { bt709: "bt709", smpte170m: "bt601", bt470bg: "bt601" };

export interface ResolvedColor {
  /** `scale` filter out_color_matrix. */
  scaleMatrix: string;
  /** Tags written on the re-encoded runs; only what the source declared. */
  tags: string[];
}

/**
 * Colour handling for re-encoded runs: convert RGB to YUV with the source's
 * matrix (BT.709 when untagged HD, BT.601 when untagged SD, as decoders
 * assume) in limited range, and tag exactly what the source tags so copied and
 * re-encoded runs decode alike.
 */
export function resolveColor(color: SmartStreamColor | undefined, height: number): ResolvedColor {
  const declared = color?.matrix ?? undefined;
  const scaleMatrix = (declared && SCALE_MATRIX[declared]) || (height >= 720 ? "bt709" : "bt601");
  const tags: string[] = [];
  if (declared) tags.push("-colorspace", declared);
  if (color?.primaries) tags.push("-color_primaries", color.primaries);
  if (color?.transfer) tags.push("-color_trc", color.transfer);
  if (declared || color?.primaries || color?.transfer) tags.push("-color_range", "tv");
  return { scaleMatrix, tags };
}

/** Profile / level / colour arguments that make an encoder's output join the source's stream. */
export function matchEncodeArgs(encoder: string, match: SmartStreamMatch, height: number): string[] {
  const args: string[] = [];
  if (match.codec === "prores") return [...resolveColor(match.color, height).tags];
  const hevc = match.codec === "hevc";
  const profile = hevc ? (match.profile === 1 ? "main" : undefined) : match.profile !== undefined ? AVC_PROFILE_NAME[match.profile] : undefined;
  if (profile && !encoder.includes("nvenc") && !encoder.includes("amf")) args.push("-profile:v", profile);
  if (hevc) {
    const level = hevcLevelString(match.level);
    if (level) {
      if (encoder === "libx265") args.push("-x265-params", `level-idc=${level}`);
      else if (encoder.endsWith("_videotoolbox")) args.push("-level", level);
    }
  } else {
    const level = avcLevelString(match.level);
    if (level && (encoder === "libx264" || encoder.endsWith("_videotoolbox"))) args.push("-level", level);
  }
  args.push(...resolveColor(match.color, height).tags);
  return args;
}

export interface EncodeRunArgs {
  base: Pick<
    ExportArgs,
    "width" | "height" | "frameRate" | "codec" | "encoder" | "mode" | "quality" | "keyframeInterval" | "bitrateKbps"
  >;
  match: SmartStreamMatch;
  /** First output frame of the run. */
  startFrame: number;
  /** ProRes runs are written to a file each (MPEG-TS cannot carry ProRes); the TS runs go to stdout. */
  outputFile?: string;
}

/** ffmpeg arguments for a re-encoded run: RGBA frames on stdin, MPEG-TS on stdout. */
export function buildEncodeRunArgs(run: EncodeRunArgs): string[] {
  const { base, match, startFrame } = run;
  const color = resolveColor(match.color, base.height);
  const offset = TS_BASE_SECONDS + frameTime(startFrame, base.frameRate);
  if (match.codec === "prores") {
    if (!run.outputFile) throw new Error("a ProRes smart-render run needs an output file");
    return [
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${base.width}x${base.height}`,
      "-r", frameRateArg(base.frameRate),
      "-thread_queue_size", String(threadQueueSize(base.width, base.height)),
      "-i", "pipe:0",
      "-vf", `scale=out_color_matrix=${color.scaleMatrix}:out_range=tv`,
      ...videoEncodeArgs({
        codec: "prores",
        encoder: base.encoder,
        mode: base.mode,
        quality: base.quality,
        width: base.width,
        height: base.height,
        frameRate: base.frameRate,
        proresProfile: match.proresProfile,
      }),
      ...matchEncodeArgs(base.encoder, match, base.height),
      "-an",
      "-f", "mov",
      "-progress", "pipe:2",
      run.outputFile,
    ];
  }
  return [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${base.width}x${base.height}`,
    "-r", frameRateArg(base.frameRate),
    "-thread_queue_size", String(threadQueueSize(base.width, base.height)),
    "-i", "pipe:0",
    "-vf", `scale=out_color_matrix=${color.scaleMatrix}:out_range=tv`,
    ...videoEncodeArgs({
      codec: base.codec,
      encoder: base.encoder,
      mode: base.mode,
      quality: base.quality,
      width: base.width,
      height: base.height,
      frameRate: base.frameRate,
      keyframeInterval: base.keyframeInterval,
    }),
    ...matchEncodeArgs(base.encoder, match, base.height),
    // Each run must end in a closed GOP so the next run starts on a clean key frame.
    ...(base.encoder === "libx264" ? ["-flags", "+cgop"] : []),
    "-an",
    "-f", "mpegts",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-output_ts_offset", seconds(offset),
    "-progress", "pipe:2",
    "pipe:1",
  ];
}

export interface CopyRunArgs {
  sourcePath: string;
  /** Source presentation time of the first copied frame (a key frame). */
  sourceStart: number;
  /** Output frame the run starts at. */
  outputStartFrame: number;
  frames: number;
  frameRate: number;
  /** ProRes: write the run to this MOV file (every frame is a key frame) instead of MPEG-TS on stdout. */
  outputFile?: string;
}

/** ffmpeg arguments that stream-copy exactly `frames` video packets starting at a key frame, as MPEG-TS on stdout. */
export function buildCopyRunArgs(run: CopyRunArgs): string[] {
  const outputStart = frameTime(run.outputStartFrame, run.frameRate);
  if (run.outputFile) {
    return [
      "-y",
      "-v", "error",
      // Every ProRes frame is a key frame: seek half a frame past the wanted one so the demuxer lands on
      // it exactly, and zero the timestamps so no earlier frame rides along as an edit-list pre-roll.
      // -seek_timestamp 1: sourceStart is the file's own presentation time, not an offset from its start_time.
      "-seek_timestamp", "1",
      "-ss", seconds(run.sourceStart + 0.5 / run.frameRate),
      "-i", run.sourcePath,
      "-map", "0:v:0",
      "-c", "copy",
      "-an", "-sn", "-dn",
      "-avoid_negative_ts", "make_zero",
      "-frames:v", String(run.frames),
      "-f", "mov",
      "-progress", "pipe:2",
      run.outputFile,
    ];
  }
  return [
    "-y",
    "-v", "error",
    "-copyts",
    // Seek a hair past the key frame's presentation time: streams without
    // B-frames index the key frame at exactly that time.
    // sourceStart is a presentation time in the file's own timeline; without -seek_timestamp ffmpeg adds the
    // container start_time to -ss, which lands a source that does not start at zero on the wrong key frame.
    "-seek_timestamp", "1",
    "-ss", seconds(run.sourceStart + 1e-4),
    "-i", run.sourcePath,
    "-map", "0:v:0",
    "-c", "copy",
    "-an", "-sn", "-dn",
    "-frames:v", String(run.frames),
    "-f", "mpegts",
    "-muxdelay", "0",
    "-muxpreload", "0",
    "-output_ts_offset", seconds(TS_BASE_SECONDS + outputStart - run.sourceStart),
    "-progress", "pipe:2",
    "pipe:1",
  ];
}

export interface AssembleArgs {
  videoPath: string;
  audioWavPath: string;
  /** Smart audio copy: the audio input (instead of the rendered WAV) and how it is written. */
  audioInput?: { inputArgs: string[]; codecArgs: string[] };
  outputPath: string;
  frameRate: number;
  codec: "avc" | "hevc" | "prores";
  /** ProRes: the video is these run files joined by the concat demuxer (a list file), not one MPEG-TS. */
  concatList?: boolean;
  audioCodec: string;
  audioBitrateKbps?: number;
  /** Dolby Digital / Digital Plus audio instead of `audioCodec`. */
  dolby?: DolbyAudioPlan;
  format: string;
  captionInputs?: ExportArgs["captionInputs"];
  /** `;FFMETADATA1` file whose chapters are written into the output (MP4 / MOV): muxed here, at the final join. */
  chaptersPath?: string;
  /** MOV only: start timecode written as a timecode track. */
  startTimecode?: string;
}

/** Final pass: stream-copy the joined video, encode the audio, write the container. */
export function buildAssembleArgs(a: AssembleArgs): string[] {
  const captions = captionMuxArgs({ format: a.format, captionInputs: a.captionInputs } as ExportArgs);
  const chapters = chapterMuxArgs({ format: a.format, captionInputs: a.captionInputs, chaptersPath: a.chaptersPath } as ExportArgs);
  return [
    "-y",
    ...(a.concatList ? ["-f", "concat", "-safe", "0"] : []),
    "-i", a.videoPath,
    ...(a.audioInput ? a.audioInput.inputArgs : ["-i", a.audioWavPath]),
    ...captions.inputs,
    ...chapters.inputs,
    ...(captions.outputs.length ? captions.outputs : ["-map", "0:v:0", "-map", "1:a:0"]),
    ...chapters.outputs,
    "-c:v", "copy",
    ...(a.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    ...(a.dolby
      ? dolbyTrackArgs(a.dolby)
      : a.audioInput
      ? a.audioInput.codecArgs
      : [
          "-c:a", a.audioCodec,
          ...(a.audioBitrateKbps !== undefined ? ["-b:a", `${Math.max(32, Math.min(512, Math.round(a.audioBitrateKbps)))}k`] : []),
        ]),
    "-video_track_timescale", String(videoTrackTimescale(a.frameRate)),
    ...(a.startTimecode && a.format === "mov" ? ["-timecode", a.startTimecode] : []),
    "-movflags", "+faststart",
    "-progress", "pipe:2",
    a.outputPath,
  ];
}

export interface SmartSessionOptions {
  args: ExportArgs;
  match: SmartStreamMatch;
  /** Where the joined video is built (an app temp path; the caller releases it). */
  videoPath: string;
  totalFrames: number;
}

function lastFrame(progress: string): number | null {
  const parsed = parseProgressBlock(progress);
  return parsed ? parsed.frame : null;
}

/** A concat-demuxer list for run files (single quotes escaped as the demuxer expects). */
export function concatListFor(files: readonly string[]): string {
  return files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/** Runs one smart export: runs append to a shared TS file, then one stream-copy pass writes the output. */
export class SmartExportSession {
  readonly videoPath: string;
  private readonly sink: WriteStream;
  private sinkError: Error | null = null;
  private active: ChildProcess | null = null;
  private runStartFrame = 0;
  private runFrames = 0;
  private runStderr = "";
  private runDone: Promise<number> | null = null;
  private cancelled = false;
  private framesOut = 0;
  private chain: Promise<unknown> = Promise.resolve();

  /** Audio copy: the accepted plan and the files prepared for it (see prepareAudio). */
  private audio: { plan: SmartAudioCopyPlan; aacFile?: string; copyFiles: Map<number, string> } | null = null;

  /** ProRes: one MOV file per run, joined by the concat demuxer (TS cannot carry ProRes). */
  private readonly runFiles: string[] = [];
  private readonly filePerRun: boolean;

  constructor(private readonly opts: SmartSessionOptions) {
    this.videoPath = opts.videoPath;
    this.filePerRun = opts.match.codec === "prores";
    this.sink = createWriteStream(this.videoPath);
    this.sink.on("error", (error) => {
      this.sinkError = error;
    });
  }

  private nextRunFile(): string {
    const file = `${this.videoPath}.run${this.runFiles.length}.mov`;
    this.runFiles.push(file);
    return file;
  }

  /** Frames written to the video so far (copied + encoded). */
  get frames(): number {
    return this.framesOut;
  }

  /** Serialise run operations: they append to one file and must not interleave. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private appendFrom(proc: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const stdout = proc.stdout;
      if (!stdout) return reject(new Error("ffmpeg has no output pipe"));
      stdout.on("error", reject);
      stdout.on("end", () => resolve());
      stdout.pipe(this.sink, { end: false });
    });
  }

  private watch(proc: ChildProcess, stdoutDone: Promise<void>): Promise<number> {
    let tail = "";
    let progress = "";
    let frames = 0;
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4096);
      progress = (progress + text).slice(-8192);
      const parsed = lastFrame(progress);
      if (parsed !== null) frames = parsed;
    });
    return new Promise<number>((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", (code) => {
        void stdoutDone.then(
          () => {
            if (this.cancelled) return reject(new Error("Native export cancelled"));
            if (this.sinkError) return reject(this.sinkError);
            if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}${tail.trim() ? `: ${tail.trim()}` : ""}`));
            this.runStderr = tail;
            resolve(frames);
          },
          reject,
        );
      });
    });
  }

  /** Start a re-encoded run whose first frame is output frame `startFrame`. */
  beginEncodeRun(startFrame: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.active) throw new Error("a smart-render encode run is already open");
      const { args, match } = this.opts;
      const outputFile = this.filePerRun ? this.nextRunFile() : undefined;
      const proc = spawn(resolveFfmpegPath(), buildEncodeRunArgs({ base: args, match, startFrame, outputFile }), {
        stdio: ["pipe", this.filePerRun ? "ignore" : "pipe", "pipe"],
      });
      proc.stdin?.on("error", () => undefined);
      this.active = proc;
      this.runStartFrame = startFrame;
      this.runFrames = 0;
      const stdoutDone = this.filePerRun ? Promise.resolve() : this.appendFrom(proc);
      this.runDone = this.watch(proc, stdoutDone);
      this.runDone.catch(() => undefined);
    });
  }

  /** Write one RGBA frame of the open run; resolves once ffmpeg has accepted it. */
  async writeFrame(frame: Uint8Array): Promise<void> {
    const proc = this.active;
    const stdin = proc?.stdin;
    if (!proc || !stdin) throw new Error("no smart-render encode run is open");
    if (!stdin.writable) return;
    this.runFrames += 1;
    if (stdin.write(frame)) return;
    await new Promise<void>((resolve) => {
      const settle = (): void => {
        stdin.off("drain", settle);
        stdin.off("close", settle);
        stdin.off("error", settle);
        resolve();
      };
      stdin.once("drain", settle);
      stdin.once("close", settle);
      stdin.once("error", settle);
    });
  }

  /** Close the open run and return the number of frames it produced. */
  endEncodeRun(): Promise<number> {
    return this.enqueue(async () => {
      const proc = this.active;
      const done = this.runDone;
      if (!proc || !done) return 0;
      proc.stdin?.end();
      const encoded = await done;
      this.active = null;
      this.runDone = null;
      if (encoded !== this.runFrames) {
        throw new Error(`The encoder produced ${encoded} of ${this.runFrames} frames for the run starting at frame ${this.runStartFrame}.`);
      }
      this.framesOut += encoded;
      return encoded;
    });
  }

  /** Stream-copy `frames` packets of a source (from a key frame) onto the video. */
  copyRun(run: CopyRunArgs): Promise<number> {
    return this.enqueue(async () => {
      if (this.active) throw new Error("close the encode run before copying");
      const outputFile = this.filePerRun ? this.nextRunFile() : undefined;
      const proc = spawn(resolveFfmpegPath(), buildCopyRunArgs({ ...run, outputFile }), {
        stdio: ["ignore", this.filePerRun ? "ignore" : "pipe", "pipe"],
      });
      this.active = proc;
      const stdoutDone = this.filePerRun ? Promise.resolve() : this.appendFrom(proc);
      try {
        const copied = await this.watch(proc, stdoutDone);
        if (copied !== run.frames) {
          throw new Error(`Smart render copied ${copied} of ${run.frames} frames from the source.`);
        }
        this.framesOut += copied;
        return copied;
      } finally {
        this.active = null;
      }
    });
  }

  /** True when the audio is built from source files instead of only the rendered mixdown. */
  get audioCopyPlan(): SmartAudioCopyPlan | null {
    return this.audio?.plan ?? null;
  }

  /**
   * Prepare the audio copy before any frame is encoded: write the AAC packets (and prove the cut decodes like the source) or
   * extract the PCM spans. Resolves to null when the plan is accepted, else why the audio has to be rendered and encoded instead.
   */
  async prepareAudio(plan: SmartAudioCopyPlan): Promise<string | null> {
    const invalid = validateAudioPlan(plan);
    if (invalid) return invalid;
    const copyFiles = new Map<number, string>();
    const audio = { plan, copyFiles } as NonNullable<SmartExportSession["audio"]>;
    this.audio = audio;
    try {
      for (const [index, segment] of plan.segments.entries()) {
        if (segment.kind !== "copy") continue;
        const file = `${this.videoPath}.audio.${plan.codec === "aac" ? "m4a" : `${index}.raw`}`;
        if (plan.codec === "aac") audio.aacFile = file;
        else copyFiles.set(index, file);
        const reason = plan.codec === "aac" ? await writeAacCopy(segment, plan.sampleRate, file) : await writePcmCopy(segment, file);
        if (reason) {
          await this.removeAudioFiles();
          this.audio = null;
          return reason;
        }
      }
      return null;
    } catch (error) {
      await this.removeAudioFiles();
      this.audio = null;
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async audioInputFor(wavPath: string): Promise<AssembleArgs["audioInput"] | undefined> {
    const audio = this.audio;
    if (!audio) return undefined;
    const { plan } = audio;
    if (plan.codec === "aac") return { inputArgs: ["-i", audio.aacFile!], codecArgs: ["-c:a", "copy"] };
    const hasEncoded = plan.segments.some((segment) => segment.kind === "encode");
    const track = `${this.videoPath}.audio.s24`;
    await joinPcmTrack(plan, audio.copyFiles, hasEncoded ? wavPath : null, track);
    return { inputArgs: ["-f", "s24le", "-ar", String(plan.sampleRate), "-ac", String(plan.channels), "-i", track], codecArgs: ["-c:a", "pcm_s24le"] };
  }

  private async removeAudioFiles(): Promise<void> {
    const files = [`${this.videoPath}.audio.m4a`, `${this.videoPath}.audio.s24`, ...[...(this.audio?.copyFiles.values() ?? [])]];
    await Promise.all(files.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
  }

  /** Join and mux: closes the video file, then writes `outputPath` from it and the audio. */
  async assemble(assemble: Omit<AssembleArgs, "videoPath" | "frameRate" | "codec">, onProgress?: (frame: number) => void): Promise<void> {
    await this.chain;
    await new Promise<void>((resolve, reject) => {
      this.sink.end(() => (this.sinkError ? reject(this.sinkError) : resolve()));
    });
    if (this.framesOut !== this.opts.totalFrames) {
      throw new Error(`Smart render produced ${this.framesOut} of ${this.opts.totalFrames} frames.`);
    }
    let videoPath = this.videoPath;
    if (this.filePerRun) {
      videoPath = `${this.videoPath}.concat.txt`;
      await fs.writeFile(videoPath, concatListFor(this.runFiles), "utf8");
    }
    const audioInput = await this.audioInputFor(assemble.audioWavPath);
    const args = buildAssembleArgs({
      ...assemble,
      ...(audioInput ? { audioInput } : {}),
      concatList: this.filePerRun,
      videoPath,
      frameRate: this.opts.args.frameRate,
      codec: this.opts.match.codec,
    });
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(resolveFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
      this.active = proc;
      let tail = "";
      let progress = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        tail = (tail + text).slice(-4096);
        progress = (progress + text).slice(-8192);
        const frame = lastFrame(progress);
        if (frame !== null) onProgress?.(frame);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        this.active = null;
        if (this.cancelled) reject(new Error("Native export cancelled"));
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
    this.sink.destroy();
    void this.removeRunFiles();
    void this.removeAudioFiles();
  }

  /** Close the sink and delete the temp video. */
  async dispose(): Promise<void> {
    this.sink.destroy();
    await this.removeRunFiles();
    await this.removeAudioFiles();
    await fs.rm(this.videoPath, { force: true }).catch(() => undefined);
  }

  private async removeRunFiles(): Promise<void> {
    if (!this.filePerRun) return;
    await Promise.all([...this.runFiles, `${this.videoPath}.concat.txt`].map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
  }

  /** Last stderr of the most recent finished run (for diagnostics). */
  get lastStderr(): string {
    return this.runStderr;
  }
}
