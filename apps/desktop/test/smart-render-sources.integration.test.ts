/**
 * Real-ffmpeg tests for the native smart-render source handling added in wave 10:
 * ProRes source copy (all-intra), the changed-source guard, the HEVC hvc1 tag, and
 * the clear decline reasons for 10-bit / 4:2:2 / HDR sources.
 */
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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import { buildSmokeTestArgs } from "../src/main/sidecar/encoder-probe";
import { probeSource } from "../src/main/sidecar/probe-source";
import { SmartExportSession } from "../src/main/sidecar/smart-export";
import { CONTENT_HASH_CHUNK_BYTES as DESKTOP_CHUNK, CONTENT_HASH_HEADER as DESKTOP_HEADER, MTIME_TOLERANCE_MS as DESKTOP_MTIME_TOLERANCE, fingerprintFile, hashFileContent, keyFrameIndexMismatch, verifySourceForCopy, type FingerprintCache } from "../src/main/sidecar/source-guard";
import { nativeProbeMismatch } from "../../../packages/core/src/export/smart-render";
import { CONTENT_HASH_CHUNK_BYTES, CONTENT_HASH_HEADER, MTIME_TOLERANCE_MS, computeFingerprint } from "../../../packages/core/src/export/source-fingerprint";
// @ts-expect-error plain ESM helper shared with scripts/export-check.mjs
import { checkTimeline, decodeErrors, framePsnr, probeVideoPackets, sampleIndexes, seekDecodes, summarizePsnr } from "../scripts/lib/verify-video.mjs";

