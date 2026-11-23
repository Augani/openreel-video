/**
 * Native smart render, audio side. The picture side splices stream-copied and
 * re-encoded runs; this file does the same for sound where the result can be
 * exact:
 *
 *  - AAC: the export's AAC track IS the source's AAC packets (no decode, no
 *    encode) when the cut points sit on 1024-sample frames. A cut inside the
 *    stream carries one extra frame in front as decoder pre-roll, written as
 *    1024 samples of encoder delay in the edit list, so the first sample
 *    decodes exactly as it does in the source. Verified by decoding both.
 *  - PCM: spans that are an untouched source are copied sample for sample
 *    (decoded to 24-bit, which is exact for 16- and 24-bit PCM) and joined with
 *    the rendered mixdown of the other spans in a raw 24-bit stream.
 *
 * Probing uses only the ffmpeg sidecar (no ffprobe ships with the app).
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { resolveFfmpegPath } from "./ffmpeg-path";
import { assertLocalSourcePath } from "./probe-source";

export const AAC_FRAME_SAMPLES = 1024;

/** What ffmpeg says about the first audio stream of a source, from its packet list. */
export interface AudioSourceProbe {
  /** ffmpeg codec name ("aac", "pcm_s16le", "pcm_s24le", "pcm_s16be", "mp3"...). */
  codec: string;
  /** "LC" for AAC-LC; absent for PCM. */
  profile?: string;
  sampleRate: number;
  channels: number;
  /** Decoder sample format ("fltp", "s16", "s32"...). */
  sampleFormat: string;
  bitrateKbps: number;
  /** Presentation time of the first packet in samples; negative = encoder delay trimmed by the container. */
  firstPts: number;
  /** Samples per packet when every packet but the last has the same length, else 0. */
  frameSamples: number;
  packets: number;
  /** End of the last packet in samples (the container's own length of the stream). */
  endSamples: number;
}

function channelCount(text: string): number {
  const named: Record<string, number> = { mono: 1, stereo: 2, "2.1": 3, "3.0": 3, quad: 4, "4.0": 4, "5.0": 5, "5.1": 6, "7.1": 8 };
  if (named[text] !== undefined) return named[text];
  const match = /^(\d+) channels?/.exec(text);
  return match ? Number(match[1]) : 0;
}

/** Parse `ffmpeg -hide_banner -i f -map 0:a:0 -c copy -f framecrc -` (stderr and stdout). Null when there is no audio stream. */
export function parseAudioProbe(stderr: string, framecrc: string): AudioSourceProbe | null {
  const stream = /Audio: ([A-Za-z0-9_]+)(?: \(([^)]*)\))?[^,\n]*, (\d+) Hz, ([^,\n]+), ([A-Za-z0-9]+)(?:\s*\([^)]*\))?(?:, (\d+) kb\/s)?/.exec(stderr);
  const timebase = /#tb 0: 1\/(\d+)/.exec(framecrc);
  if (!stream || !timebase) return null;
  const sampleRate = Number(stream[3]);
  const tb = Number(timebase[1]);
  if (!(sampleRate > 0) || !(tb > 0)) return null;
  const toSamples = (ticks: number): number => (ticks * sampleRate) / tb;
  let packets = 0;
  let firstPts: number | null = null;
  let lastPts = 0;
  let lastDuration = 0;
  let firstDuration = 0;
  let uniform = true;
  let bytes = 0;
  for (const line of framecrc.split("\n")) {
    if (line.startsWith("#")) continue;
    const fields = line.split(",").map((part) => part.trim());
    if (fields.length < 6) continue;
    const pts = Number(fields[2]);
    const duration = Number(fields[3]);
    const size = Number(fields[4]);
    if (!Number.isFinite(pts) || !Number.isFinite(duration)) continue;
    if (firstPts === null) {
      firstPts = pts;
      firstDuration = duration;
    } else if (lastDuration !== firstDuration) {
      uniform = false;
    }
    packets += 1;
    lastPts = pts;
    lastDuration = duration;
    bytes += size;
  }
  if (firstPts === null || packets === 0) return null;
  const end = toSamples(lastPts + lastDuration);
  const start = toSamples(firstPts);
  const lengthSeconds = (end - Math.min(start, 0)) / sampleRate;
  return {
    codec: stream[1],
    profile: stream[2]?.split(" ")[0],
    sampleRate,
    channels: channelCount(stream[4].trim()),
    sampleFormat: stream[5],
    bitrateKbps: stream[6] ? Number(stream[6]) : lengthSeconds > 0 ? Math.round((bytes * 8) / lengthSeconds / 1000) : 0,
    firstPts: start,
    frameSamples: uniform ? toSamples(firstDuration) : 0,
    packets,
    endSamples: end,
  };
}

