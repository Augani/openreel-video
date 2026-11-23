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
import { cleanTailFrames } from "../../../packages/core/src/export/smart-render";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import { parseGopTypes, probeGopTypes, probeSource } from "../src/main/sidecar/probe-source";
import { SmartExportSession } from "../src/main/sidecar/smart-export";
// @ts-expect-error plain ESM helper shared with scripts/export-check.mjs
import { checkTimeline, decodeErrors, framePsnr, probeVideoPackets, sampleIndexes, seekDecodes, summarizePsnr } from "../scripts/lib/verify-video.mjs";

const ffmpeg = resolveFfmpegPath();
const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const available = existsSync(ffmpeg) && existsSync(ffprobe);
const work = mkdtempSync(path.join(tmpdir(), "oreel-smart-tail-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FPS_NUM = 30000;
const FPS_DEN = 1001;
const FPS = FPS_NUM / FPS_DEN;
const GOP = 60;
const W = 640;
const H = 360;
const FRAMES = 240;

function run(args: string[]): void {
  execFileSync(ffmpeg, ["-y", "-v", "error", ...args], { maxBuffer: 1 << 28 });
}

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

describe("parseGopTypes", () => {
  it("reads display-ordered picture types and the first pts", () => {
    const text = [
      "[Parsed_showinfo_0 @ 0x1] n:   0 pts:   2002 pts_time:0.0667 duration: 1001 fmt:yuv420p iskey:1 type:I checksum:AA",
      "[Parsed_showinfo_0 @ 0x1] n:   1 pts:   3003 pts_time:0.1001 duration: 1001 fmt:yuv420p iskey:0 type:B checksum:AA",
      "[Parsed_showinfo_0 @ 0x1] n:   2 pts:   4004 pts_time:0.1335 duration: 1001 fmt:yuv420p iskey:0 type:P checksum:AA",
      "something else",
    ].join("\n");
    expect(parseGopTypes(text)).toEqual({ types: "IBP", firstTime: 0.0667 });
    expect(parseGopTypes("no frames")).toBeNull();
  });
});

describe.skipIf(!available)("smart cut: stream-copy into the partial GOP (real ffmpeg)", () => {
  it.each([
    ["B-frames (3)", ["-bf", "3"]],
    ["no B-frames", ["-bf", "0"]],
  ])("copies the clean prefix of the cut GOP and re-encodes the rest, frame-accurately (%s)", async (label, bframes) => {
    const tag = label.replace(/\W+/g, "");
    const src = path.join(work, `src-${tag}.mp4`);
    const wav = path.join(work, `audio-${tag}.wav`);
    run([
      "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS_NUM}/${FPS_DEN}:duration=9`,
      "-c:v", "libx264", "-g", String(GOP), "-keyint_min", String(GOP), "-sc_threshold", "0", ...bframes,
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "3.1",
      "-colorspace", "bt709", "-color_range", "tv", src,
    ]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=8.1", wav]);
    const probe = await probeSource(src);

    // The edit lands 25 frames into the second GOP (frame 85). Whole GOP 0 is copied; the tail is probed.
    const cut = 85;
    const keyTime = (60 * FPS_DEN) / FPS_NUM;
    const gop = await probeGopTypes(src, keyTime, cut - 60);
    expect(gop).not.toBeNull();
    expect(Math.abs(gop!.firstTime - keyTime)).toBeLessThan(0.5 / FPS);
    expect(gop!.types[0]).toBe("I");
    expect(gop!.types).toHaveLength(cut - 60);
    const tail = cleanTailFrames(gop!.types, cut - 60);
    expect(tail).toBeGreaterThan(0);
    // A tail never ends on a B-frame, so it is the last I/P frame before the cut.
    expect(["I", "P"]).toContain(gop!.types[tail - 1]);
    if (label.startsWith("B")) expect(tail).toBeLessThanOrEqual(cut - 60);
    else expect(tail).toBe(cut - 60);
    const copyEnd = 60 + tail;

    const out = path.join(work, `smart-${tag}.mp4`);
    const session = new SmartExportSession({
      args: { width: W, height: H, frameRate: FPS, codec: "h264", encoder: "libx264", mode: "fast", quality: 80, bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mp4", keyframeInterval: GOP },
      match: { codec: "avc", profile: 100, level: 31, color: probe!.color, frameRate: FPS },
      videoPath: path.join(work, `video-${tag}.ts`),
      totalFrames: FRAMES,
    });
    expect(await session.copyRun({ sourcePath: src, sourceStart: 0, outputStartFrame: 0, frames: 60, frameRate: FPS })).toBe(60);
    expect(await session.copyRun({ sourcePath: src, sourceStart: keyTime, outputStartFrame: 60, frames: tail, frameRate: FPS })).toBe(tail);
    // a second copy run of the same source can be one run: here the tail is its own call, which must still join cleanly
    await session.beginEncodeRun(copyEnd);
    for (const f of rgbaFrames(src, copyEnd, FRAMES)) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(FRAMES - copyEnd);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mp4" });
    await session.dispose();

    const packets = probeVideoPackets(ffprobe, out);
    const timeline = checkTimeline(packets, { frames: FRAMES, fps: FPS });
    expect(timeline.problems).toEqual([]);
    expect(decodeErrors(ffmpeg, out)).toBe("");
    expect(seekDecodes(ffmpeg, out, [0, 2.1, copyEnd / FPS - 0.01, copyEnd / FPS + 0.01, 7])).toEqual([]);
    // Frame hashes: every copied frame is the source frame bit for bit; the re-encoded ones are close.
    const psnr = framePsnr(ffmpeg, out, src, { width: W, height: H, indexes: sampleIndexes(FRAMES, FRAMES) });
    expect(summarizePsnr(psnr, 0, copyEnd).min).toBeGreaterThanOrEqual(99);
    expect(summarizePsnr(psnr, copyEnd, FRAMES).min).toBeGreaterThan(38);
    const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", out], { encoding: "utf8" }));
    const video = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    expect(video.nb_frames).toBe(String(FRAMES));
  }, 120_000);
});
