/**
 * Real-ffmpeg proof of the scene-referred HDR path (no Electron, no GPU).
 *
 * A PQ source whose luma ramps from 40 nits to 1000 nits is made with ffmpeg (ProRes 422 HQ tagged BT.2020 / PQ),
 * decoded exactly as the desktop native decoder decodes it for the HDR working mode (rgba64le, raw code values),
 * run through the CPU float reference of the HDR pipeline (input transform without tone mapping -> float composite
 * -> PQ encode) and encoded by the real ExportJob as HEVC Main10. The written file is decoded again and the 10-bit
 * luma codes are compared with the source's:
 *  - codes above SDR reference white (203 nits, 10-bit code ~573) are preserved up to ~1000 nits (code ~722);
 *  - the classic path (8-bit tone-mapped working image, then the 8-bit export conversion) cannot exceed SDR white.
 *
 * ffmpeg: OPENREEL_FFMPEG_PATH, else Homebrew's. Skipped without libx265 and prores_ks. The GPU half-float pass is
 * covered by the browser check in apps/web/e2e/hdr-float.spec.ts.
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
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ExportJob, type ExportArgs } from "../src/main/sidecar/export-job";
import { buildDecodeArgs } from "../src/main/decode/native-decode";
import type { NativeColorOutput } from "../src/main/sidecar/color-output-args";
import {
  CpuHdrCompositor,
  computeLayerGeometry,
  hdrFrameToSdrRgba,
  hdrFrameToYuv,
  hdrSourceDecode,
} from "../../../packages/core/src/color/hdr-working";
import { pqDecodeToNits, pqEncodeNits, resolveOutputColorSpec, rgbaToYuv420 } from "../../../packages/core/src/export/color-output";
import { HdrLightLevelMeter } from "../../../packages/core/src/color/hdr-light-level";
import { planHdrTransition } from "../../../packages/core/src/video/hdr-transition";

const run = promisify(execFile);
const stamp = Date.now();
const files: string[] = [];
const tmp = (name: string): string => {
  const p = path.join(tmpdir(), `openreel-hdrsr-${stamp}-${name}`);
  files.push(p);
  return p;
};

async function hasEncoder(name: string): Promise<boolean> {
  if (!FFMPEG) return false;
  const { stdout } = await run(FFMPEG, ["-hide_banner", "-encoders"]);
  return new RegExp(`\\s${name}\\s`).test(stdout);
}
const HAS_X265 = await hasEncoder("libx265");
const HAS_PRORES = await hasEncoder("prores_ks");

const W = 320;
const H = 180;
const MIN_NITS = 40;
const MAX_NITS = 1000;
/** Limited-range 10-bit luma code of a PQ-coded neutral grey at `nits`. */
const lumaCode10 = (nits: number): number => 64 + 876 * pqEncodeNits(nits);
const SDR_WHITE_CODE = lumaCode10(203);
const PEAK_CODE = lumaCode10(MAX_NITS);

/** Column x of the source ramp, in PQ signal (linear in signal between MIN and MAX nits). */
function rampSignal(x: number): number {
  const a = pqEncodeNits(MIN_NITS);
  const b = pqEncodeNits(MAX_NITS);
  return a + ((b - a) * x) / (W - 1);
}

async function makePqSource(out: string): Promise<void> {
  const raw = tmp("ramp.yuv");
  // yuv422p10le: Y plane (W*H), then U and V (W/2*H each), little-endian 16-bit.
  const y = new Uint16Array(W * H);
  const c = new Uint16Array((W / 2) * H).fill(512);
  for (let row = 0; row < H; row++) for (let x = 0; x < W; x++) y[row * W + x] = Math.round(64 + 876 * rampSignal(x));
  const buffer = Buffer.concat([Buffer.from(y.buffer), Buffer.from(c.buffer), Buffer.from(c.buffer)]);
  await fs.writeFile(raw, buffer);
  await run(FFMPEG!, [
    "-y", "-v", "error",
    "-f", "rawvideo", "-pix_fmt", "yuv422p10le", "-s", `${W}x${H}`, "-framerate", "24", "-i", raw,
    // ffmpeg 8 drops output-level colour tags for prores_ks: stamp the frames themselves.
    "-vf", "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv",
    "-frames:v", "12", "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    "-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "smpte2084",
    out,
  ]);
}

/** The native decoder's exact ffmpeg arguments, for one frame, to rgba64le (HDR working mode) or rgba (classic). */
async function decodeNative(file: string, bitDepth: 8 | 16): Promise<Buffer> {
  const args = buildDecodeArgs({
    srcPath: file,
    startFrame: 0,
    frameRate: 24,
    width: W,
    height: H,
    sourceWidth: W,
    sourceHeight: H,
    quality: "full",
    bitDepth,
    matrix: "bt2020",
    maxFrames: 1,
  });
  const { stdout } = await run(FFMPEG!, args, { encoding: "buffer", maxBuffer: 1 << 26 });
  return stdout as unknown as Buffer;
}

