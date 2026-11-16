/**
 * Sources whose container start_time / first PTS is not zero (camera files with an edit-list or
 * timecode offset, MPEG-TS style 1.4 s origins). The renderer's media time is the stream's own PTS
 * (see the mediabunny frame decoder), so a copy run's source range is in that time base; the native
 * copy must still land every copied frame on its output frame (no shift, gap or duplicate) and the
 * key frame guard must find the key frame at the offset PTS.
 */
import { vi } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("../src/main/sidecar/ffmpeg-path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/sidecar/ffmpeg-path")>();
  const sidecar = path.resolve(__dirname, "../resources/bin", actual.ffmpegRelativePath(process.platform, process.arch));
  const bin = process.env.OPENREEL_FFMPEG_PATH ?? (existsSync(sidecar) ? sidecar : "/opt/homebrew/bin/ffmpeg");
  return { ...actual, resolveFfmpegPath: () => bin };
});

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import { SmartExportSession } from "../src/main/sidecar/smart-export";
import { keyFrameIndexMismatch } from "../src/main/sidecar/source-guard";
// @ts-expect-error plain ESM helper shared with scripts/export-check.mjs
import { checkTimeline, decodeErrors, framePsnr, probeVideoPackets, sampleIndexes, seekDecodes, summarizePsnr } from "../scripts/lib/verify-video.mjs";