/** List the packets of the first audio stream with the ffmpeg sidecar. Null when the file has none or ffmpeg cannot read it. */
export function probeAudioSource(sourcePath: string): Promise<AudioSourceProbe | null> {
  return new Promise((resolve) => {
    try {
      assertLocalSourcePath(sourcePath);
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let stderr = "";
    const proc = spawn(resolveFfmpegPath(), ["-hide_banner", "-i", sourcePath, "-map", "0:a:0", "-c", "copy", "-f", "framecrc", "-"]);
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 262144) stderr = stderr.slice(-65536);
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => resolve(parseAudioProbe(stderr, stdout)));
  });
}

export type SmartAudioCodec = "aac" | "pcm";

export interface SmartAudioCopySegment {
  kind: "copy";
  /** Output samples [start, end). */
  start: number;
  end: number;
  sourcePath: string;
  /** Sample of the source's decoded audio (container trim applied) that plays at output sample `start`. */
  sourceStart: number;
  /** AAC: the source's encoder delay in samples (negative first packet time). */
  priming?: number;
  sourceSize?: number;
  sourceMtimeMs?: number;
  sourceContentHash?: string;
}

export interface SmartAudioEncodeSegment {
  kind: "encode";
  start: number;
  end: number;
}

export type SmartAudioSegment = SmartAudioCopySegment | SmartAudioEncodeSegment;

/** The audio plan the renderer sends once the job exists; segments tile [0, totalSamples). */
export interface SmartAudioCopyPlan {
  codec: SmartAudioCodec;
  sampleRate: number;
  channels: number;
  totalSamples: number;
  segments: SmartAudioSegment[];
}

/** Shape check for a plan that crossed the IPC boundary: segments tile the output exactly and AAC is one whole copy. */
export function validateAudioPlan(plan: SmartAudioCopyPlan): string | null {
  if (!Number.isInteger(plan.totalSamples) || plan.totalSamples <= 0) return "audio plan has no samples";
  if (plan.channels !== 2) return "audio copy handles stereo only";
  let cursor = 0;
  for (const segment of plan.segments) {
    if (!Number.isInteger(segment.start) || !Number.isInteger(segment.end) || segment.start !== cursor || segment.end <= segment.start) {
      return "audio plan segments do not tile the output";
    }
    cursor = segment.end;
    if (segment.kind === "copy") {
      assertLocalSourcePath(segment.sourcePath);
      if (!Number.isInteger(segment.sourceStart) || segment.sourceStart < 0) return "audio plan has a bad source offset";
    }
  }
  if (cursor !== plan.totalSamples) return "audio plan does not cover the output";
  if (plan.codec === "aac") {
    const [only] = plan.segments;
    if (plan.segments.length !== 1 || only.kind !== "copy") return "AAC is copied whole or not at all";
    const priming = only.priming ?? 0;
    if (!Number.isInteger(priming) || priming < 0) return "AAC copy needs the source's encoder delay";
    if (only.sourceStart > 0 && (only.sourceStart + priming) % AAC_FRAME_SAMPLES !== 0) return "AAC copy must start on a frame boundary";
    if ((only.sourceStart + plan.totalSamples + priming) % AAC_FRAME_SAMPLES !== 0) return "AAC copy must end on a frame boundary";
  }
  return null;
}

/** Seconds as ffmpeg prints them: microsecond precision. */
const sec = (value: number): string => value.toFixed(6);

