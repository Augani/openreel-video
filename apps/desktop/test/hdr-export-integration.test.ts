/**
 * Real-ffmpeg check of the desktop HDR export: frames are converted exactly as the renderer converts them (core
 * `rgbaToYuv420` / `rgbaToYuv444`), piped through the real `ExportJob` argument builder, and the written file is read
 * back with ffprobe. No Electron here; `hdr-export-electron.test.ts` runs the same thing through the app.
 *
 * ffmpeg: the bundled sidecar when present, otherwise `OPENREEL_FFMPEG_PATH` or Homebrew's. Skipped without libx265.
 */
import { vi } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";

const candidates = [
  process.env.OPENREEL_FFMPEG_PATH,
  path.resolve(__dirname, "../resources/bin", `${process.platform}-${process.arch}/ffmpeg`),
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
].filter((p): p is string => !!p);
const FFMPEG = candidates.find((p) => existsSync(p));

vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => FFMPEG ?? "ffmpeg" }));

import { describe, it, expect, afterAll } from "vitest";
import { tmpdir } from "node:os";
import { existsSync, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { patchContentLightLevel } from "../src/main/sidecar/patch-content-light-level";
import { ExportJob, type ExportArgs } from "../src/main/sidecar/export-job";
import type { NativeColorOutput } from "../src/main/sidecar/color-output-args";
import { resolveOutputColorSpec, rgbaToYuv420, rgbaToYuv444, withBitDepth10 } from "../../../packages/core/src/export/color-output";

const run = promisify(execFile);
const stamp = Date.now();
const files: string[] = [];
const tmp = (name: string): string => {
  const p = path.join(tmpdir(), `openreel-hdr-${stamp}-${name}`);
  files.push(p);
  return p;
};

async function hasEncoder(name: string): Promise<boolean> {
  if (!FFMPEG) return false;
  const { stdout } = await run(FFMPEG, ["-hide_banner", "-encoders"]);
  return new RegExp(`\\s${name}\\s`).test(stdout);
}
const HAS_X265 = await hasEncoder("libx265");
const HAS_PRORES_KS = await hasEncoder("prores_ks");
// The bundled sidecar ships ffmpeg only, so an ffprobe beside it is optional: fall back to the one on PATH.
const siblingProbe = FFMPEG ? path.join(path.dirname(FFMPEG), "ffprobe") : undefined;
const ffprobe = siblingProbe && existsSync(siblingProbe) ? siblingProbe : "ffprobe";
const HAS_FFPROBE = await run(ffprobe, ["-version"]).then(() => true, () => false);

interface Probe {
  streams: Array<Record<string, string | number> & { side_data_list?: Array<Record<string, string | number>> }>;
  frames: Array<{ side_data_list?: Array<Record<string, string | number>> }>;
}
async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-read_intervals", "%+#1", "-of", "json", file]);
  return JSON.parse(stdout) as Probe;
}

/** A frame with a left-to-right grey ramp and a saturated bar, as the canvas would hold it. */
function rgbaFrame(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const v = Math.round((x / (w - 1)) * 255);
      const bar = y < h / 4;
      px[o] = bar ? 220 : v;
      px[o + 1] = bar ? 40 : v;
      px[o + 2] = bar ? 40 : v;
      px[o + 3] = 255;
    }
  }
  return px;
}