const ffmpeg = resolveFfmpegPath();
const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const available = existsSync(ffmpeg) && existsSync(ffprobe);
const work = mkdtempSync(path.join(tmpdir(), "oreel-smart-sources-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FPS_NUM = 30000;
const FPS_DEN = 1001;
const FPS = FPS_NUM / FPS_DEN;
const W = 640;
const H = 360;
const FRAMES = 300;

function run(args: string[]): void {
  execFileSync(ffmpeg, ["-y", "-v", "error", ...args], { maxBuffer: 1 << 28 });
}
function encoders(): string {
  return execFileSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
}
/** Capability probe: the encoder is listed AND really encodes a frame here (hardware encoders are absent in CI VMs). */
function canEncode(encoder: string): boolean {
  if (!available || !encoders().includes(encoder)) return false;
  try {
    execFileSync(ffmpeg, buildSmokeTestArgs(encoder), { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    console.warn(`[smart-render-sources] ${encoder} cannot encode on this machine; its test is skipped`);
    return false;
  }
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
const lavfi = (seconds: number) => ["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS_NUM}/${FPS_DEN}:duration=${seconds}`];
const ffprobeJson = (file: string) => JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" }));

describe.skipIf(!available)("ProRes source copy (real ffmpeg)", () => {
  const wav = path.join(work, "audio.wav");

  async function joinProRes(encoder: string, label: string) {
    const src = path.join(work, `src-${label}.mov`);
    run([
      ...lavfi(11),
      "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", src,
    ]);
    run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10.02", wav]);

    const probe = await probeSource(src);
    expect(probe).toMatchObject({ codec: "prores", pixelFormat: "yuv422p10le" });
    expect(nativeProbeMismatch(probe!, "prores")).toBeNull();

    const out = path.join(work, `smart-${label}.mov`);
    const session = new SmartExportSession({
      args: {
        width: W, height: H, frameRate: FPS, codec: "prores", encoder, mode: "balanced", quality: 80,
        bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mov", proresProfile: "hq",
      },
      match: { codec: "prores", proresProfile: "hq", color: probe!.color, frameRate: FPS },
      videoPath: path.join(work, `video-${label}.ts`),
      totalFrames: FRAMES,
    });

    // frames 0-36 re-encoded, 37-179 copied (37 is not a GOP boundary: every ProRes frame is a cut point), 180-299 re-encoded
    const first = rgbaFrames(src, 0, 37);
    await session.beginEncodeRun(0);
    for (const f of first) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(37);
    expect(await session.copyRun({ sourcePath: src, sourceStart: (37 * FPS_DEN) / FPS_NUM, outputStartFrame: 37, frames: 143, frameRate: FPS })).toBe(143);
    const last = rgbaFrames(src, 180, 300);
    await session.beginEncodeRun(180);
    for (const f of last) await session.writeFrame(f);
    expect(await session.endEncodeRun()).toBe(120);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mov" });
    await session.dispose();
    return { src, out };
  }

  for (const encoder of ["prores_ks", "prores_videotoolbox"]) it.skipIf(!canEncode(encoder))(`joins copied and re-encoded ProRes runs frame-accurately (${encoder})`, async () => {
    const { src, out } = await joinProRes(encoder, encoder);

    const packets = probeVideoPackets(ffprobe, out);
    const timeline = checkTimeline(packets, { frames: FRAMES, fps: FPS });
    expect(timeline.problems).toEqual([]);
    expect(packets.every((p: { key: boolean }) => p.key)).toBe(true);
    expect(decodeErrors(ffmpeg, out)).toBe("");
    expect(seekDecodes(ffmpeg, out, [0, 1.2, 3.5, 6.2, 9.5])).toEqual([]);

    // The copied frames are the source's bytes (decode identically); re-encoded frames are close.
    const psnr = framePsnr(ffmpeg, out, src, { width: W, height: H, indexes: sampleIndexes(FRAMES, FRAMES) });
    expect(summarizePsnr(psnr, 37, 180).min).toBeGreaterThanOrEqual(99);
    expect(summarizePsnr(psnr, 0, 37).min).toBeGreaterThan(38);
    expect(summarizePsnr(psnr, 180, 300).min).toBeGreaterThan(38);

    const info = ffprobeJson(out);
    const video = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    expect(video).toMatchObject({ codec_name: "prores", profile: "HQ", codec_tag_string: "apch", pix_fmt: "yuv422p10le", r_frame_rate: "30000/1001", nb_frames: String(FRAMES) });
    expect(info.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(true);
  }, 180_000);

  it("a copy-only ProRes export is byte-for-byte the source's frames", async () => {
    const src = path.join(work, "src-whole.mov");
    run([...lavfi(3), "-c:v", "prores_ks", "-profile:v", "1", "-pix_fmt", "yuv422p10le", "-colorspace", "bt709", src]);
    const total = 90;
    const out = path.join(work, "smart-whole.mov");
    run(["-f", "lavfi", "-i", "sine=duration=3.003:sample_rate=48000", wav]);
    const session = new SmartExportSession({
      args: { width: W, height: H, frameRate: FPS, codec: "prores", encoder: "prores_ks", mode: "balanced", quality: 80, bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mov", proresProfile: "lt" },
      match: { codec: "prores", proresProfile: "lt", color: { matrix: "bt709" }, frameRate: FPS },
      videoPath: path.join(work, "video-whole.ts"),
      totalFrames: total,
    });
    expect(await session.copyRun({ sourcePath: src, sourceStart: 0, outputStartFrame: 0, frames: total, frameRate: FPS })).toBe(total);
    await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format: "mov" });
    await session.dispose();
    const a = execFileSync(ffmpeg, ["-v", "error", "-i", src, "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"], { encoding: "utf8" });
    const b = execFileSync(ffmpeg, ["-v", "error", "-i", out, "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"], { encoding: "utf8" });
    const crcs = (text: string) => text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").slice(-2).join(","));
    expect(crcs(b)).toEqual(crcs(a));
    expect(checkTimeline(probeVideoPackets(ffprobe, out), { frames: total, fps: FPS }).problems).toEqual([]);
  }, 120_000);
});

describe.skipIf(!available)("changed-source guard (real ffmpeg)", () => {
  it("hashes exactly what the renderer hashes: every byte, in the same chunks", async () => {
    expect(DESKTOP_CHUNK).toBe(CONTENT_HASH_CHUNK_BYTES);
    expect(DESKTOP_HEADER).toBe(CONTENT_HASH_HEADER);
    expect(DESKTOP_MTIME_TOLERANCE).toBe(MTIME_TOLERANCE_MS);
    const file = path.join(work, "fp.bin");
    for (const size of [0, 1, 5 * 1024 + 17, CONTENT_HASH_CHUNK_BYTES, 2 * CONTENT_HASH_CHUNK_BYTES + 17]) {
      const data = Buffer.alloc(size);
      for (let i = 0; i < data.length; i++) data[i] = (i * 7 + 3) & 0xff;
      writeFileSync(file, data);
      const onDisk = await fingerprintFile(file);
      const inRenderer = await computeFingerprint(new Blob([data]));
      expect(onDisk.contentHash, `size ${size}`).toBe(inRenderer.contentHash);
      expect(onDisk.size).toBe(inRenderer.size);
    }
  });

  const src = path.join(work, "guard.mp4");
  const KEY = 60;
  const keyAt = (n: number) => (n * FPS_DEN) / FPS_NUM;

  it("accepts the untouched file and a key frame at the copy start", async () => {
    run([...lavfi(6), "-c:v", "libx264", "-g", String(KEY), "-keyint_min", String(KEY), "-sc_threshold", "0", "-bf", "3", "-pix_fmt", "yuv420p", src]);
    const fp = await fingerprintFile(src);
    expect(await verifySourceForCopy(src, { size: fp.size, mtimeMs: fp.mtimeMs, contentHash: fp.contentHash }, { sourceStart: keyAt(KEY), frameRate: FPS })).toBeNull();
    expect(await keyFrameIndexMismatch(src, 0, FPS)).toBeNull();
    expect(await keyFrameIndexMismatch(src, keyAt(2 * KEY), FPS)).toBeNull();
  });

  it("refuses a copy start that is not a key frame in this file (the key frame index changed)", async () => {
    expect(await keyFrameIndexMismatch(src, keyAt(KEY + 7), FPS)).toMatch(/key frame index changed/);
    // the same plan against a file with a different GOP structure
    const other = path.join(work, "guard-other.mp4");
    run([...lavfi(6), "-c:v", "libx264", "-g", "45", "-keyint_min", "45", "-sc_threshold", "0", "-bf", "3", "-pix_fmt", "yuv420p", other]);
    expect(await keyFrameIndexMismatch(other, keyAt(KEY), FPS)).toMatch(/key frame index changed/);
  });

  it("catches a replaced file of the same size via mtime and via the content hash", async () => {
    const original = readFileSync(src);
    const file = path.join(work, "guard-copy.mp4");
    writeFileSync(file, original);
    const before = await fingerprintFile(file);
    const expected = { size: before.size, mtimeMs: before.mtimeMs, contentHash: before.contentHash };

    // same size, same bytes, new mtime
    const later = new Date(statSync(file).mtimeMs + 60_000);
    utimesSync(file, later, later);
    expect(await verifySourceForCopy(file, expected, { sourceStart: 0, frameRate: FPS })).toMatch(/modification time changed/);

    // same size and the original mtime restored, but the tail differs
    const tampered = Buffer.from(original);
    tampered[tampered.length - 10] ^= 0xff;
    writeFileSync(file, tampered);
    const restore = new Date(before.mtimeMs);
    utimesSync(file, restore, restore);
    expect(statSync(file).size).toBe(before.size);
    expect(await verifySourceForCopy(file, expected, { sourceStart: 0, frameRate: FPS })).toMatch(/content changed/);

    // an edit in the middle of the file, far from the first and last 64 KiB: the retired head/tail sample missed this
    const middle = Buffer.from(original);
    middle[Math.floor(middle.length / 2)] ^= 0x01;
    expect(middle.length).toBeGreaterThan(200 * 1024);
    writeFileSync(file, middle);
    utimesSync(file, restore, restore);
    expect(statSync(file).size).toBe(before.size);
    expect(await verifySourceForCopy(file, expected, { sourceStart: 0, frameRate: FPS })).toMatch(/content changed/);

    // truncated
    writeFileSync(file, original.subarray(0, original.length - 1000));
    expect(await verifySourceForCopy(file, expected, { sourceStart: 0, frameRate: FPS })).toMatch(/size changed/);
  });
});

describe.skipIf(!available)("content hash cache (real files)", () => {
  it("hashes a file once per job and again when its size or modification time changes", async () => {
    const file = path.join(work, "cache.bin");
    const data = Buffer.alloc(3 * 1024 * 1024 + 5, 7);
    writeFileSync(file, data);
    const cache: FingerprintCache = new Map();
    const first = await fingerprintFile(file, cache);
    expect(cache.size).toBe(1);
    // the same promise: no second read of the file
    const again = fingerprintFile(file, cache);
    expect(await again).toBe(first);
    expect(cache.size).toBe(1);
    // edited in place keeping size, mtime moved on: new identity, hashed again
    const edited = Buffer.from(data);
    edited[data.length >> 1] = 9;
    writeFileSync(file, edited);
    const later = new Date(statSync(file).mtimeMs + 5000);
    utimesSync(file, later, later);
    const second = await fingerprintFile(file, cache);
    expect(cache.size).toBe(2);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect((await hashFileContent(file)).contentHash).toBe(second.contentHash);
  });
});

describe.skipIf(!available)("HEVC output tag and unsupported-source declines (real ffmpeg)", () => {
  it("probes 10-bit, 4:2:2 and HDR sources and names what cannot be copied", async () => {
    const e = encoders();
    const make = (name: string, args: string[]) => {
      const file = path.join(work, name);
      run([...lavfi(1), ...args, file]);
      return file;
    };
    const x264 = e.includes("libx264");
    const x265 = e.includes("libx265");
    if (x264) {
      const ten = await probeSource(make("h264-10bit.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-profile:v", "high10"]));
      expect(ten?.pixelFormat).toBe("yuv420p10le");
      expect(nativeProbeMismatch(ten!, "avc")).toMatch(/10-bit 4:2:0.*8-bit 4:2:0 SDR sources only/);
      const t422 = await probeSource(make("h264-422.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv422p", "-profile:v", "high422"]));
      expect(nativeProbeMismatch(t422!, "avc")).toMatch(/8-bit 4:2:2/);
      const t422ten = await probeSource(make("h264-422-10.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv422p10le", "-profile:v", "high422"]));
      expect(nativeProbeMismatch(t422ten!, "avc")).toMatch(/10-bit 4:2:2/);
    }
    if (x265) {
      const hdr = await probeSource(
        make("hevc-hdr10.mp4", [
          "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-x265-params", "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc", "-tag:v", "hvc1",
        ]),
      );
      expect(hdr?.pixelFormat).toBe("yuv420p10le");
      expect(nativeProbeMismatch(hdr!, "hevc")).toMatch(/10-bit 4:2:0/);
      const hlg8 = await probeSource(
        make("hevc-hlg-8bit.mp4", ["-c:v", "libx265", "-pix_fmt", "yuv420p", "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc"]),
      );
      expect(nativeProbeMismatch(hlg8!, "hevc")).toMatch(/HDR \(HLG\)/);
    }
    const pr444 = await probeSource(make("prores-4444.mov", ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuv444p10le"]));
    expect(nativeProbeMismatch(pr444!, "prores")).toMatch(/not ProRes 4:2:2/);
  }, 120_000);

  it("a stream-copied-only HEVC export (QuickTime-compatible) carries the hvc1 tag", async () => {
    if (!encoders().includes("libx265")) return;
    const src = path.join(work, "hevc-copy.mp4");
    // hev1 on purpose: the copied stream must be re-tagged hvc1 for QuickTime
    run([...lavfi(4), "-c:v", "libx265", "-preset", "veryfast", "-x265-params", "keyint=30:min-keyint=30:scenecut=0:open-gop=0:log-level=error", "-pix_fmt", "yuv420p", "-tag:v", "hev1", src]);
    expect(ffprobeJson(src).streams[0].codec_tag_string).toBe("hev1");
    const wav = path.join(work, "hevc-copy.wav");
    run(["-f", "lavfi", "-i", "sine=duration=4:sample_rate=48000", wav]);
    for (const [ext, format] of [["mp4", "mp4"], ["mov", "mov"]] as const) {
      const out = path.join(work, `hevc-copy-out.${ext}`);
      const session = new SmartExportSession({
        args: { width: W, height: H, frameRate: FPS, codec: "hevc", encoder: "libx265", mode: "fast", quality: 80, bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format, keyframeInterval: 30 },
        match: { codec: "hevc", profile: 1, level: 93, color: { matrix: "bt709" }, frameRate: FPS },
        videoPath: path.join(work, `video-hevc-copy-${ext}.ts`),
        totalFrames: 90,
      });
      expect(await session.copyRun({ sourcePath: src, sourceStart: 0, outputStartFrame: 0, frames: 90, frameRate: FPS })).toBe(90);
      await session.assemble({ audioWavPath: wav, outputPath: out, audioCodec: "aac", format });
      await session.dispose();
      expect(ffprobeJson(out).streams.find((s: { codec_type: string }) => s.codec_type === "video").codec_tag_string).toBe("hvc1");
    }
  }, 120_000);
});
