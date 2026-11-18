import { vi } from "vitest";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

vi.mock("../src/main/sidecar/ffmpeg-path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/sidecar/ffmpeg-path")>();
  const bin = path.resolve(__dirname, "../resources/bin", actual.ffmpegRelativePath(process.platform, process.arch));
  return { ...actual, resolveFfmpegPath: () => bin };
});

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import { probeSource } from "../src/main/sidecar/probe-source";
import { SmartExportSession } from "../src/main/sidecar/smart-export";
// @ts-expect-error plain ESM helper shared with scripts/export-check.mjs
import { checkTimeline, decodeErrors, framePsnr, probeVideoPackets, sampleIndexes, seekDecodes, summarizePsnr } from "../scripts/lib/verify-video.mjs";

const ffmpeg = resolveFfmpegPath();
const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const available = existsSync(ffmpeg) && existsSync(ffprobe);
const work = mkdtempSync(path.join(tmpdir(), "oreel-smart-export-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FPS_NUM = 30000;
const FPS_DEN = 1001;
const FPS = FPS_NUM / FPS_DEN;
const GOP = 60;
const W = 640;
const H = 360;
const FRAMES = 300;

function run(args: string[]): void {
  execFileSync(ffmpeg, ["-y", "-v", "error", ...args], { maxBuffer: 1 << 28 });
}

/** Decode a range of source frames as raw RGBA: what the renderer would hand the encoder. */
function rgbaFrames(src: string, from: number, to: number): Uint8Array[] {
  const out = execFileSync(
    ffmpeg,
    ["-v", "error", "-i", src, "-vf", `select=between(n\\,${from}\\,${to - 1})`, "-vsync", "0", "-pix_fmt", "rgba", "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 30 },
  );
  const size = W * H * 4;
  const frames: Uint8Array[] = [];
  for (let i = 0; i + size <= out.length; i += size) frames.push(new Uint8Array(out.subarray(i, i + size)));
  return frames;
}

/** Colour matrix tag of every decoded frame, de-duplicated. */
function frameMatrices(file: string): string[] {
  const out = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v", "-show_entries", "frame=color_space", "-of", "csv=p=0", file], { encoding: "utf8" });
  return [...new Set(out.split("\n").map((l) => l.trim().replace(/,$/, "")).filter(Boolean))];
}

describe.skipIf(!available)("native smart render (real ffmpeg)", () => {
  const wav = path.join(work, "audio.wav");

  it.each([
    ["BT.709", "bt709"],
    ["BT.601", "smpte170m"],
  ])("joins re-encoded and stream-copied runs into a frame-accurate file (%s source)", async (_label, matrix) => {
    const src = path.join(work, `src-${matrix}.mp4`);
    run([
      "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS_NUM}/${FPS_DEN}:duration=11`,
      "-c:v", "libx264", "-g", String(GOP), "-keyint_min", String(GOP), "-sc_threshold", "0", "-bf", "3",
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "3.1",
      "-colorspace", matrix, "-color_range", "tv", src,
    ]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10.02", wav]);

    // The native muxer asks ffmpeg how the source decodes and tags the re-encoded runs the same way.
    const probe = await probeSource(src);
    expect(probe).toMatchObject({ codec: "h264", pixelFormat: "yuv420p", color: { range: "tv", matrix } });

    const out = path.join(work, `smart-${matrix}.mp4`);
    const session = new SmartExportSession({
      args: {
        width: W, height: H, frameRate: FPS, codec: "h264", encoder: "libx264", mode: "fast", quality: 80,
        bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mp4", keyframeInterval: GOP,
      },
      match: { codec: "avc", profile: 100, level: 31, color: probe!.color, frameRate: FPS },
      videoPath: path.join(work, `video-${matrix}.ts`),
      totalFrames: FRAMES,
    });

    // frames 0-59 and 180-299 are re-encoded, 60-179 are copied (source key frames at 60 and 180)
    const first = rgbaFrames(src, 0, 60);
    await session.beginEncodeRun(0);
    for (const f of first) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(60);
    expect(await session.copyRun({ sourcePath: src, sourceStart: (60 * FPS_DEN) / FPS_NUM, outputStartFrame: 60, frames: 120, frameRate: FPS })).toBe(120);
    const last = rgbaFrames(src, 180, 300);
    await session.beginEncodeRun(180);
    for (const f of last) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(120);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mp4" });
    await session.dispose();

    const packets = probeVideoPackets(ffprobe, out);
    const timeline = checkTimeline(packets, { frames: FRAMES, fps: FPS, expectedKeyframes: [0, 60, 180] });
    expect(timeline.problems).toEqual([]);
    expect(decodeErrors(ffmpeg, out)).toBe("");
    expect(seekDecodes(ffmpeg, out, [0, 2.1, 3.5, 6.2, 9.5])).toEqual([]);

    // Copied frames are bit-exact; re-encoded ones are close to the source (a wrong matrix would be ~20 dB).
    const psnr = framePsnr(ffmpeg, out, src, { width: W, height: H, indexes: sampleIndexes(FRAMES, FRAMES) });
    expect(summarizePsnr(psnr, 60, 180).min).toBeGreaterThanOrEqual(99);
    expect(summarizePsnr(psnr, 0, 60).min).toBeGreaterThan(38);
    expect(summarizePsnr(psnr, 180, 300).min).toBeGreaterThan(38);

    // Every frame, copied or re-encoded, decodes with the source's colour matrix.
    expect(frameMatrices(out)).toEqual([matrix]);

    // Stream parameters match the source, audio is present.
    const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", out], { encoding: "utf8" }));
    const video = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    expect(video.profile).toBe("High");
    expect(video.r_frame_rate).toBe("30000/1001");
    expect(video.nb_frames).toBe(String(FRAMES));
    expect(info.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(true);
  }, 120_000);

  it("joins runs encoded by the hardware encoder (VideoToolbox) too", async () => {
    const encoders = execFileSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (!/h264_videotoolbox/.test(encoders)) return;
    const src = path.join(work, "src-vt.mp4");
    run([
      "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS_NUM}/${FPS_DEN}:duration=11`,
      "-c:v", "libx264", "-g", String(GOP), "-keyint_min", String(GOP), "-sc_threshold", "0", "-bf", "2",
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-colorspace", "bt709", "-color_range", "tv", src,
    ]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10.02", wav]);
    const probe = await probeSource(src);
    const out = path.join(work, "smart-vt.mp4");
    const session = new SmartExportSession({
      args: {
        width: W, height: H, frameRate: FPS, codec: "h264", encoder: "h264_videotoolbox", mode: "balanced", quality: 80,
        bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mp4", keyframeInterval: GOP,
      },
      match: { codec: "avc", profile: 100, level: 31, color: probe!.color, frameRate: FPS },
      videoPath: path.join(work, "video-vt.ts"),
      totalFrames: FRAMES,
    });
    await session.beginEncodeRun(0);
    for (const f of rgbaFrames(src, 0, 60)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(60);
    expect(await session.copyRun({ sourcePath: src, sourceStart: (60 * FPS_DEN) / FPS_NUM, outputStartFrame: 60, frames: 120, frameRate: FPS })).toBe(120);
    await session.beginEncodeRun(180);
    for (const f of rgbaFrames(src, 180, 300)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(120);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mp4" });
    await session.dispose();
    const timeline = checkTimeline(probeVideoPackets(ffprobe, out), { frames: FRAMES, fps: FPS, expectedKeyframes: [0, 60, 180] });
    expect(timeline.problems).toEqual([]);
    expect(decodeErrors(ffmpeg, out)).toBe("");
    const psnr = framePsnr(ffmpeg, out, src, { width: W, height: H, indexes: sampleIndexes(FRAMES, FRAMES) });
    expect(summarizePsnr(psnr, 60, 180).min).toBeGreaterThanOrEqual(99);
    expect(summarizePsnr(psnr, 0, 60).min).toBeGreaterThan(30);
  }, 120_000);

  it("joins HEVC runs the same way (hvc1 in MP4)", async () => {
    const encoders = execFileSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (!/libx265/.test(encoders)) return;
    const src = path.join(work, "src-hevc.mp4");
    run([
      "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS_NUM}/${FPS_DEN}:duration=11`,
      "-c:v", "libx265", "-preset", "veryfast", "-x265-params", `keyint=${GOP}:min-keyint=${GOP}:scenecut=0:open-gop=0:log-level=error`,
      "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-colorspace", "bt709", "-color_range", "tv", src,
    ]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10.02", wav]);
    const probe = await probeSource(src);
    expect(probe).toMatchObject({ codec: "hevc", pixelFormat: "yuv420p" });

    const out = path.join(work, "smart-hevc.mp4");
    const session = new SmartExportSession({
      args: {
        width: W, height: H, frameRate: FPS, codec: "hevc", encoder: "libx265", mode: "fast", quality: 80,
        bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mp4", keyframeInterval: GOP,
      },
      match: { codec: "hevc", profile: 1, level: 93, color: probe!.color, frameRate: FPS },
      videoPath: path.join(work, "video-hevc.ts"),
      totalFrames: FRAMES,
    });
    await session.beginEncodeRun(0);
    for (const f of rgbaFrames(src, 0, 60)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(60);
    expect(await session.copyRun({ sourcePath: src, sourceStart: (60 * FPS_DEN) / FPS_NUM, outputStartFrame: 60, frames: 120, frameRate: FPS })).toBe(120);
    await session.beginEncodeRun(180);
    for (const f of rgbaFrames(src, 180, 300)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(120);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mp4" });
    await session.dispose();

    const timeline = checkTimeline(probeVideoPackets(ffprobe, out), { frames: FRAMES, fps: FPS, expectedKeyframes: [0, 60, 180] });
    expect(timeline.problems).toEqual([]);
    expect(decodeErrors(ffmpeg, out)).toBe("");
    const psnr = framePsnr(ffmpeg, out, src, { width: W, height: H, indexes: sampleIndexes(FRAMES, FRAMES) });
    expect(summarizePsnr(psnr, 60, 180).min).toBeGreaterThanOrEqual(99);
    expect(summarizePsnr(psnr, 0, 60).min).toBeGreaterThan(36);
    const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", out], { encoding: "utf8" }));
    const video = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    expect(video.codec_tag_string).toBe("hvc1");
  }, 180_000);
});