export interface AacCopyArgs {
  args: string[];
  /** Source packet index the copy starts at (the pre-roll packet when the cut is inside the stream). */
  firstPacket: number;
  packets: number;
}

/**
 * ffmpeg arguments that write the AAC packets of `segment` into an MP4 whose
 * decoded audio is source samples [sourceStart, sourceStart + samples), with
 * one frame of pre-roll in front of a mid-stream cut (the edit list trims it).
 * The movie timescale is the sample rate so the edit list is exact to the sample.
 */
export function buildAacCopyArgs(segment: SmartAudioCopySegment, sampleRate: number, outputPath: string): AacCopyArgs {
  const priming = segment.priming ?? 0;
  const samples = segment.end - segment.start;
  const endPacket = (segment.sourceStart + samples + priming) / AAC_FRAME_SAMPLES;
  const midStream = segment.sourceStart > 0;
  const firstPacket = midStream ? (segment.sourceStart + priming) / AAC_FRAME_SAMPLES - 1 : 0;
  const packets = endPacket - firstPacket;
  const head = ["-y", "-v", "error"];
  const tail = ["-map", "0:a:0", "-c", "copy", "-frames:a", String(packets), "-movie_timescale", String(sampleRate), "-f", "mp4", outputPath];
  if (!midStream) return { args: [...head, "-i", segment.sourcePath, ...tail], firstPacket, packets };
  // Packet i of the source starts at (i * 1024 - priming) / rate. Output-side -ss drops everything before the pre-roll packet
  // (half a frame of slack so microsecond rounding cannot drop it) and shifts the kept packets back by that start, so the
  // pre-roll packet lands half a frame late; the output offset then gives it the time -1024: a one-frame encoder delay,
  // which the MP4 muxer writes as the edit list's start.
  const preRollTime = (firstPacket * AAC_FRAME_SAMPLES - priming) / sampleRate;
  return {
    args: [
      ...head,
      "-i", segment.sourcePath,
      "-ss", sec(preRollTime - 512 / sampleRate),
      "-output_ts_offset", sec(-(AAC_FRAME_SAMPLES + 512) / sampleRate),
      ...tail,
    ],
    firstPacket,
    packets,
  };
}

/**
 * ffmpeg arguments that decode source samples [start, start + samples) of a PCM stream to raw 24-bit little-endian stereo.
 * The window is cut by sample count from the start of the decode (not a time seek, whose rounding differs between ffmpeg
 * versions); PCM decodes far faster than it plays, so reading up to `start` costs little.
 */
export function buildPcmExtractArgs(sourcePath: string, start: number, samples: number, outputPath: string): string[] {
  return [
    "-y", "-v", "error",
    "-i", sourcePath,
    "-map", "0:a:0",
    "-af", `atrim=start_sample=${start}:end_sample=${start + samples}`,
    "-c:a", "pcm_s24le",
    "-f", "s24le",
    outputPath,
  ];
}

