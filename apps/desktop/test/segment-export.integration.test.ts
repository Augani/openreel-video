import { vi } from "vitest";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

vi.mock("../src/main/sidecar/ffmpeg-path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/sidecar/ffmpeg-path")>();
  const bin = path.resolve(__dirname, "../resources/bin", actual.ffmpegRelativePath(process.platform, process.arch));
  return { ...actual, resolveFfmpegPath: () => bin };
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { existsSync, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExportJob, type ExportArgs } from "../src/main/sidecar/export-job";
import { buildSegmentArgs } from "../src/main/sidecar/segment-args";
import { SegmentSession, type SessionSegment } from "../src/main/sidecar/segment-session";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";

const run = promisify(execFile);
const ffmpegBin = path.resolve(__dirname, "../resources/bin", `${process.platform}-${process.arch}/${process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"}`);
const HAS_FFMPEG = existsSync(ffmpegBin);
const W = 320;
const H = 180;
const FPS = 30;
const FRAMES = 150;
let wavPath = "";

/** A deterministic, busy picture: a moving gradient with per-frame texture, so every frame differs. */
function frameBytes(index: number): Uint8Array {
  const data = new Uint8Array(W * H * 4);
  let seed = 0x9e3779b1 ^ index;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const o = (y * W + x) * 4;
      data[o] = (x + index * 3) & 255;
      data[o + 1] = (y * 2 + index) & 255;
      data[o + 2] = ((x ^ y) + (seed >>> 28)) & 255;
      data[o + 3] = 255;
    }
  }
  return data;
}

function baseArgs(dir: string, over: Partial<ExportArgs>): ExportArgs {
  return {
    width: W,
    height: H,
    frameRate: FPS,
    codec: "h264",
    encoder: "libx264",
    mode: "balanced",
    quality: 80,
    bitrateKbps: 0,
    totalFrames: FRAMES,
    outputPath: path.join(dir, "out.mp4"),
    audioWavPath: path.join(dir, "audio.wav"),
    format: "mp4",
    keyframeInterval: 30,
    audioBitrateKbps: 128,
    ...over,
  };
}

function encodeJob(args: ExportArgs, frames: readonly number[], buildArgs?: (a: ExportArgs) => string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let last = 0;
    const job = new ExportJob(args, (frame) => (last = frame), () => resolve(last), reject, buildArgs);
    job.start();
    void (async () => {
      for (const index of frames) await job.writeFrame(frameBytes(index));
      job.endInput();
    })().catch(reject);
  });
}

async function frameHashes(file: string): Promise<string[]> {
  const { stdout } = await run(resolveFfmpegPath(), ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.split("\n").filter((line) => line && !line.startsWith("#")).map((line) => line.split(",").pop()!.trim());
}

async function audioHash(file: string): Promise<string> {
  const { stdout } = await run(resolveFfmpegPath(), ["-v", "error", "-i", file, "-map", "0:a:0", "-c", "copy", "-f", "md5", "-"]);
  return stdout.trim();
}

async function startTimes(file: string): Promise<{ video: number; audio: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "json", file]);
  const streams = (JSON.parse(stdout) as { streams: Array<{ codec_type: string; start_time: string }> }).streams;
  const pick = (type: string): number => Number(streams.find((s) => s.codec_type === type)?.start_time ?? NaN);
  return { video: pick("video"), audio: pick("audio") };
}

async function keyFrameIndexes(file: string): Promise<number[]> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=key_frame", "-of", "default=noprint_wrappers=1:nokey=1", file], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean).flatMap((line, i) => (line.trim() === "1" ? [i] : []));
}

