/**
 * Real-ffmpeg coverage of the pro-media features, no Electron:
 *
 *  - delivery exports (ProRes 422 HQ / 4444 with alpha in MOV, DNxHR HQ / HQX in MXF and MOV) written by the
 *    same `ExportJob` the desktop app uses, then read back with ffprobe for codec, profile, pix_fmt, audio tracks;
 *  - MXF ingest: DNxHD/DNxHR (multi-track PCM), XDCAM HD422 (MPEG-2 422) and AVC-Intra sources are probed and
 *    decoded by the native decode service exactly like ProRes, and their audio tracks are enumerated.
 *
 * Skipped when ffmpeg / ffprobe are not installed (Homebrew path, or OPENREEL_FFMPEG_PATH next to an ffprobe).
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
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { ExportJob, type ExportArgs } from "../src/main/sidecar/export-job";
import { NativeDecodeService } from "../src/main/decode/native-decode";
import { parseFfmpegProbe } from "../src/main/ingest/probe-media";
import { resolveExportArgs } from "../src/main/ipc/export";

const enabled = Boolean(ffmpegBin && ffprobeBin && existsSync(ffprobeBin));
const d = enabled ? describe : describe.skip;

const W = 320;
const H = 180;
const FPS = 24;
const FRAMES = 12;

let work = "";

function sh(args: string[]): void {
  execFileSync(ffmpegBin!, ["-y", "-loglevel", "error", ...args]);
}

interface Probed {
  streams: Array<Record<string, string | number>>;
  format: { format_name: string };
}
function ffprobe(file: string): Probed {
  const out = execFileSync(ffprobeBin!, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 24 }).toString();
  return JSON.parse(out) as Probed;
}

/** Runs the real export job: gradient RGBA frames (alpha ramps from transparent on the left when `alpha`) plus a stereo wav. */
async function exportFile(out: string, over: Partial<ExportArgs> & Pick<ExportArgs, "codec" | "encoder" | "format">, alpha = false): Promise<void> {
  const wav = path.join(work, `${path.basename(out)}.wav`);
  sh(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-ac", "2", "-c:a", "pcm_s16le", wav]);
  const frame = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      frame[i] = (x * 255) / W;
      frame[i + 1] = (y * 255) / H;
      frame[i + 2] = 128;
      frame[i + 3] = alpha ? (x < W / 2 ? 0 : 255) : 255;
    }
  }
  const args: ExportArgs = {
    width: W, height: H, frameRate: FPS, mode: "smallest", quality: 100, bitrateKbps: 0,
    outputPath: out, audioWavPath: wav,
    ...over,
  };
  await new Promise<void>((resolve, reject) => {
    const job = new ExportJob(args, () => {}, resolve, (message) => reject(new Error(message)));
    job.start();
    (async () => {
      for (let i = 0; i < FRAMES; i++) await job.writeFrame(frame);
      job.endInput();
    })().catch(reject);
  });
}