async function encode(args: Omit<ExportArgs, "audioWavPath">, color: NativeColorOutput, hdrSpec: ReturnType<typeof resolveOutputColorSpec>): Promise<void> {
  const wav = tmp(`${path.basename(args.outputPath)}.wav`);
  await run(FFMPEG!, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", wav]);
  const spec = color.chroma === "444" ? withBitDepth10(hdrSpec!) : hdrSpec!;
  const rgba = rgbaFrame(args.width, args.height);
  const yuv = color.chroma === "444" ? rgbaToYuv444(rgba, args.width, args.height, spec) : rgbaToYuv420(rgba, args.width, args.height, spec);
  await new Promise<void>((resolve, reject) => {
    const job = new ExportJob({ ...args, audioWavPath: wav, color }, () => {}, resolve, reject);
    job.start();
    (async () => {
      for (let i = 0; i < 12; i++) await job.writeFrame(new Uint8Array(yuv.data));
      job.endInput();
    })().catch(reject);
  });
}

afterAll(async () => {
  await Promise.all(files.map((f) => fs.rm(f, { force: true })));
});

describe.skipIf(!FFMPEG || !HAS_X265 || !HAS_FFPROBE)("desktop HDR export, read back with ffprobe", () => {
  const base = { width: 320, height: 180, frameRate: 24, mode: "fast" as const, quality: 80, bitrateKbps: 4000 };

  it("HDR10 (PQ): HEVC Main10 yuv420p10le, BT.2020, smpte2084, mastering display and content light level", async () => {
    const out = tmp("pq.mp4");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" };
    await encode({ ...base, codec: "hevc", encoder: "libx265", outputPath: out, format: "mp4" }, color, resolveOutputColorSpec("rec709", "pq"));
    const { streams, frames } = await probe(out);
    expect(streams[0]).toMatchObject({
      codec_name: "hevc",
      profile: "Main 10",
      pix_fmt: "yuv420p10le",
      color_primaries: "bt2020",
      color_transfer: "smpte2084",
      color_space: "bt2020nc",
      color_range: "tv",
    });
    const side = frames[0].side_data_list ?? [];
    const mastering = side.find((d) => d.side_data_type === "Mastering display metadata");
    const light = side.find((d) => d.side_data_type === "Content light level metadata");
    expect(mastering).toBeDefined();
    expect(mastering).toMatchObject({ red_x: "34000/50000", green_y: "34500/50000", max_luminance: "10000000/10000", min_luminance: "1/10000" });
    expect(light).toMatchObject({ max_content: 1000, max_average: 400 });
  }, 90_000);

  it("HDR10 (PQ): the measured MaxCLL / MaxFALL replace the declared 1000,400 in the finished file", async () => {
    const out = tmp("pq-measured.mp4");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" };
    await encode({ ...base, codec: "hevc", encoder: "libx265", outputPath: out, format: "mp4" }, color, resolveOutputColorSpec("rec709", "pq"));
    expect(await patchContentLightLevel(out, { maxCll: 603, maxFall: 112 })).toBeGreaterThan(0);
    const { streams, frames } = await probe(out);
    expect(streams[0]).toMatchObject({ pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "smpte2084" });
    const side = frames[0].side_data_list ?? [];
    expect(side.find((d) => d.side_data_type === "Content light level metadata")).toMatchObject({ max_content: 603, max_average: 112 });
    expect(side.find((d) => d.side_data_type === "Mastering display metadata")).toBeDefined();
    // The file still decodes end to end.
    await run(FFMPEG!, ["-v", "error", "-i", out, "-f", "null", "-"]);
  }, 90_000);

  it.skipIf(!HAS_PRORES_KS)("ProRes 422 HQ: the 4:4:4 planes are written as 10-bit 4:2:2 with the PQ tags", async () => {
    const out = tmp("pq-422hq.mov");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "444" };
    await encode({ ...base, codec: "prores", encoder: "prores_ks", proresProfile: "hq", outputPath: out, format: "mov" }, color, resolveOutputColorSpec("rec709", "pq"));
    const { streams } = await probe(out);
    expect(streams[0]).toMatchObject({ codec_name: "prores", profile: "HQ", pix_fmt: "yuv422p10le", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc" });
  }, 90_000);

  it("HLG: arib-std-b67 transfer, BT.2020, 10-bit", async () => {
    const out = tmp("hlg.mp4");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "hlg", bitDepth: 10, chroma: "420" };
    await encode({ ...base, codec: "hevc", encoder: "libx265", outputPath: out, format: "mp4" }, color, resolveOutputColorSpec("rec709", "hlg"));
    const { streams } = await probe(out);
    expect(streams[0]).toMatchObject({ pix_fmt: "yuv420p10le", color_primaries: "bt2020", color_transfer: "arib-std-b67", color_space: "bt2020nc" });
  }, 90_000);

  it("Rec.2020 SDR: 8-bit, BT.2020 primaries and matrix with the BT.709 transfer", async () => {
    const out = tmp("sdr2020.mp4");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "bt709", bitDepth: 8, chroma: "420" };
    await encode({ ...base, codec: "hevc", encoder: "libx265", outputPath: out, format: "mp4" }, color, resolveOutputColorSpec("rec2020", undefined));
    const { streams } = await probe(out);
    expect(streams[0]).toMatchObject({ pix_fmt: "yuv420p", color_primaries: "bt2020", color_transfer: "bt709", color_space: "bt2020nc" });
  }, 90_000);

  it.skipIf(!HAS_PRORES_KS)("ProRes 4444 XQ: 4:4:4, BT.2020 PQ tags in the .mov", async () => {
    const out = tmp("pq.mov");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "444" };
    await encode({ ...base, codec: "prores", encoder: "prores_ks", proresProfile: "4444xq", outputPath: out, format: "mov" }, color, resolveOutputColorSpec("rec709", "pq"));
    const { streams } = await probe(out);
    expect(streams[0]).toMatchObject({ codec_name: "prores", profile: "XQ", color_primaries: "bt2020", color_transfer: "smpte2084", color_space: "bt2020nc" });
    // ffprobe reports the decoded depth of ProRes 4444 as 12-bit 4:4:4.
    expect(String(streams[0].pix_fmt)).toMatch(/^yuv444p1[02]le$/);
  }, 90_000);

  it("the PQ picture is a real PQ encode, not 8-bit SDR sent as HDR: white sits at PQ signal ~0.58", async () => {
    const out = tmp("pq-pixels.mp4");
    const color: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" };
    await encode({ ...base, codec: "hevc", encoder: "libx265", outputPath: out, format: "mp4" }, color, resolveOutputColorSpec("rec709", "pq"));
    // Decode the last column of the ramp (SDR white) back to 10-bit luma.
    const { stdout } = await run(FFMPEG!, ["-v", "error", "-i", out, "-frames:v", "1", "-vf", `crop=2:2:${base.width - 2}:${base.height - 2}`, "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1 << 20 });
    const luma = (stdout as unknown as Buffer).readUInt16LE(0);
    // Limited-range 10-bit luma of PQ 0.5807 (203 nits): 64 + 876 * 0.5807 = 573.
    expect(luma).toBeGreaterThan(550);
    expect(luma).toBeLessThan(595);
  }, 90_000);
});