async function psnr(a: string, b: string): Promise<number> {
  const { stderr } = await run(resolveFfmpegPath(), ["-v", "info", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"]);
  const match = /average:([\d.]+|inf)/.exec(stderr);
  return match ? (match[1] === "inf" ? Infinity : Number(match[1])) : NaN;
}

const SEGMENTS: SessionSegment[] = [
  { index: 0, startFrame: 0, endFrame: 47 },
  { index: 1, startFrame: 47, endFrame: 101 },
  { index: 2, startFrame: 101, endFrame: 150 },
];

/** Encode the plan with `concurrency` segments at once and join. */
async function segmented(dir: string, over: Partial<ExportArgs>, concurrency: number): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const args = baseArgs(dir, { audioWavPath: wavPath, ...over });
  const session = new SegmentSession({ args, segments: SEGMENTS, dir });
  const workers = Array.from({ length: concurrency }, async () => {
    for (let segment = session.take(); segment; segment = session.take()) {
      const frames = Array.from({ length: segment.endFrame - segment.startFrame }, (_, i) => segment.startFrame + i);
      const done = await encodeJob(session.argsFor(segment), frames, buildSegmentArgs);
      session.complete(segment.index, done);
    }
  });
  await Promise.all(workers);
  await session.assemble();
  return args.outputPath;
}

describe.skipIf(!HAS_FFMPEG)("parallel segment export (real ffmpeg)", () => {
  let root: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), "openreel-segments-"));
    wavPath = path.join(root, "audio.wav");
    // 5 s of a 440 Hz tone: one audio track for the whole timeline.
    await run(resolveFfmpegPath(), ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5:sample_rate=48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(root, "audio.wav")]);
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("ProRes: three concurrent segments are frame-for-frame identical to the serial export, with the same audio", async () => {
    const serialDir = path.join(root, "prores-serial");
    await fs.mkdir(serialDir, { recursive: true });
    const over: Partial<ExportArgs> = { codec: "prores", encoder: "prores_ks", format: "mov", proresProfile: "standard", keyframeInterval: undefined };
    const serialArgs = baseArgs(serialDir, { ...over, audioWavPath: wavPath, outputPath: path.join(serialDir, "out.mov") });
    await encodeJob(serialArgs, Array.from({ length: FRAMES }, (_, i) => i));
    const parallel = await segmented(path.join(root, "prores-par", "seg"), { ...over, outputPath: path.join(root, "prores-par", "out.mov") }, 3);

    const serialHashes = await frameHashes(serialArgs.outputPath);
    const parallelHashes = await frameHashes(parallel);
    expect(serialHashes).toHaveLength(FRAMES);
    expect(parallelHashes).toHaveLength(FRAMES);
    expect(parallelHashes).toEqual(serialHashes);
    expect(await audioHash(parallel)).toBe(await audioHash(serialArgs.outputPath));
  }, 120_000);

  it("H.264: running the plan concurrently or one segment at a time gives the same frames, key frames sit on the boundaries", async () => {
    const over: Partial<ExportArgs> = { keyframeInterval: 30 };
    const a = await segmented(path.join(root, "h264-par", "seg"), { ...over, outputPath: path.join(root, "h264-par", "out.mp4") }, 3);
    const b = await segmented(path.join(root, "h264-one", "seg"), { ...over, outputPath: path.join(root, "h264-one", "out.mp4") }, 1);

    const hashesA = await frameHashes(a);
    expect(hashesA).toHaveLength(FRAMES);
    expect(await frameHashes(b)).toEqual(hashesA);
    expect(await audioHash(a)).toBe(await audioHash(b));

    // The joined file decodes without a single error.
    const decode = await run(resolveFfmpegPath(), ["-v", "error", "-i", a, "-f", "null", "-"]);
    expect(decode.stderr.trim()).toBe("");
    const keys = await keyFrameIndexes(a);
    for (const segment of SEGMENTS) expect(keys).toContain(segment.startFrame);
  }, 120_000);

  it("H.264: no duplicate or missing frames and the audio starts with the picture, close to the single-stream encode", async () => {
    const serialDir = path.join(root, "h264-serial");
    await fs.mkdir(serialDir, { recursive: true });
    const serialArgs = baseArgs(serialDir, { audioWavPath: wavPath, keyframeInterval: 30 });
    await encodeJob(serialArgs, Array.from({ length: FRAMES }, (_, i) => i));
    const parallel = path.join(root, "h264-par", "out.mp4");

    const { stdout } = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "json", parallel]);
    const info = (JSON.parse(stdout) as { streams: Array<{ nb_read_frames: string; r_frame_rate: string }> }).streams[0];
    expect(Number(info.nb_read_frames)).toBe(FRAMES);
    expect(info.r_frame_rate).toBe("30/1");

    // Presentation times are the frame grid: one frame period apart, from the first frame to the last.
    const { stdout: pts } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "default=noprint_wrappers=1:nokey=1", parallel], { maxBuffer: 16 * 1024 * 1024 });
    const times = pts.split("\n").filter(Boolean).map(Number).sort((x, y) => x - y);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(1 / FPS, 4);

    const parallelStart = await startTimes(parallel);
    const serialStart = await startTimes(serialArgs.outputPath);
    expect(Math.abs(parallelStart.video - parallelStart.audio)).toBeLessThan(1 / FPS);
    expect(Math.abs(parallelStart.video - serialStart.video)).toBeLessThan(1 / FPS);
    expect(await psnr(parallel, serialArgs.outputPath)).toBeGreaterThan(30);
  }, 120_000);

  it("refuses a segment that holds the wrong number of frames", () => {
    const session = new SegmentSession({ args: baseArgs(root, {}), segments: SEGMENTS, dir: root });
    expect(() => session.complete(1, 53)).toThrow(/holds 53 of 54 frames/);
  });

  it("refuses segments that leave a gap or overlap", () => {
    expect(() => new SegmentSession({ args: baseArgs(root, {}), segments: [{ index: 0, startFrame: 0, endFrame: 60 }, { index: 1, startFrame: 61, endFrame: 150 }], dir: root })).toThrow(/do not tile/);
    expect(() => new SegmentSession({ args: baseArgs(root, {}), segments: [{ index: 0, startFrame: 0, endFrame: 100 }], dir: root })).toThrow(/100 of 150/);
  });

  it("will not join until every segment finished", async () => {
    const session = new SegmentSession({ args: baseArgs(root, {}), segments: SEGMENTS, dir: root });
    session.complete(0, 47);
    await expect(session.assemble()).rejects.toThrow(/Not every segment/);
  });
});
