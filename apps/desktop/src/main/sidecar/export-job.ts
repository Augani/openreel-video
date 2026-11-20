import { rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { isBroadcastExportCodec, supportsTwoPass, videoEncodeArgs, withTopFieldFirst, type BroadcastScan, type DnxhrProfile, type EncodeMode, type ExportCodec } from "./encode-args";
import { dolbyTrackArgs, type DolbyAudioPlan } from "./dolby-args";
import { colorFilterArgs, colorTagArgs, rawInputPixelFormat, type NativeColorOutput } from "./color-output-args";

export interface ExportArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: ExportCodec;
  encoder: string;
  mode: EncodeMode;
  quality: number;
  bitrateKbps: number;
  /** One-pass VBR: use `bitrateKbps` as the average and this as the peak cap (kbps). Absent = constant quality. */
  maxBitrateKbps?: number;
  /** "vbr2" is true two-pass VBR (libx264 / libx265): needs `passDir`, runs ffmpeg twice. */
  rateControl?: "quality" | "vbr" | "vbr2";
  /** Frames the renderer will send; scales progress across the two passes. */
  totalFrames?: number;
  /** Private directory for the pass-1 statistics and the lossless intermediate. Removed by the job on done / error / cancel. */
  passDir?: string;
  outputPath: string;
  audioWavPath: string;
  format: string;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
  dnxhrProfile?: DnxhrProfile;
  /** ProRes 4444: keep the render's alpha channel. */
  alpha?: boolean;
  audioBitrateKbps?: number;
  /** Dolby Digital / Digital Plus audio track (MP4, MOV or MKV) instead of AAC / Opus / PCM. */
  dolby?: DolbyAudioPlan;
  keyframeInterval?: number;
  /**
   * Colour-managed export: the pipe carries raw planar YCbCr already converted
   * to this output space (instead of RGBA), and the stream is tagged with it.
   */
  color?: NativeColorOutput;
  /** Subtitle files muxed in as extra tracks (SRT -> mov_text, SCC -> c608 in MOV). */
  captionInputs?: CaptionInput[];
  /** XDCAM HD422 / AVC-Intra 100: top-field-first interlaced frames. */
  scan?: BroadcastScan;
  /** MXF wrapper; OP1a (one file) when omitted. OP-Atom writes one file per essence track (see `opAtomOutputs`). */
  mxfPattern?: "op1a" | "opatom";
  /** The audio WAV carries this many channels and each is written as its own mono track (MXF / MOV). */
  audioTrackCount?: number;
  /** File start timecode, `HH:MM:SS:FF` or `HH:MM:SS;FF` (drop frame). MOV gets a timecode track, MXF a timecode component. */
  startTimecode?: string;
}

export interface CaptionInput {
  path: string;
  kind: "mov_text" | "cea608";
  /** ISO 639-2 language tag. */
  language?: string;
}

/** Caption tracks an output container can hold; the rest are dropped by the caller with a warning. */
export function usableCaptionInputs(format: string, inputs: readonly CaptionInput[] | undefined): CaptionInput[] {
  if (!inputs || (format !== "mp4" && format !== "mov")) return [];
  return inputs.filter((c) => c.kind === "mov_text" || (c.kind === "cea608" && format === "mov"));
}

export function parseProgressBlock(block: string): { frame: number; done: boolean } | null {
  const matches = [...block.matchAll(/frame=(\d+)/g)];
  if (matches.length === 0) return null;
  return { frame: Number(matches[matches.length - 1][1]), done: /progress=end/.test(block) };
}

/** Containers whose delivery specs call for uncompressed PCM audio (MXF requires it; ProRes / DNxHR masters carry it). */
export function usesPcmAudio(a: Pick<ExportArgs, "format" | "codec"> & { dolby?: unknown }): boolean {
  if (a.dolby) return false;
  return a.format === "mxf" || a.codec === "prores" || a.codec === "dnxhr" || isBroadcastExportCodec(a.codec);
}

/** Mono tracks written out of the WAV: the requested count, or L and R for OP-Atom (one mono essence per file). */
export function monoTrackCount(a: Pick<ExportArgs, "format" | "mxfPattern" | "audioTrackCount">): number {
  if (a.audioTrackCount !== undefined && a.audioTrackCount >= 1) return Math.min(64, Math.round(a.audioTrackCount));
  return a.format === "mxf" && a.mxfPattern === "opatom" ? 2 : 0;
}

export const isOpAtom = (a: Pick<ExportArgs, "format" | "mxfPattern">): boolean => a.format === "mxf" && a.mxfPattern === "opatom";