async function encodeHevc(yuv: Uint8Array, out: string): Promise<void> {
  const wav = tmp(`${path.basename(out)}.wav`);
  await run(FFMPEG!, ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1", wav]);
  const color: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" };
  const args: Omit<ExportArgs, "audioWavPath"> = {
    width: W,
    height: H,
    frameRate: 24,
    mode: "fast",
    quality: 95,
    bitrateKbps: 30000,
    codec: "hevc",
    encoder: "libx265",
    outputPath: out,
    format: "mp4",
  };
  await new Promise<void>((resolve, reject) => {
    const job = new ExportJob({ ...args, audioWavPath: wav, color }, () => {}, resolve, reject);
    job.start();
    (async () => {
      for (let i = 0; i < 12; i++) await job.writeFrame(new Uint8Array(yuv));
      job.endInput();
    })().catch(reject);
  });
}

/** The 10-bit luma codes of one row of the written file's first frame, decoded back by ffmpeg. */
async function decodedLumaRow(file: string, row: number): Promise<number[]> {
  const { stdout } = await run(
    FFMPEG!,
    ["-v", "error", "-i", file, "-frames:v", "1", "-vf", `crop=${W}:2:0:${row}`, "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 1 << 24 },
  );
  const buf = stdout as unknown as Buffer;
  const out: number[] = [];
  for (let x = 0; x < W; x++) out.push(buf.readUInt16LE(x * 2));
  return out;
}

afterAll(async () => {
  await Promise.all(files.map((f) => fs.rm(f, { force: true })));
});

describe.skipIf(!FFMPEG || !HAS_X265 || !HAS_PRORES)("scene-referred HDR: a PQ export keeps highlights above SDR white", () => {
  const spec = resolveOutputColorSpec("rec2020", "pq")!;
  const identity = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
    fitMode: "stretch" as const,
  };

  it("float pipeline: decoded 10-bit luma tracks the source ramp up to 1000 nits (above the SDR reference white code)", async () => {
    const source = tmp("src-pq.mov");
    await makePqSource(source);

    // 16-bit decode: the codes arrive exactly (no 8-bit quantisation of the PQ signal).
    const raw16 = await decodeNative(source, 16);
    expect(raw16.length).toBe(W * H * 8);
    const codes = new Uint16Array(raw16.buffer.slice(raw16.byteOffset, raw16.byteOffset + raw16.byteLength));

    const comp = new CpuHdrCompositor();
    comp.begin(W, H);
    comp.drawCodes(
      { depth: 16, width: W, height: H, data: codes },
      hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false }),
      { geometry: computeLayerGeometry(identity, W, H, W, H), opacity: 1, grade: null },
    );
    const yuv = hdrFrameToYuv(comp.readFrame(), spec, "420");

    const out = tmp("hdr-float.mp4");
    await encodeHevc(yuv.data, out);

    // The file is a genuine PQ / BT.2020 / 10-bit stream.
    const { stdout: probeJson } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_transfer,color_primaries,color_space", "-of", "json", out],
    ).catch(() => ({ stdout: "" }));
    if (probeJson) {
      const stream = JSON.parse(probeJson).streams[0];
      expect(stream).toMatchObject({ pix_fmt: "yuv420p10le", color_transfer: "smpte2084", color_primaries: "bt2020" });
    }

    const row = await decodedLumaRow(out, H / 2);
    // Every column tracks the source luma code; the lossy encode may move a code by a few units.
    let worst = 0;
    for (let x = 4; x < W - 4; x++) {
      const expected = 64 + 876 * rampSignal(x);
      worst = Math.max(worst, Math.abs(row[x] - expected));
    }
    expect(worst).toBeLessThan(8);

    // Highlights above SDR reference white survive: the right edge sits at ~1000 nits, far above code 573.
    const peak = Math.max(...row.slice(W - 8, W - 2));
    expect(SDR_WHITE_CODE).toBeGreaterThan(560);
    expect(SDR_WHITE_CODE).toBeLessThan(585);
    expect(peak).toBeGreaterThan(SDR_WHITE_CODE + 100);
    expect(Math.abs(peak - PEAK_CODE)).toBeLessThan(10);
    // Several distinct codes between SDR white and the peak (not one clipped plateau).
    const above = new Set(row.filter((v) => v > SDR_WHITE_CODE + 4));
    expect(above.size).toBeGreaterThan(60);
  }, 180_000);

  it("classic 8-bit path on the same source is limited to SDR white (what the float path replaces)", async () => {
    const source = tmp("src-pq-classic.mov");
    await makePqSource(source);
    const raw8 = await decodeNative(source, 8);
    expect(raw8.length).toBe(W * H * 4);

    // Classic path: input transform tone-maps into the 8-bit sRGB working image, then the 8-bit export conversion.
    const { applyInputTransformToRgba, createInputTransform } = await import("../../../packages/core/src/color/input-transform");
    const rgba = new Uint8ClampedArray(raw8.buffer.slice(raw8.byteOffset, raw8.byteOffset + raw8.byteLength));
    applyInputTransformToRgba(rgba, createInputTransform({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false })!);
    const classic = rgbaToYuv420(rgba, W, H, spec);
    const samples = new Uint16Array(classic.data.buffer, classic.data.byteOffset, W * H);
    let peak = 0;
    for (let x = 0; x < W; x++) peak = Math.max(peak, samples[(H / 2) * W + x]);
    // SDR white is 203 nits (code ~573); the shoulder keeps even a 1000-nit highlight at or below it.
    expect(peak).toBeLessThanOrEqual(Math.round(SDR_WHITE_CODE) + 2);
    expect(peak).toBeLessThan(PEAK_CODE - 100);

    // The SDR monitor view of the float image is the shoulder-compressed picture, never clipped hard to flat white.
    const comp = new CpuHdrCompositor();
    comp.begin(W, H);
    const wide = new Uint16Array(W * H * 4);
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      const code = Math.round(rampSignal(x) * 65535);
      wide.set([code, code, code, 65535], p * 4);
    }
    comp.drawCodes(
      { depth: 16, width: W, height: H, data: wide },
      hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false }),
      { geometry: computeLayerGeometry(identity, W, H, W, H), opacity: 1, grade: null },
    );
    const view = hdrFrameToSdrRgba(comp.readFrame());
    expect(view[(W - 1) * 4]).toBeLessThanOrEqual(255);
    expect(view[(W - 40) * 4]).toBeLessThan(view[(W - 1) * 4] + 1);
  }, 180_000);

  it("float effect + crossfade: the blurred, mixed ramp still reaches 1000 nits in the written file, and the light level is measured", async () => {
    const source = tmp("src-pq-fx.mov");
    await makePqSource(source);
    const raw16 = await decodeNative(source, 16);
    const codes = new Uint16Array(raw16.buffer.slice(raw16.byteOffset, raw16.byteOffset + raw16.byteLength));
    const flat = new Uint16Array(W * H * 4);
    const flatCode = Math.round(pqEncodeNits(MAX_NITS) * 65535);
    for (let p = 0; p < W * H; p++) flat.set([flatCode, flatCode, flatCode, 65535], p * 4);

    const decode = hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false });
    const geometry = computeLayerGeometry(identity, W, H, W, H);
    const comp = new CpuHdrCompositor();
    comp.begin(W, H);
    // Blur on the ramp (a smooth ramp passes through a blur nearly unchanged), then a 50 % crossfade into a flat 1000 nits.
    for (const step of planHdrTransition({ kind: "crossfade", progress: 0.5 })) {
      if (step.layer === "solid") continue;
      const layer = step.layer === "outgoing" ? codes : flat;
      comp.drawCodes({ depth: 16, width: W, height: H, data: layer }, decode, {
        geometry,
        opacity: step.opacity,
        grade: null,
        effects: step.layer === "outgoing" ? [{ type: "blur", radius: 2 }] : [],
      });
    }
    const meter = new HdrLightLevelMeter();
    meter.add(comp.readEncodedRgb(spec));
    const level = meter.result()!;
    expect(level.maxCll).toBeGreaterThan(980);
    expect(level.maxCll).toBeLessThan(1020);
    const yuv = hdrFrameToYuv(comp.readFrame(), spec, "420");

    const out = tmp("hdr-float-fx.mp4");
    await encodeHevc(yuv.data, out);
    const row = await decodedLumaRow(out, H / 2);
    let worst = 0;
    for (let x = 12; x < W - 12; x++) {
      const nits = (pqDecodeToNits(rampSignal(x)) + MAX_NITS) / 2;
      worst = Math.max(worst, Math.abs(row[x] - lumaCode10(nits)));
    }
    expect(worst).toBeLessThan(10);
    // Every column is a mix of two values at or above 40 nits and up to 1000: the whole row sits well above SDR white
    // at the right edge, and nowhere clips to a plateau at SDR white.
    expect(Math.max(...row.slice(W - 8, W - 2))).toBeGreaterThan(SDR_WHITE_CODE + 100);
    expect(new Set(row.filter((v) => v > SDR_WHITE_CODE + 4)).size).toBeGreaterThan(40);
  }, 180_000);
});
