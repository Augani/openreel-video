/**
 * Real-ffmpeg coverage of the desktop spherical (VR) export, no Electron: the ExportJob writes an MP4 / MOV (ffmpeg puts the
 * movie header in front of the media data with +faststart), then patches Spherical Video V2 boxes (st3d / sv3d) into the
 * finished file, shifting every chunk offset. ffprobe reads the side data back and ffmpeg decodes every frame, which would
 * fail if an offset were wrong. Skipped when ffmpeg / ffprobe are not installed.
 */
import { vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

const ffmpegCandidates = [process.env.OPENREEL_FFMPEG_PATH, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter((p): p is string => Boolean(p));
const ffmpegBin = ffmpegCandidates.find((p) => existsSync(p));
const ffprobeBin = ffmpegBin ? path.join(path.dirname(ffmpegBin), "ffprobe") : undefined;
if (ffmpegBin) process.env.OPENREEL_FFMPEG_PATH = ffmpegBin;

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { ExportJob } from "../src/main/sidecar/export-job";
import { resolveExportArgs, sphericalExportFields } from "../src/main/ipc/export";
import { parseEncoders } from "../src/main/sidecar/encoder-probe";
import { readSphericalMetadata, blobReader } from "../../../packages/core/src/export/spherical-metadata";

const enabled = Boolean(ffmpegBin && ffprobeBin && existsSync(ffprobeBin));
const encoders = enabled ? parseEncoders(execFileSync(ffmpegBin!, ["-hide_banner", "-encoders"]).toString()) : [];
const suite = enabled && encoders.includes("libx264") ? describe : describe.skip;

const W = 640;
const H = 320;
const FRAMES = 12;
let work = "";

async function exportVr(name: string, format: "mp4" | "mov", vr?: { layout: "mono" | "over-under" | "side-by-side"; horizontalFov: number; verticalFov: number }): Promise<string> {
  const wav = path.join(work, `${name}.wav`);
  execFileSync(ffmpegBin!, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:a", "pcm_s16le", wav]);
  const frame = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    frame[i] = (x * 255) / W;
    frame[i + 1] = (y * 255) / H;
    frame[i + 2] = 90;
    frame[i + 3] = 255;
  }
  const out = path.join(work, `${name}.${format}`);
  const args = resolveExportArgs(
    {
      width: W, height: H, frameRate: 30, codec: "h264", format, bitrateKbps: 4000, outputPath: out, totalFrames: FRAMES,
      audioSampleRate: 48000, audioChannels: 2, encodeMode: "fast", quality: 80,
      ...(vr ? { vr } : {}),
    },
    "darwin",
    encoders.filter((e) => !e.endsWith("_videotoolbox")),
    wav,
  );
  await new Promise<void>((resolve, reject) => {
    const job = new ExportJob(args, () => {}, resolve, (message) => reject(new Error(message)));
    job.start();
    (async () => {
      for (let i = 0; i < FRAMES; i++) await job.writeFrame(frame);
      job.endInput();
    })().catch(reject);
  });
  return out;
}

const probe = (file: string): string => execFileSync(ffprobeBin!, ["-v", "error", "-show_streams", "-select_streams", "v:0", file]).toString();
const decodedFrames = (file: string): number => {
  const r = spawnSync(ffmpegBin!, ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8" });
  expect(r.stderr.trim(), "ffmpeg decodes the whole file without errors").toBe("");
  const n = spawnSync(ffprobeBin!, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  return Number(n.stdout.trim());
};

beforeAll(() => {
  if (enabled) work = mkdtempSync(path.join(os.tmpdir(), "openreel-spherical-"));
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("sphericalExportFields", () => {
  it("passes validated fields for MP4 / MOV only", () => {
    const vr = { layout: "over-under", horizontalFov: 360, verticalFov: 180 } as const;
    expect(sphericalExportFields({ vr, format: "mp4" })).toEqual({ vr });
    expect(sphericalExportFields({ vr, format: "mov" })).toEqual({ vr });
    expect(sphericalExportFields({ vr, format: "mkv" })).toEqual({});
    expect(sphericalExportFields({ format: "mp4" })).toEqual({});
    expect(() => sphericalExportFields({ vr: { ...vr, layout: "stacked" as never }, format: "mp4" })).toThrow(/layout/);
    expect(() => sphericalExportFields({ vr: { ...vr, horizontalFov: 500 }, format: "mp4" })).toThrow(/horizontal/);
  });
});

suite("desktop VR export through the ExportJob, verified with ffprobe", () => {
  it("MP4 over/under: Stereo 3D top and bottom + Spherical Mapping equirectangular, every frame still decodes", async () => {
    const out = await exportVr("vr-ou", "mp4", { layout: "over-under", horizontalFov: 360, verticalFov: 180 });
    const p = probe(out);
    expect(p).toContain("side_data_type=Spherical Mapping");
    expect(p).toContain("projection=equirectangular");
    expect(p).toMatch(/side_data_type=Stereo 3D\s+type=top and bottom/);
    expect(decodedFrames(out)).toBe(FRAMES);
    expect(await readSphericalMetadata(blobReader(new Blob([readFileSync(out)])))).toMatchObject({ layout: "over-under", horizontalFov: 360 });
  });

  it("MOV monoscopic: Spherical Mapping present, stereo mode 2D", async () => {
    const out = await exportVr("vr-mono", "mov", { layout: "mono", horizontalFov: 360, verticalFov: 180 });
    const p = probe(out);
    expect(p).toContain("side_data_type=Spherical Mapping");
    expect(p).toMatch(/side_data_type=Stereo 3D\s+type=2D/);
    expect(decodedFrames(out)).toBe(FRAMES);
  });

  it("a flat export is not tagged", async () => {
    const out = await exportVr("flat", "mp4");
    expect(probe(out)).not.toContain("Spherical Mapping");
  });
});