/** Files an OP-Atom export writes: `<name>_V01.mxf` for the picture and `<name>_A01.mxf` ... one per mono audio track. */
export function opAtomOutputs(outputPath: string, audioTracks: number): { video: string; audio: string[] } {
  const base = outputPath.replace(/\.mxf$/i, "");
  const two = (n: number): string => String(n).padStart(2, "0");
  return {
    video: `${base}_V01.mxf`,
    audio: Array.from({ length: audioTracks }, (_, i) => `${base}_A${two(i + 1)}.mxf`),
  };
}

/** Every file the export writes (one, except OP-Atom). */
export function exportOutputPaths(a: Pick<ExportArgs, "format" | "mxfPattern" | "audioTrackCount" | "outputPath">): string[] {
  if (!isOpAtom(a)) return [a.outputPath];
  const out = opAtomOutputs(a.outputPath, monoTrackCount(a));
  return [out.video, ...out.audio];
}

/** `-filter_complex` that splits the N-channel WAV into N mono streams labelled [a0]..[aN-1]. */
export function monoSplitFilter(count: number): string {
  const labels = Array.from({ length: count }, (_, i) => `[s${i}]`);
  const pans = Array.from({ length: count }, (_, i) => `[s${i}]pan=mono|c0=c${i}[a${i}]`);
  return `[1:a]asplit=${count}${labels.join("")};${pans.join(";")}`;
}

// WebM only accepts VP8/VP9/AV1 video with Opus/Vorbis audio.
function audioCodecFor(a: ExportArgs): string {
  if (a.dolby) return a.dolby.codec;
  if (usesPcmAudio(a)) return "pcm_s24le";
  return a.format === "webm" || a.codec === "vp9" ? "libopus" : "aac";
}

/** The `-f` muxer to force: MXF is not reliably guessed from the output name, so it is always explicit. */
export function explicitMuxerArgs(format: string): string[] {
  if (format === "mkv") return ["-f", "matroska"];
  return format === "mxf" ? ["-f", "mxf"] : [];
}

function clampAudioBitrateKbps(kbps: number): number {
  if (!Number.isFinite(kbps)) return 192;
  return Math.max(32, Math.min(512, Math.round(kbps)));
}

const MAX_THREAD_QUEUE = 64;
const MIN_THREAD_QUEUE = 4;
const THREAD_QUEUE_BUDGET_BYTES = 512 * 1024 * 1024;

/** Raw RGBA packets buffered for the pipe input, bounded by memory (64 packets at 4K is about 2 GB). */
export function threadQueueSize(width: number, height: number): number {
  const frameBytes = Math.max(1, width * height * 4);
  return Math.max(
    MIN_THREAD_QUEUE,
    Math.min(MAX_THREAD_QUEUE, Math.floor(THREAD_QUEUE_BUDGET_BYTES / frameBytes)),
  );
}

/** Extra `-i`, `-map` and `-c:s` arguments for embedded caption tracks (none when there are no captions). */
export function captionMuxArgs(a: ExportArgs): { inputs: string[]; outputs: string[] } {
  const captions = usableCaptionInputs(a.format, a.captionInputs);
  if (!captions.length) return { inputs: [], outputs: [] };
  const inputs = captions.flatMap((c) => ["-i", c.path]);
  const monoCount = monoTrackCount(a);
  const outputs: string[] = ["-map", "0:v:0", ...(monoCount ? Array.from({ length: monoCount }, (_, i) => ["-map", `[a${i}]`]).flat() : ["-map", "1:a:0"])];
  captions.forEach((c, i) => {
    outputs.push("-map", `${2 + i}:0`, `-c:s:${i}`, c.kind === "cea608" ? "copy" : "mov_text");
    outputs.push(`-metadata:s:s:${i}`, `language=${c.language && /^[a-z]{3}$/.test(c.language) ? c.language : "und"}`);
  });
  return { inputs, outputs };
}

/**
 * The canvas is sRGB and video players read untagged HD as BT.709, but ffmpeg's
 * RGB to YUV conversion defaults to BT.601 and writes no tags, which shifts every
 * colour. Convert with BT.709 limited range and say so in the file.
 */
export const COLOR_PIPELINE_ARGS: readonly string[] = [
  "-vf", "scale=out_color_matrix=bt709:out_range=tv",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
];

/** `-timecode` for the output, when the container can hold it. */
function timecodeArgs(a: ExportArgs): string[] {
  return a.startTimecode && (a.format === "mxf" || a.format === "mov") ? ["-timecode", a.startTimecode] : [];
}

