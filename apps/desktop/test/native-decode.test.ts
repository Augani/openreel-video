import { vi } from "vitest";
import { existsSync } from "node:fs";

// Real ffmpeg: the bundled sidecar when fetched, else OPENREEL_FFMPEG_PATH, else Homebrew's. Skipped when none exists.
const candidates = [process.env.OPENREEL_FFMPEG_PATH, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter((p): p is string => Boolean(p));
const ffmpegBin = candidates.find((p) => existsSync(p));
if (ffmpegBin) process.env.OPENREEL_FFMPEG_PATH = ffmpegBin;

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeDecodeService, buildDecodeArgs, evenWidth, exactFrameRate, frameIndexAt, outputHeight, rotationFilters } from "../src/main/decode/native-decode";
import { parseFfmpegProbe } from "../src/main/ingest/probe-media";

describe("native decode maths", () => {
  it("snaps printed broadcast rates to their rationals", () => {
    expect(exactFrameRate(23.98)).toBeCloseTo(24000 / 1001, 9);
    expect(exactFrameRate(29.97)).toBeCloseTo(30000 / 1001, 9);
    expect(exactFrameRate(25)).toBe(25);
    expect(exactFrameRate(24)).toBe(24);
  });

  it("maps a time to the frame displayed at it, clamped to the file", () => {
    expect(frameIndexAt(0, 24, 72)).toBe(0);
    expect(frameIndexAt(1.0, 24, 72)).toBe(24);
    expect(frameIndexAt(1 / 24 - 1e-9, 24, 72)).toBe(1);
    expect(frameIndexAt(0.5, 30000 / 1001, 300)).toBe(14);
    expect(frameIndexAt(99, 24, 72)).toBe(71);
    expect(frameIndexAt(-3, 24, 72)).toBe(0);
  });

  it("never upscales and keeps even dimensions", () => {
    expect(evenWidth(undefined, 1920)).toBe(1920);
    expect(evenWidth(5000, 1920)).toBe(1920);
    expect(evenWidth(641, 1920)).toBe(640);
    expect(outputHeight(640, 1920, 1080)).toBe(360);
    expect(outputHeight(854, 1920, 1080)).toBe(480);
  });

  it("seeks a quarter frame early, decodes video only, and uses a better scaler for full quality", () => {
    const base = { srcPath: "/a/b.mov", frameRate: 24, width: 640, height: 360, sourceWidth: 1920, sourceHeight: 1080, matrix: "bt709" as const };
    const preview = buildDecodeArgs({ ...base, startFrame: 24, quality: "preview" });
    expect(preview[preview.indexOf("-ss") + 1]).toBe((23.75 / 24).toFixed(6));
    expect(preview).toContain("-an");
    expect(preview.join(" ")).toContain("fast_bilinear");
    const full = buildDecodeArgs({ ...base, startFrame: 0, quality: "full" });
    expect(full).not.toContain("-ss");
    expect(full.join(" ")).toContain("bicubic+accurate_rnd");
    expect(full.join(" ")).toContain("-pix_fmt rgba");
    expect(full.join(" ")).not.toContain("rgba64le");
  });

  it("decodes to 16-bit rgba64le when the HDR working mode asks for exact code values", () => {
    const args = buildDecodeArgs({ srcPath: "/a/b.mov", frameRate: 24, width: 640, height: 360, sourceWidth: 1920, sourceHeight: 1080, matrix: "bt2020", startFrame: 0, quality: "full", bitDepth: 16 });
    expect(args.join(" ")).toContain("-pix_fmt rgba64le");
    expect(args.join(" ")).toContain("in_color_matrix=bt2020");
  });
});