const ffmpeg = resolveFfmpegPath();
const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const available = existsSync(ffmpeg) && existsSync(ffprobe);
const work = mkdtempSync(path.join(tmpdir(), "oreel-smart-offset-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FPS_NUM = 30000;
const FPS_DEN = 1001;
const FPS = FPS_NUM / FPS_DEN;
const W = 640;
const H = 360;
const FRAMES = 300;
// A 1 s GOP, shorter than the 1.4 s start offset: a seek that wrongly adds the start time lands a whole GOP late.
const KEY = 30;
const CUT = 60;
const frameAt = (n: number) => (n * FPS_DEN) / FPS_NUM;

const run = (args: string[]) => execFileSync(ffmpeg, ["-y", "-v", "error", ...args], { maxBuffer: 1 << 28 });
const lavfi = ["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS_NUM}/${FPS_DEN}:duration=11`];
const x264 = ["-c:v", "libx264", "-g", String(KEY), "-keyint_min", String(KEY), "-sc_threshold", "0", "-bf", "3", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

function rgbaFrames(src: string, from: number, to: number): Uint8Array[] {
  const out = execFileSync(ffmpeg, ["-v", "error", "-i", src, "-vf", `select=between(n\\,${from}\\,${to - 1})`, "-vsync", "0", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 30 });
  const size = W * H * 4;
  const frames: Uint8Array[] = [];
  for (let i = 0; i + size <= out.length; i += size) frames.push(new Uint8Array(out.subarray(i, i + size)));
  return frames;
}

function videoPackets(file: string): Array<{ pts: number; key: boolean }> {
  const text = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", file], { encoding: "utf8" });
  return text.split("\n").filter(Boolean).map((line) => {
    const [pts, flags] = line.split(",");
    return { pts: Number(pts), key: flags.includes("K") };
  });
}
const firstVideoPts = (file: string): number => Math.min(...videoPackets(file).map((p) => p.pts));
/** Presentation times of the key frames, ascending: what the renderer's scan records and the planner copies from. */
const keyFramePts = (file: string): number[] => videoPackets(file).filter((p) => p.key).map((p) => p.pts).sort((a, b) => a - b);

describe.skipIf(!available)("native smart render of a source with a nonzero start time (real ffmpeg)", () => {
  // 42 frames ~ 1.4 s: a frame-aligned origin, as an edit list / timecode offset / TS source produces.
  const ORIGIN_FRAMES = 42;
  const OFFSET = frameAt(ORIGIN_FRAMES);
  const plain = path.join(work, "plain.mp4");
  const shifted = path.join(work, "shifted.mp4");
  const wav = path.join(work, "a.wav");

  it("the fixture really starts later than zero and has its key frames shifted with it", () => {
    run([...lavfi, ...x264, plain]);
    run([...lavfi, ...x264, "-output_ts_offset", OFFSET.toFixed(6), "-muxdelay", "0", shifted]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10.02", wav]);
    expect(firstVideoPts(plain)).toBeCloseTo(0, 3);
    expect(firstVideoPts(shifted)).toBeCloseTo(OFFSET, 3);
  });

  it("the key frame guard finds the key frame at the offset presentation time", async () => {
    const keys = keyFramePts(shifted);
    expect(keys[0]).toBeCloseTo(OFFSET, 3);
    for (const key of keys.slice(0, 4)) expect(await keyFrameIndexMismatch(shifted, key, FPS), `key frame at ${key}`).toBeNull();
    expect(await keyFrameIndexMismatch(shifted, keys[1] + frameAt(7), FPS)).toMatch(/key frame index changed/);
    // The same time in the zero-based file is not a key frame of the shifted one.
    expect(await keyFrameIndexMismatch(shifted, frameAt(KEY), FPS)).toMatch(/key frame index changed|no key frame/);
    // Before the first frame there is nothing to copy from.
    expect(await keyFrameIndexMismatch(shifted, 0, FPS)).not.toBeNull();
  });

  it("copies frames 60-239 from the shifted source on the exact output frames", async () => {
    const out = path.join(work, "smart-shifted.mp4");
    const session = new SmartExportSession({
      args: { width: W, height: H, frameRate: FPS, codec: "avc", encoder: "libx264", mode: "balanced", quality: 80, bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mp4", keyframeInterval: KEY },
      match: { codec: "avc", profile: 100, level: 31, color: { matrix: "bt709" }, frameRate: FPS },
      videoPath: path.join(work, "video-shifted.ts"),
      totalFrames: FRAMES,
    });
    // frames 0-59 re-encoded (source frames 0-59 decoded through its own timeline), 60-239 copied from
    // the key frames at OFFSET + 60/fps .. OFFSET + 240/fps, 240-299 re-encoded.
    await session.beginEncodeRun(0);
    for (const f of rgbaFrames(shifted, 0, 60)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(60);
    expect(await session.copyRun({ sourcePath: shifted, sourceStart: keyFramePts(shifted)[CUT / KEY], outputStartFrame: CUT, frames: 180, frameRate: FPS })).toBe(180);
    await session.beginEncodeRun(240);
    for (const f of rgbaFrames(shifted, 240, 300)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(60);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mp4" });
    await session.dispose();

    const packets = probeVideoPackets(ffprobe, out);
    expect(checkTimeline(packets, { frames: FRAMES, fps: FPS }).problems).toEqual([]);
    expect(decodeErrors(ffmpeg, out)).toBe("");
    expect(seekDecodes(ffmpeg, out, [0, 2.5, 4, 6.2, 9.5])).toEqual([]);
    // Frame i of the output is frame i of the source (the source's own frames, in order): copied frames identical.
    const psnr = framePsnr(ffmpeg, out, plain, { width: W, height: H, indexes: sampleIndexes(FRAMES, FRAMES) });
    expect(summarizePsnr(psnr, CUT, 240).min).toBeGreaterThanOrEqual(99);
    expect(summarizePsnr(psnr, 0, CUT).min).toBeGreaterThan(38);
    expect(summarizePsnr(psnr, 240, FRAMES).min).toBeGreaterThan(38);
    // The frame on each side of both cuts, one by one.
    for (const index of [CUT - 1, CUT, 239, 240]) {
      const one = framePsnr(ffmpeg, out, plain, { width: W, height: H, indexes: [index] });
      expect(summarizePsnr(one, index, index + 1).min, `frame ${index}`).toBeGreaterThan(38);
    }
  }, 180_000);
});