/** OP-Atom: one MXF per essence track, the picture first. `-timecode` and the muxer repeat for each file. */
function buildOpAtomArgs(a: ExportArgs): string[] {
  const audioTracks = monoTrackCount(a);
  const outputs = opAtomOutputs(a.outputPath, audioTracks);
  return [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", a.color ? rawInputPixelFormat(a.color) : "rgba",
    "-s", `${a.width}x${a.height}`,
    "-r", String(a.frameRate),
    "-thread_queue_size", String(threadQueueSize(a.width, a.height)),
    "-i", "pipe:0",
    "-i", a.audioWavPath,
    "-filter_complex", monoSplitFilter(audioTracks),
    "-progress", "pipe:2",
    "-map", "0:v:0",
    ...withTopFieldFirst(a.color ? colorFilterArgs(a.color) : [...COLOR_PIPELINE_ARGS], planOf(a)),
    ...videoEncodeArgs(planOf(a)),
    ...(a.color ? colorTagArgs(a.color) : []),
    ...timecodeArgs(a),
    "-f", "mxf_opatom",
    outputs.video,
    ...outputs.audio.flatMap((file, i) => [
      "-map", `[a${i}]`,
      "-c:a", "pcm_s24le",
      ...timecodeArgs(a),
      "-f", "mxf_opatom",
      file,
    ]),
  ];
}

function planOf(a: ExportArgs): Parameters<typeof videoEncodeArgs>[0] {
  return {
    codec: a.codec,
    encoder: a.encoder,
    mode: a.mode,
    quality: a.quality,
    width: a.width,
    height: a.height,
    frameRate: a.frameRate,
    proresProfile: a.proresProfile,
    dnxhrProfile: a.dnxhrProfile,
    alpha: a.alpha,
    keyframeInterval: a.keyframeInterval,
    color: a.color,
    scan: a.scan,
    ...((a.rateControl === "vbr" || a.rateControl === "vbr2") && a.bitrateKbps > 0 ? { rate: { targetKbps: a.bitrateKbps, maxKbps: a.maxBitrateKbps } } : {}),
  };
}

/** True when this export runs as two ffmpeg passes. */
export function isTwoPass(a: Pick<ExportArgs, "rateControl" | "encoder" | "bitrateKbps" | "passDir">): boolean {
  return a.rateControl === "vbr2" && a.bitrateKbps > 0 && supportsTwoPass(a.encoder) && !!a.passDir;
}

export const PASS_LOG_NAME = "pass";
export const INTERMEDIATE_NAME = "intermediate.mkv";

function passLogPrefix(a: ExportArgs): string {
  return join(a.passDir ?? "", PASS_LOG_NAME);
}

/**
 * Pass 1: the piped frames go to two outputs. One is a lossless FFV1 intermediate (frames arrive once,
 * so they are kept for pass 2); the other is the analysis encode with the final filters and rate, discarded.
 */
export function buildPass1Args(a: ExportArgs): string[] {
  const rawFmt = a.color ? rawInputPixelFormat(a.color) : "rgba";
  return [
    "-y",
    "-f", "rawvideo",
    "-pix_fmt", rawFmt,
    "-s", `${a.width}x${a.height}`,
    "-r", String(a.frameRate),
    "-thread_queue_size", String(threadQueueSize(a.width, a.height)),
    "-i", "pipe:0",
    "-progress", "pipe:2",
    // The analysis encode must be output stream 0: ffmpeg names the statistics file <prefix>-<stream index>.log,
    // and pass 2 (one output stream) reads <prefix>-0.log.
    "-map", "0:v:0",
    ...withTopFieldFirst(a.color ? colorFilterArgs(a.color) : [...COLOR_PIPELINE_ARGS], planOf(a)),
    ...videoEncodeArgs({ ...planOf(a), pass: { stage: 1, logPrefix: passLogPrefix(a) } }),
    ...(a.color ? colorTagArgs(a.color) : []),
    "-an", "-f", "null", "-",
    "-map", "0:v:0", "-c:v", "ffv1", "-level", "3", ...(rawFmt === "rgba" ? ["-pix_fmt", "bgra"] : []),
    join(a.passDir ?? "", INTERMEDIATE_NAME),
  ];
}