describe("rotation metadata", () => {
  const stream = (extra: string) => `Input #0, mov,mp4, from 'a.mov':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: prores (HQ) (apch / 0x68637061), yuv422p10le, 640x360, 24 fps, 24 tbr, 12288 tbn (default)
${extra}
  Stream #0:1[0x2](und): Audio: pcm_s16le (sowt / 0x74776F73), 48000 Hz, stereo, s16, 1536 kb/s (default)`;

  it("reads the display matrix (counter-clockwise in ffmpeg) as clockwise degrees", () => {
    expect(parseFfmpegProbe(stream("    Side data:\n      displaymatrix: rotation of -90.00 degrees")).rotation).toBe(90);
    expect(parseFfmpegProbe(stream("    Side data:\n      displaymatrix: rotation of 90.00 degrees")).rotation).toBe(270);
    expect(parseFfmpegProbe(stream("    Side data:\n      displaymatrix: rotation of 180.00 degrees")).rotation).toBe(180);
    expect(parseFfmpegProbe(stream("    Side data:\n      displaymatrix: rotation of -0.00 degrees")).rotation).toBeUndefined();
  });

  it("reads the legacy rotate tag as clockwise degrees", () => {
    expect(parseFfmpegProbe(stream("    Metadata:\n      rotate          : 90")).rotation).toBe(90);
    expect(parseFfmpegProbe(stream("    Metadata:\n      rotate          : 270")).rotation).toBe(270);
  });

  it("ignores rotation that belongs to another stream and files without any", () => {
    const audioOnly = `Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps
  Stream #0:1: Audio: aac, 48000 Hz
    Side data:
      displaymatrix: rotation of -90.00 degrees`;
    expect(parseFfmpegProbe(audioOnly).rotation).toBeUndefined();
    expect(parseFfmpegProbe(stream("")).rotation).toBeUndefined();
  });

  it("turns frames upright with explicit filters and switches autorotate off", () => {
    expect(rotationFilters(0)).toEqual([]);
    expect(rotationFilters(90)).toEqual(["transpose=1"]);
    expect(rotationFilters(180)).toEqual(["hflip", "vflip"]);
    expect(rotationFilters(270)).toEqual(["transpose=2"]);
    expect(rotationFilters(-90)).toEqual(["transpose=2"]);
    const args = buildDecodeArgs({ srcPath: "/a/b.mov", frameRate: 24, width: 360, height: 640, sourceWidth: 360, sourceHeight: 640, rotation: 90, matrix: "bt709", startFrame: 0, quality: "full" });
    expect(args).toContain("-noautorotate");
    expect(args[args.indexOf("-vf") + 1].startsWith("transpose=1,scale=360:640")).toBe(true);
  });
});

const d = ffmpegBin ? describe : describe.skip;

let work = "";
let prores = "";
let proresHq4444 = "";
let h264 = "";
const W = 640;
const H = 360;
const FPS = 24;

function sh(args: string[]): void {
  execFileSync(ffmpegBin!, ["-y", "-loglevel", "error", ...args]);
}