beforeAll(() => {
  if (!enabled) return;
  work = mkdtempSync(path.join(os.tmpdir(), "openreel-pro-media-"));
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const video = (p: Probed) => p.streams.find((s) => s.codec_type === "video")!;
const audio = (p: Probed) => p.streams.filter((s) => s.codec_type === "audio");

d("delivery exports through the ExportJob, verified with ffprobe", () => {
  it("ProRes 422 HQ in MOV: prores HQ, yuv422p10le, one stereo PCM audio track", async () => {
    const out = path.join(work, "prores422hq.mov");
    await exportFile(out, { codec: "prores", encoder: "prores_ks", format: "mov", proresProfile: "hq" });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "prores", profile: "HQ", pix_fmt: "yuv422p10le", width: W, height: H });
    expect(audio(p)).toHaveLength(1);
    expect(audio(p)[0]).toMatchObject({ codec_name: "pcm_s24le", channels: 2, sample_rate: "48000" });
    expect(String(p.format.format_name)).toContain("mov");
  });

  it("ProRes 4444 with alpha: yuva444p10le, and the transparent half of the picture decodes transparent", async () => {
    const out = path.join(work, "prores4444.mov");
    await exportFile(out, { codec: "prores", encoder: "prores_ks", format: "mov", proresProfile: "4444", alpha: true }, true);
    const p = ffprobe(out);
    // ProRes 4444 files decode as 12-bit planar (the codec's native depth); the encoder was fed 10-bit yuva444p10le.
    expect(video(p)).toMatchObject({ codec_name: "prores", profile: "4444" });
    expect(String(video(p).pix_fmt)).toMatch(/^yuva444p1[02]le$/);
    expect(audio(p)).toHaveLength(1);
    const rgba = execFileSync(ffmpegBin!, ["-v", "error", "-i", out, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
    const alphaAt = (x: number, y: number): number => rgba[(y * W + x) * 4 + 3];
    expect(alphaAt(10, 90)).toBeLessThan(8);
    expect(alphaAt(W - 10, 90)).toBeGreaterThan(247);
  });

  it("ProRes 4444 without the alpha option writes an opaque yuv444p10le picture", async () => {
    const out = path.join(work, "prores4444-opaque.mov");
    await exportFile(out, { codec: "prores", encoder: "prores_ks", format: "mov", proresProfile: "4444" });
    const v = video(ffprobe(out));
    expect(v.profile).toBe("4444");
    expect(String(v.pix_fmt)).toMatch(/^yuv444p1[02]le$/);
  });

  const dnx: Array<[string, "hq" | "hqx", "mxf" | "mov", string, string]> = [
    ["DNxHR HQ in MXF", "hq", "mxf", "DNXHR HQ", "yuv422p"],
    ["DNxHR HQX in MXF", "hqx", "mxf", "DNXHR HQX", "yuv422p10le"],
    ["DNxHR HQ in MOV", "hq", "mov", "DNXHR HQ", "yuv422p"],
    ["DNxHR HQX in MOV", "hqx", "mov", "DNXHR HQX", "yuv422p10le"],
  ];
  for (const [label, dnxhrProfile, format, profile, pix] of dnx) {
    it(`${label}: dnxhd ${profile}, ${pix}, PCM audio`, async () => {
      const out = path.join(work, `dnxhr-${dnxhrProfile}.${format}`);
      await exportFile(out, { codec: "dnxhr", encoder: "dnxhd", format, dnxhrProfile });
      const p = ffprobe(out);
      expect(video(p)).toMatchObject({ codec_name: "dnxhd", profile, pix_fmt: pix, width: W, height: H });
      const tracks = audio(p);
      expect(tracks.length).toBeGreaterThanOrEqual(1);
      for (const t of tracks) expect(t).toMatchObject({ codec_name: "pcm_s24le", sample_rate: "48000" });
      // Two channels in total, however the muxer splits them (QuickTime: one stereo track; MXF: may be mono pairs).
      expect(tracks.reduce((n, t) => n + Number(t.channels), 0)).toBe(2);
      expect(String(p.format.format_name)).toContain(format === "mxf" ? "mxf" : "mov");
    });
  }

  it("the exported MXF is decoded back natively frame for frame (the export is re-importable)", async () => {
    const out = path.join(work, "dnxhr-hq.mxf");
    const service = new NativeDecodeService();
    const probe = await service.probe(out);
    expect(probe).toMatchObject({ codec: "dnxhd", width: W, height: H, container: "mxf" });
    const frame = await service.getFrame(out, 0.25, { quality: "full" });
    expect(frame?.frameIndex).toBe(6);
    service.dispose();
  });

  it("resolveExportArgs routes 4444 to prores_ks even when VideoToolbox ProRes is listed, and DNxHR to the dnxhd encoder", () => {
    const base = { width: W, height: H, frameRate: FPS, bitrateKbps: 0, outputPath: "/tmp/x", totalFrames: 1, audioSampleRate: 48000, audioChannels: 2 };
    const encoders = ["prores_videotoolbox", "prores_ks", "dnxhd", "libx264"];
    expect(resolveExportArgs({ ...base, codec: "prores", format: "mov", proresProfile: "4444", alpha: true }, "darwin", encoders, "/tmp/a.wav")).toMatchObject({ encoder: "prores_ks", alpha: true });
    expect(resolveExportArgs({ ...base, codec: "prores", format: "mov", proresProfile: "hq", alpha: true }, "darwin", encoders, "/tmp/a.wav")).toMatchObject({ encoder: "prores_videotoolbox", alpha: false });
    expect(resolveExportArgs({ ...base, codec: "dnxhr", format: "mxf", dnxhrProfile: "hqx" }, "darwin", encoders, "/tmp/a.wav")).toMatchObject({ encoder: "dnxhd", codec: "dnxhr", dnxhrProfile: "hqx", format: "mxf" });
  });
});

d("MXF ingest: probe and native decode of broadcast sources", () => {
  const files: Record<string, { file: string; codec: string; interlaced: boolean; audio: number }> = {};

  beforeAll(() => {
    const src = ["-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=25:duration=2`];
    const sines = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=2"];
    const tags = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
    // DNxHR HQ with two mono PCM tracks (as a camera or Avid writes OP1a).
    files.dnxhr = { file: path.join(work, "cam-dnxhr.mxf"), codec: "dnxhd", interlaced: false, audio: 2 };
    sh([...src, ...sines, "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p", ...tags, "-c:a", "pcm_s24le", "-f", "mxf", files.dnxhr.file]);
    // XDCAM HD422: MPEG-2 4:2:2 intra-frame-ish long GOP, interlaced, 50 Mb/s.
    files.xdcam = { file: path.join(work, "cam-xdcam.mxf"), codec: "mpeg2video", interlaced: true, audio: 2 };
    sh([...src, ...sines, "-map", "0:v", "-map", "1:a", "-map", "2:a", "-vf", "setfield=tff", "-c:v", "mpeg2video", "-pix_fmt", "yuv422p", "-b:v", "50M", "-minrate", "50M", "-maxrate", "50M", "-bufsize", "17M", "-flags", "+ildct+ilme", ...tags, "-c:a", "pcm_s24le", "-f", "mxf", files.xdcam.file]);
    // AVC-Intra style: all-intra H.264 High 4:2:2 10-bit (WebCodecs knows H.264, but not this MXF wrapper).
    files.avci = { file: path.join(work, "cam-avci.mxf"), codec: "h264", interlaced: false, audio: 2 };
    sh([...src, ...sines, "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "libx264", "-profile:v", "high422", "-pix_fmt", "yuv422p10le", "-x264-params", "keyint=1:intra-refresh=0", ...tags, "-c:a", "pcm_s24le", "-f", "mxf", files.avci.file]);
  });

  /** ffmpeg's own decode of frame N, the reference the service must match. */
  const reference = (file: string, n: number): Buffer =>
    execFileSync(ffmpegBin!, ["-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=${W}:${H}:flags=bicubic+accurate_rnd+full_chroma_int:in_color_matrix=bt709`, "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });

  for (const key of ["dnxhr", "xdcam", "avci"]) {
    it(`${key}: probe reports container, codec, geometry, frame count and every audio track; frames decode like ffmpeg's own`, async () => {
      const f = files[key];
      const service = new NativeDecodeService();
      const probe = await service.probe(f.file);
      expect(probe).toMatchObject({ codec: f.codec, width: W, height: H, frameRate: 25, container: "mxf", interlaced: f.interlaced });
      expect(probe!.frameCount).toBe(50);
      // MXF carries one mono PCM stream per channel.
      expect(probe!.audioStreams).toHaveLength(f.audio);
      for (const s of probe!.audioStreams) expect(s).toMatchObject({ codec: "pcm_s24le", channels: 1, sampleRate: 48000 });
      for (const n of [0, 13, 49]) {
        const frame = await service.getFrame(f.file, n / 25, { quality: "full" });
        expect(frame, `frame ${n}`).not.toBeNull();
        expect(frame!.frameIndex).toBe(n);
        const ref = reference(f.file, n);
        expect(frame!.rgba.length).toBe(ref.length);
        let max = 0;
        for (let i = 0; i < ref.length; i++) max = Math.max(max, Math.abs(frame!.rgba[i] - ref[i]));
        expect(max, `frame ${n} matches ffmpeg's decode`).toBeLessThanOrEqual(1);
      }
      service.dispose();
    });
  }
});
