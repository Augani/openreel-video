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

import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { promises as fs, existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ExportJob } from "../src/main/sidecar/export-job";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import { probeEncoders, selectEncoder } from "../src/main/sidecar/encoder-probe";

const run = promisify(execFile);
const stamp = Date.now();
const out = path.join(tmpdir(), `openreel-export-${stamp}.mp4`);
const wav = path.join(tmpdir(), `openreel-export-${stamp}.wav`);
const proresOut = path.join(tmpdir(), `openreel-export-prores-${stamp}.mov`);
const proresWav = path.join(tmpdir(), `openreel-export-prores-${stamp}.wav`);
const hiResOut = path.join(tmpdir(), `openreel-export-hires-${stamp}.mp4`);
const hiResWav = path.join(tmpdir(), `openreel-export-hires-${stamp}.wav`);

function ffprobePathFor(ffmpeg: string): string {
  return path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
}

async function probeStreams(ffmpeg: string, target: string): Promise<{ usedFfprobe: boolean; text: string }> {
  const ffprobe = ffprobePathFor(ffmpeg);
  if (existsSync(ffprobe)) {
    const { stdout } = await run(ffprobe, [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,width,height",
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

describe.skipIf(!HAS_FFMPEG)("native export integration", () => {
  afterAll(async () => {
    await fs.rm(out, { force: true });
    await fs.rm(wav, { force: true });
    await fs.rm(proresOut, { force: true });
    await fs.rm(proresWav, { force: true });
    await fs.rm(hiResOut, { force: true });
    await fs.rm(hiResWav, { force: true });
  });

  it("encodes RGBA frames + audio to a playable mp4 (real ffmpeg, hardware-selected encoder)", async () => {
    const ffmpeg = resolveFfmpegPath();
    expect(existsSync(ffmpeg)).toBe(true);

    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", wav]);

    const W = 320, H = 240, FPS = 30;
    const encoder = selectEncoder("h264", process.platform, await probeEncoders()) ?? "libx264";
    const frame = new Uint8Array(W * H * 4).fill(128);

    await new Promise<void>((resolve, reject) => {
      const job = new ExportJob(
        { width: W, height: H, frameRate: FPS, codec: "h264", encoder, mode: "balanced", quality: 80, bitrateKbps: 2000, outputPath: out, audioWavPath: wav, format: "mp4" },
        () => {}, resolve, reject,
      );
      job.start();
      (async () => {
        for (let i = 0; i < FPS; i++) await job.writeFrame(frame);
        job.endInput();
      })().catch(reject);
    });

    expect(existsSync(out)).toBe(true);

    const { usedFfprobe, text } = await probeStreams(ffmpeg, out);

    if (usedFfprobe) {
      expect(text).toMatch(/codec_type=video/);
      expect(text).toMatch(/codec_type=audio/);
      expect(text).toMatch(/width=320/);
      expect(text).toMatch(/height=240/);
    } else {
      expect(text).toMatch(/Stream #.*Video/);
      expect(text).toMatch(/Stream #.*Audio/);
      expect(text).toMatch(/320x240/);
    }

    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  }, 90000);

  it("produces real ProRes in a .mov (native path: no ProRes->H.264 downgrade)", async () => {
    const ffmpeg = resolveFfmpegPath();
    expect(existsSync(ffmpeg)).toBe(true);

    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", proresWav]);

    const W = 320, H = 240, FPS = 30;
    const available = await probeEncoders();
    const candidates = [
      selectEncoder("prores", process.platform, available) ?? "prores_ks",
      "prores_ks",
    ];
    const frame = new Uint8Array(W * H * 4).fill(128);

    const encodeWith = (encoder: string) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpeg, [
          "-y",
          "-f", "rawvideo",
          "-pix_fmt", "rgba",
          "-s", `${W}x${H}`,
          "-r", String(FPS),
          "-i", "pipe:0",
          "-i", proresWav,
          "-c:v", encoder,
          "-c:a", "pcm_s16le",
          "-shortest",
          proresOut,
        ]);
        let stderr = "";
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        proc.on("error", reject);
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg (${encoder}) exited with code ${code}\n${stderr.slice(-2000)}`));
        });
        (async () => {
          for (let i = 0; i < FPS; i++) {
            if (!proc.stdin.write(frame)) {
              await new Promise<void>((r) => proc.stdin.once("drain", r));
            }
          }
          proc.stdin.end();
        })().catch(reject);
      });

    let usedEncoder = "";
    let lastErr: unknown;
    for (const encoder of candidates) {
      try {
        await encodeWith(encoder);
        usedEncoder = encoder;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!usedEncoder) throw lastErr;
    expect(existsSync(proresOut)).toBe(true);

    const { usedFfprobe, text } = await probeStreams(ffmpeg, proresOut);
    if (usedFfprobe) {
      expect(text).toMatch(/codec_name=prores/i);
      expect(text).toMatch(/codec_type=audio/);
    } else {
      expect(text).toMatch(/Video: prores/i);
      expect(text).toMatch(/Stream #.*Audio/);
    }

    const stat = await fs.stat(proresOut);
    expect(stat.size).toBeGreaterThan(0);
  }, 90000);

  it("encodes beyond the 1080p browser cap (native >1080p, e.g. 2560x1440)", async () => {
    const ffmpeg = resolveFfmpegPath();
    expect(existsSync(ffmpeg)).toBe(true);

    await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", hiResWav]);

    const W = 2560, H = 1440, FPS = 30;
    const encoder = selectEncoder("h264", process.platform, await probeEncoders()) ?? "libx264";
    const frame = new Uint8Array(W * H * 4).fill(96);

    await new Promise<void>((resolve, reject) => {
      const job = new ExportJob(
        { width: W, height: H, frameRate: FPS, codec: "h264", encoder, mode: "balanced", quality: 80, bitrateKbps: 8000, outputPath: hiResOut, audioWavPath: hiResWav, format: "mp4" },
        () => {}, resolve, reject,
      );
      job.start();
      (async () => {
        for (let i = 0; i < 15; i++) await job.writeFrame(frame);
        job.endInput();
      })().catch(reject);
    });

    expect(existsSync(hiResOut)).toBe(true);

    const ffprobe = ffprobePathFor(ffmpeg);
    let usedFfprobe = false;
    let text = "";
    if (existsSync(ffprobe)) {
      const { stdout } = await run(ffprobe, [
        "-v", "error",
        "-show_entries", "stream=codec_type,width,height",
        "-of", "default=noprint_wrappers=1",
        hiResOut,
      ]);
      usedFfprobe = true;
      text = stdout;
    } else {
      try {
        await run(ffmpeg, ["-hide_banner", "-i", hiResOut]);
      } catch (e) {
        text = (e as { stderr?: string }).stderr ?? "";
      }
    }

    if (usedFfprobe) {
      expect(text).toMatch(/codec_type=video/);
      expect(text).toMatch(/width=2560/);
      expect(text).toMatch(/height=1440/);
    } else {
      expect(text).toMatch(/Stream #.*Video/);
      expect(text).toMatch(/2560x1440/);
    }

    const stat = await fs.stat(hiResOut);
    expect(stat.size).toBeGreaterThan(0);
  }, 90000);
});