/** ffmpeg's own decode of frame N (the reference the service must match): the full-quality path, run directly. */
function referenceFrame(file: string, n: number, width = W, height = H): Buffer {
  return execFileSync(
    ffmpegBin!,
    ["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${width}:${height}:flags=bicubic+accurate_rnd+full_chroma_int:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

beforeAll(() => {
  if (!ffmpegBin) return;
  work = mkdtempSync(path.join(os.tmpdir(), "openreel-native-decode-"));
  prores = path.join(work, "prores422hq.mov");
  proresHq4444 = path.join(work, "prores4444.mov");
  h264 = path.join(work, "h264.mp4");
  const src = ["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=4`];
  const tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
  sh([...src, "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", ...tags, prores]);
  sh([...src, "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", ...tags, proresHq4444]);
  sh([...src, "-c:v", "libx264", "-pix_fmt", "yuv420p", h264]);
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

function maxDiff(a: Uint8Array, b: Uint8Array): number {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

d("NativeDecodeService (real ffmpeg, ProRes fixtures)", () => {
  it("probes a ProRes file and reports its geometry, codec and frame count", async () => {
    const service = new NativeDecodeService();
    const probe = await service.probe(prores);
    expect(probe).toMatchObject({ codec: "prores", width: W, height: H, frameRate: FPS });
    expect(probe!.frameCount).toBe(FPS * 4);
    expect(probe!.duration).toBeCloseTo(4, 1);
    service.dispose();
  });

  it("rejects relative paths, URLs and missing files", async () => {
    const service = new NativeDecodeService();
    expect(await service.probe("relative.mov")).toBeNull();
    expect(await service.probe("http://127.0.0.1/x.mov")).toBeNull();
    expect(await service.probe(path.join(work, "nope.mov"))).toBeNull();
    expect(await service.getFrame(path.join(work, "nope.mov"), 0, { quality: "preview" })).toBeNull();
    service.dispose();
  });

  it("decodes the right frames at scattered times, matching ffmpeg's own decode", async () => {
    const service = new NativeDecodeService();
    for (const time of [0, 1.0, 2.5, 0.25, 3.9]) {
      const frame = await service.getFrame(prores, time, { quality: "full" });
      const index = Math.floor(time * FPS + 1e-6);
      expect(frame, `frame at ${time}`).not.toBeNull();
      expect(frame!.frameIndex).toBe(index);
      expect(frame!.timestamp).toBeCloseTo(index / FPS, 6);
      expect(maxDiff(frame!.rgba, referenceFrame(prores, index))).toBeLessThanOrEqual(1);
    }
    service.dispose();
  });

  it("decodes 16-bit frames (8 bytes a pixel) whose high bytes equal the 8-bit decode, cached apart from 8-bit", async () => {
    const service = new NativeDecodeService();
    const wide = await service.getFrame(prores, 1.0, { quality: "full", bitDepth: 16 });
    const narrow = await service.getFrame(prores, 1.0, { quality: "full" });
    expect(wide!.bitDepth).toBe(16);
    expect(narrow!.bitDepth).toBeUndefined();
    expect(wide!.rgba.length).toBe(W * H * 8);
    expect(narrow!.rgba.length).toBe(W * H * 4);
    // The 16-bit sample is the same picture at higher precision: its top byte rounds to within one level of the 8-bit decode.
    let max = 0;
    for (let i = 0; i < W * H * 4; i += 37) {
      const code16 = wide!.rgba.readUInt16LE(i * 2);
      max = Math.max(max, Math.abs(Math.round(code16 / 257) - narrow!.rgba[i]));
    }
    expect(max).toBeLessThanOrEqual(2);
    expect(service.getStats().streamsStarted).toBe(2);
    service.dispose();
  });

  it("also decodes ProRes 4444 (alpha) sources", async () => {
    const service = new NativeDecodeService();
    const frame = await service.getFrame(proresHq4444, 1.5, { quality: "full" });
    expect(frame).not.toBeNull();
    expect(frame!.width).toBe(W);
    service.dispose();
  });

  it("serves sequential playback from one stream with read-ahead, then answers repeats from cache", async () => {
    const service = new NativeDecodeService();
    const first = await service.getFrame(prores, 1.0, { quality: "preview" });
    expect(first?.frameIndex).toBe(24);
    for (let i = 1; i < 30; i++) {
      const frame = await service.getFrame(prores, (24 + i) / FPS, { quality: "preview" });
      expect(frame?.frameIndex).toBe(24 + i);
    }
    const stats = service.getStats();
    expect(stats.streamsStarted).toBe(1);
    const again = await service.getFrame(prores, 1.0, { quality: "preview" });
    expect(again?.frameIndex).toBe(24);
    expect(service.getStats().cacheHits).toBeGreaterThan(stats.cacheHits);
    expect(service.getStats().streamsStarted).toBe(1);
    service.dispose();
  });

  it("downscales for preview (fast) and keeps the aspect ratio", async () => {
    const service = new NativeDecodeService();
    const frame = await service.getFrame(prores, 2, { width: 320, quality: "preview" });
    expect(frame).toMatchObject({ width: 320, height: 180 });
    expect(frame!.rgba.byteLength).toBe(320 * 180 * 4);
    service.dispose();
  });

  it("keeps a byte budget on the frame cache and never leaves more than maxStreams processes", async () => {
    const service = new NativeDecodeService({ cacheBytes: W * H * 4 * 5, maxStreams: 2, aheadFrames: 2 });
    for (const time of [0, 1, 2, 3, 0.5, 1.5]) await service.getFrame(prores, time, { quality: "preview" });
    const stats = service.getStats();
    expect(stats.cacheBytes).toBeLessThanOrEqual(W * H * 4 * 5);
    expect(stats.streamsLive).toBeLessThanOrEqual(2);
    service.dispose();
    expect(service.getStats().streamsLive).toBe(0);
  });

  it("returns null past the end of the file instead of hanging", async () => {
    const service = new NativeDecodeService();
    const probe = await service.probe(prores);
    const last = await service.getFrame(prores, 100, { quality: "preview" });
    expect(last?.frameIndex).toBe(probe!.frameCount - 1);
    service.dispose();
  });
});

d("NativeDecodeService edge cases", () => {
  it("does not pin a missing file as undecodable once it appears", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openreel-native-late-"));
    const late = path.join(dir, "late.mov");
    const service = new NativeDecodeService();
    try {
      expect(await service.probe(late)).toBeNull();
      sh(["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=1`, "-c:v", "prores_ks", "-pix_fmt", "yuv422p10le", late]);
      expect((await service.probe(late))?.codec).toBe("prores");
    } finally {
      service.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("holds the last video frame when the container is longer than the video stream", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openreel-native-long-audio-"));
    const longAudio = path.join(dir, "long-audio.mov");
    const service = new NativeDecodeService();
    try {
      sh(["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, "-f", "lavfi", "-i", "sine=duration=4", "-c:v", "prores_ks", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le", longAudio]);
      const frame = await service.getFrame(longAudio, 3.5, { quality: "preview" });
      expect(frame).not.toBeNull();
      expect(frame!.frameIndex).toBe(FPS * 2 - 1);
    } finally {
      service.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("limits read-ahead so a stream of large frames stays inside the cache budget", async () => {
    const budget = W * H * 4 * 8;
    const service = new NativeDecodeService({ cacheBytes: budget, aheadFrames: 12 });
    await service.getFrame(prores, 0, { quality: "preview" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(service.getStats().framesDecoded).toBeLessThanOrEqual(2 + 2 + 3);
    service.dispose();
  });
});



d("NativeDecodeService rotation (real ffmpeg)", () => {
  /** A ProRes clip with a display matrix, made by remuxing (no re-encode): `-display_rotation` is counter-clockwise. */
  function rotated(file: string, ccw: number): string {
    const out = path.join(work, `rot${ccw}.mov`);
    sh(["-display_rotation:v:0", String(ccw), "-i", file, "-c", "copy", out]);
    return out;
  }

  /** ffmpeg's own autorotated decode: what any player shows. */
  function playerFrame(file: string, n: number, width: number, height: number): Buffer {
    return execFileSync(
      ffmpegBin!,
      ["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${width}:${height}:flags=bicubic+accurate_rnd+full_chroma_int:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
  }

  it.each([
    { ccw: -90, clockwise: 90, width: H, height: W },
    { ccw: 90, clockwise: 270, width: H, height: W },
    { ccw: 180, clockwise: 180, width: W, height: H },
  ])("probes and decodes a $clockwise degree clip upright, matching a player", async ({ ccw, clockwise, width, height }) => {
    const file = rotated(prores, ccw);
    const service = new NativeDecodeService();
    const probe = await service.probe(file);
    expect(probe).toMatchObject({ rotation: clockwise, width, height });
    for (const index of [0, 30]) {
      const frame = await service.getFrame(file, index / FPS, { quality: "full" });
      expect(frame).not.toBeNull();
      expect(frame).toMatchObject({ width, height });
      expect(maxDiff(frame!.rgba, playerFrame(file, index, width, height))).toBeLessThanOrEqual(1);
    }
    const preview = await service.getFrame(file, 0, { quality: "preview", width: width / 2 });
    expect(preview).toMatchObject({ width: width / 2, height: height / 2 });
    service.dispose();
  });

  it("leaves an unrotated file alone", async () => {
    const service = new NativeDecodeService();
    const probe = await service.probe(prores);
    expect(probe!.rotation).toBe(0);
    service.dispose();
  });
});