export function buildFfmpegArgs(a: ExportArgs, stage: "single" | "pass2" = "single"): string[] {
  if (isOpAtom(a)) return buildOpAtomArgs(a);
  const pass2 = stage === "pass2";
  const inputArgs = pass2
    ? ["-i", join(a.passDir ?? "", INTERMEDIATE_NAME)]
    : [
        "-f", "rawvideo",
        "-pix_fmt", a.color ? rawInputPixelFormat(a.color) : "rgba",
        "-s", `${a.width}x${a.height}`,
        "-r", String(a.frameRate),
        "-thread_queue_size", String(threadQueueSize(a.width, a.height)),
        "-i", "pipe:0",
      ];
  const captions = captionMuxArgs(a);
  const monoCount = monoTrackCount(a);
  // N mono tracks: the N-channel WAV is split into N mono streams, one track each.
  const monoInputs = monoCount ? ["-filter_complex", monoSplitFilter(monoCount)] : [];
  const monoMaps = monoCount && !captions.outputs.length
    ? ["-map", "0:v:0", ...Array.from({ length: monoCount }, (_, i) => ["-map", `[a${i}]`]).flat()]
    : [];
  return [
    "-y",
    ...inputArgs,
    "-i", a.audioWavPath,
    ...captions.inputs,
    ...monoInputs,
    ...captions.outputs,
    ...monoMaps,
    ...withTopFieldFirst(a.color ? colorFilterArgs(a.color) : [...COLOR_PIPELINE_ARGS], planOf(a)),
    ...videoEncodeArgs(pass2 ? { ...planOf(a), pass: { stage: 2, logPrefix: passLogPrefix(a) } } : planOf(a)),
    ...(a.color ? colorTagArgs(a.color) : []),
    ...(a.dolby
      // ac3 / eac3 with the 5.1 relabel, bitrate, sample rate and dialnorm (shared with the audio-only export).
      ? dolbyTrackArgs(a.dolby)
      : [
          "-c:a", audioCodecFor(a),
          ...(a.audioBitrateKbps !== undefined && !usesPcmAudio(a)
            ? ["-b:a", `${clampAudioBitrateKbps(a.audioBitrateKbps)}k`]
            : []),
        ]),
    ...(a.format === "mp4" || a.format === "mov" ? ["-movflags", "+faststart"] : []),
    ...timecodeArgs(a),
    ...explicitMuxerArgs(a.format),
    "-progress", "pipe:2",
    a.outputPath,
  ];
}

export class ExportJob {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private progressBuf = "";
  private stderrTail = "";
  private finished = false;
  private cancelled = false;
  private reported = false;

  constructor(
    private readonly args: ExportArgs,
    private readonly onFrame: (frame: number) => void,
    private readonly onDone: () => void,
    private readonly onError: (msg: string) => void,
  ) {}

  /** 0 = single pass; 1 / 2 = the passes of a two-pass export. */
  private stage: 0 | 1 | 2 = 0;
  private pass1Frames = 0;

  start(): void {
    this.spawnStage(isTwoPass(this.args) ? 1 : 0);
  }

  /** Remove the pass statistics and the intermediate. Safe to call repeatedly. */
  private cleanupPassDir(): void {
    const dir = this.args.passDir;
    if (!dir) return;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      void rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** A frame count on one scale across both passes: pass 1 fills the first half, pass 2 the second. */
  private reportFrame(frame: number): void {
    if (this.stage === 0) {
      this.onFrame(frame);
      return;
    }
    const total = this.args.totalFrames ?? this.pass1Frames;
    if (this.stage === 1) {
      this.pass1Frames = Math.max(this.pass1Frames, frame);
      this.onFrame(Math.round(frame / 2));
    } else {
      this.onFrame(Math.round(total / 2 + frame / 2));
    }
  }

  private spawnStage(stage: 0 | 1 | 2): void {
    this.stage = stage;
    this.progressBuf = "";
    const ffArgs = stage === 1 ? buildPass1Args(this.args) : buildFfmpegArgs(this.args, stage === 2 ? "pass2" : "single");
    const proc = spawn(resolveFfmpegPath(), ffArgs);
    this.proc = proc;
    // Pass 2 reads the intermediate file; nothing is piped in.
    if (stage === 2) proc.stdin.end();
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.progressBuf += text;
      this.stderrTail = (this.stderrTail + text).slice(-4096);
      const parsed = parseProgressBlock(this.progressBuf);
      if (parsed) this.reportFrame(parsed.frame);
      if (this.progressBuf.length > 16384) {
        this.progressBuf = this.progressBuf.slice(-4096);
      }
    });
    // ffmpeg closes its stdin when it exits (an encoder/arg error, or -shortest
    // ending early). Without this handler the next frame write raises EPIPE as an
    // unhandled stream error and crashes the whole main process. Swallow it here;
    // the real outcome (and reason) is reported via the close handler below.
    proc.stdin.on("error", () => {
      this.finished = true;
    });
    // A spawn failure can emit both "error" and "close"; report only the first
    // outcome, and nothing at all once the job was cancelled.
    proc.on("error", (e) => {
      this.finished = true;
      this.report(() => this.onError(e.message));
    });
    proc.on("close", (code) => {
      this.finished = true;
      if (this.cancelled || this.reported) return;
      if (code === 0 && stage === 1) {
        this.stderrTail = "";
        this.spawnStage(2);
      } else if (code === 0) {
        this.report(() => this.onDone());
      } else {
        const detail = this.stderrTail.trim();
        this.report(() =>
          this.onError(`ffmpeg exited with code ${code}${detail ? `: ${detail}` : ""}`),
        );
      }
    });
  }

  private report(fn: () => void): void {
    if (this.cancelled || this.reported) return;
    this.reported = true;
    this.cleanupPassDir();
    fn();
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
    this.cancelled = true;
    this.finished = true;
    this.proc?.kill("SIGKILL");
    this.cleanupPassDir();
  }
}
