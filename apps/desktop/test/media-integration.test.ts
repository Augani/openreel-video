import { vi } from "vitest";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

vi.mock("../src/main/sidecar/ffmpeg-path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/sidecar/ffmpeg-path")>();
  const bin = path.resolve(
    __dirname,
    "../resources/bin",
    actual.ffmpegRelativePath(process.platform, process.arch),
  );
  return { ...actual, resolveFfmpegPath: () => bin };
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { promises as fs, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import {
  generateProxy,
  transcode,
  extractAudioWav,
  probeAudioStreams,
} from "../src/main/ipc/media";

const run = promisify(execFile);
const stamp = Date.now();
const src = path.join(tmpdir(), `openreel-media-src-${stamp}.mp4`);
const created: string[] = [src];

function ffprobePathFor(ffmpeg: string): string {
  return path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
}

async function probeText(target: string): Promise<{ usedFfprobe: boolean; text: string }> {
  const ffmpeg = resolveFfmpegPath();
  const ffprobe = ffprobePathFor(ffmpeg);
  if (existsSync(ffprobe)) {
    const { stdout } = await run(ffprobe, [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,width,height,sample_rate",
      "-of", "default=noprint_wrappers=1",
      target,
    ]);
    return { usedFfprobe: true, text: stdout };
  }
  try {
    await run(ffmpeg, ["-hide_banner", "-i", target]);
    return { usedFfprobe: false, text: "" };
  } catch (e) {
    return { usedFfprobe: false, text: (e as { stderr?: string }).stderr ?? "" };
  }
}

const ffmpegBin = path.resolve(
  __dirname,
  "../resources/bin",
  `${process.platform}-${process.arch}/${process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"}`,
);
const HAS_FFMPEG = existsSync(ffmpegBin);

describe.skipIf(!HAS_FFMPEG)("native media sidecar integration", () => {
  beforeAll(async () => {
    const ffmpeg = resolveFfmpegPath();
    // 1s 1280x720 30fps test video + 440Hz tone (stereo)
    await run(ffmpeg, [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      src,
    ]);
    expect(existsSync(src)).toBe(true);
  }, 60000);

  afterAll(async () => {
    for (const f of created) await fs.rm(f, { force: true });
  });

  it("generateProxy scales to the preset height with video+audio", async () => {
    const { outPath } = await generateProxy({ srcPath: src, preset: "low" });
    created.push(outPath);
    expect(existsSync(outPath)).toBe(true);
    const { usedFfprobe, text } = await probeText(outPath);
    if (usedFfprobe) {
      expect(text).toMatch(/codec_type=video/);
      expect(text).toMatch(/codec_type=audio/);
      expect(text).toMatch(/height=540/); // low preset = 540p
    } else {
      expect(text).toMatch(/Stream #.*Video/);
      expect(text).toMatch(/Stream #.*Audio/);
      expect(text).toMatch(/x540/); // scaled height 540
    }
    expect((await fs.stat(outPath)).size).toBeGreaterThan(0);
  }, 90000);

  it("transcode re-encodes to a valid mp4", async () => {
    const { outPath } = await transcode({
      srcPath: src,
      container: "mp4",
      videoBitrateKbps: 1500,
      audioBitrateKbps: 128,
    });
    created.push(outPath);
    expect(existsSync(outPath)).toBe(true);
    const { usedFfprobe, text } = await probeText(outPath);
    if (usedFfprobe) expect(text).toMatch(/codec_type=video/);
    else expect(text).toMatch(/Stream #.*Video/);
    expect((await fs.stat(outPath)).size).toBeGreaterThan(0);
  }, 90000);

  it("extractAudioWav produces a pcm_f32le 48kHz WAV", async () => {
    const { outPath } = await extractAudioWav({ srcPath: src });
    created.push(outPath);
    expect(existsSync(outPath)).toBe(true);
    expect(outPath.endsWith(".wav")).toBe(true);
    const { usedFfprobe, text } = await probeText(outPath);
    if (usedFfprobe) {
      expect(text).toMatch(/codec_type=audio/);
      expect(text).toMatch(/sample_rate=48000/);
    } else {
      expect(text).toMatch(/Stream #.*Audio/);
      expect(text).toMatch(/48000 Hz/);
    }
    expect((await fs.stat(outPath)).size).toBeGreaterThan(0);
  }, 90000);

  it("probeAudioStreams reports the source audio stream", async () => {
    const { streams } = await probeAudioStreams({ srcPath: src });
    expect(streams.length).toBeGreaterThanOrEqual(1);
    expect(streams[0].sampleRate).toBe(48000);
    expect(typeof streams[0].codec).toBe("string");
    expect(streams[0].channels).toBeGreaterThanOrEqual(1);
  }, 60000);
});