function runFfmpeg(args: string[], capture?: "stdout"): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpegPath(), args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4096);
    });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg exited with code ${code}${err.trim() ? `: ${err.trim()}` : ""}`))));
  });
}

/** MD5 of decoded audio (32-bit float), optionally of an exact sample window of the decode. */
async function decodedMd5(file: string, window?: { start: number; end: number }): Promise<string> {
  const filter = window ? ["-af", `atrim=start_sample=${window.start}:end_sample=${window.end}`] : [];
  const out = await runFfmpeg(["-v", "error", "-i", file, "-map", "0:a:0", ...filter, "-c:a", "pcm_f32le", "-f", "md5", "-"], "stdout");
  return out.trim();
}

/**
 * Write the AAC copy and prove it. A copy that starts at the stream's first
 * sample is the source's own packet sequence and decodes identically by
 * construction; a mid-stream copy is decoded and compared with the same window
 * of the source (an encoder tool with decoder state beyond the previous frame,
 * such as noise substitution, makes the two differ, and then the audio is
 * re-encoded instead). Returns null when the copy is exact, else why not.
 */
export async function writeAacCopy(segment: SmartAudioCopySegment, sampleRate: number, outputPath: string): Promise<string | null> {
  const { args } = buildAacCopyArgs(segment, sampleRate, outputPath);
  await runFfmpeg(args);
  if (segment.sourceStart === 0) return null;
  const samples = segment.end - segment.start;
  const [copied, original] = await Promise.all([
    decodedMd5(outputPath),
    decodedMd5(segment.sourcePath, { start: segment.sourceStart, end: segment.sourceStart + samples }),
  ]);
  return copied === original ? null : "the AAC stream's decoder carries state across frames (noise substitution or prediction), so a cut inside it does not decode like the source";
}

/** Extract a PCM copy segment as raw 24-bit stereo and check its length. */
export async function writePcmCopy(segment: SmartAudioCopySegment, outputPath: string): Promise<string | null> {
  const samples = segment.end - segment.start;
  await runFfmpeg(buildPcmExtractArgs(segment.sourcePath, segment.sourceStart, samples, outputPath));
  const { size } = await fs.stat(outputPath);
  return size === samples * 2 * 3 ? null : `the PCM copy has ${size / 6} of ${samples} samples`;
}

/** Bytes of a 16-bit stereo WAV header written by the renderer (buildWavHeader). */
export const WAV_HEADER_BYTES = 44;

function appendFile(from: string, sink: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    const input = createReadStream(from);
    input.on("error", reject);
    input.on("end", resolve);
    input.pipe(sink, { end: false });
  });
}

/** Append `samples` stereo frames of the 16-bit mixdown WAV, starting at frame `start`, to `sink` as 24-bit (the 16-bit value in the top bytes, as ffmpeg's s16 to s24 conversion does). */
function appendWavAs24(wavPath: string, start: number, samples: number, sink: ReturnType<typeof createWriteStream>): Promise<void> {
  const bytesPerFrame = 4;
  return new Promise((resolve, reject) => {
    const input = createReadStream(wavPath, { start: WAV_HEADER_BYTES + start * bytesPerFrame, end: WAV_HEADER_BYTES + (start + samples) * bytesPerFrame - 1, highWaterMark: 1 << 20 });
    let carry = Buffer.alloc(0);
    let frames = 0;
    input.on("error", reject);
    input.on("data", (chunk: string | Buffer) => {
      const data = Buffer.concat([carry, chunk as Buffer]);
      const whole = data.length - (data.length % 2);
      carry = data.subarray(whole);
      const out = Buffer.allocUnsafe((whole / 2) * 3);
      for (let i = 0, o = 0; i < whole; i += 2, o += 3) {
        out[o] = 0;
        out[o + 1] = data[i];
        out[o + 2] = data[i + 1];
      }
      frames += whole / 4;
      if (!sink.write(out)) {
        input.pause();
        sink.once("drain", () => input.resume());
      }
    });
    input.on("end", () => {
      // The renderer's WAV may end early (silence it never wrote): pad with zeros so the spans stay in place.
      const missing = samples - frames;
      if (missing > 0) sink.write(Buffer.alloc(missing * 6));
      resolve();
    });
  });
}

/**
 * Build the raw 24-bit stereo track of a PCM plan: copied spans come from the
 * prepared per-segment files, the others from the rendered 16-bit mixdown.
 */
export async function joinPcmTrack(
  plan: SmartAudioCopyPlan,
  copyFiles: ReadonlyMap<number, string>,
  wavPath: string | null,
  outputPath: string,
): Promise<void> {
  const sink = createWriteStream(outputPath);
  const failed = new Promise<never>((_, reject) => sink.on("error", reject));
  const work = (async () => {
    for (const [index, segment] of plan.segments.entries()) {
      if (segment.kind === "copy") {
        const file = copyFiles.get(index);
        if (!file) throw new Error("a prepared audio copy is missing");
        await appendFile(file, sink);
      } else {
        if (!wavPath) throw new Error("the rendered audio is missing");
        await appendWavAs24(wavPath, segment.start, segment.end - segment.start, sink);
      }
    }
    await new Promise<void>((resolve, reject) => sink.end((error?: Error | null) => (error ? reject(error) : resolve())));
  })();
  try {
    await Promise.race([work, failed]);
  } catch (error) {
    sink.destroy();
    throw error;
  }
}
