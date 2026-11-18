/**
 * Real-ffmpeg coverage of the broadcast delivery exports, no Electron. Each file is written by the same
 * `resolveExportArgs` + `ExportJob` the desktop app runs and read back with ffprobe:
 *
 *  - XDCAM HD422 (MPEG-2 4:2:2 @ High Level, 50 Mb/s) in MXF OP1a, interlaced (field order tt) and progressive;
 *  - AVC-Intra 100 (libx264, High 4:2:2 Intra, 10-bit) in MXF OP1a;
 *  - MXF OP-Atom: one file per essence track;
 *  - 8 mono PCM tracks (stereo mix on 1-2, silence after) in MXF and MOV, with the stream count and channel content checked;
 *  - a start timecode written to MXF and MOV (including drop frame) and read back by the importer's probe.
 *
 * Skipped when ffmpeg / ffprobe are not installed (Homebrew path, or OPENREEL_FFMPEG_PATH next to an ffprobe)
 * or the ffmpeg lacks libx264 / mpeg2video (the AVC-Intra tests need libx264).
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
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { ExportJob, exportOutputPaths } from "../src/main/sidecar/export-job";
import { probeMediaFile } from "../src/main/ingest/probe-media";
import { resolveExportArgs } from "../src/main/ipc/export";
import { parseEncoders } from "../src/main/sidecar/encoder-probe";

const enabled = Boolean(ffmpegBin && ffprobeBin && existsSync(ffprobeBin));
const encoderList = enabled ? execFileSync(ffmpegBin!, ["-hide_banner", "-encoders"]).toString() : "";
const encoders = parseEncoders(encoderList);
const hasMpeg2 = encoders.includes("mpeg2video");
const hasX264 = encoders.includes("libx264");
const xdcam = enabled && hasMpeg2 ? describe : describe.skip;
const avci = enabled && hasX264 ? describe : describe.skip;
const generic = enabled ? describe : describe.skip;

const W = 1920;
const H = 1080;
const FRAMES = 10;

let work = "";

function sh(args: string[]): void {
  execFileSync(ffmpegBin!, ["-y", "-loglevel", "error", ...args]);
}

interface Probed {
  streams: Array<Record<string, string | number> & { tags?: Record<string, string> }>;
  format: { format_name: string; tags?: Record<string, string> };
}
function ffprobe(file: string): Probed {
  const out = execFileSync(ffprobeBin!, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 24 }).toString();
  return JSON.parse(out) as Probed;
}
const video = (p: Probed) => p.streams.find((s) => s.codec_type === "video")!;
const audio = (p: Probed) => p.streams.filter((s) => s.codec_type === "audio");
/** Timecode tag of a file: MXF carries it on the format, QuickTime on the video and the tmcd stream. */
const timecodeOf = (p: Probed): string | undefined => p.format.tags?.timecode ?? p.streams.find((s) => s.tags?.timecode)?.tags?.timecode;

/** Peak level in dB of audio stream `index` (volumedetect, which reports on stderr); -inf for digital silence. */
function maxVolume(file: string, index: number): number {
  const r = spawnSync(ffmpegBin!, ["-hide_banner", "-nostats", "-i", file, "-map", `0:a:${index}`, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(r.stderr);
  if (!m) return Number.NaN;
  return m[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(m[1]);
}

interface Delivery {
  codec: "xdcamhd422" | "avcintra100" | "prores" | "dnxhr";
  format: "mxf" | "mov";
  frameRate: number;
  scan?: "progressive" | "interlaced-tff";
  mxfPattern?: "op1a" | "opatom";
  audioTrackCount?: number;
  startTimecode?: string;
  proresProfile?: "hq";
}

/** Runs the real export: gradient RGBA frames plus a WAV whose first two channels carry a tone and the rest are silent. */
async function deliver(name: string, d: Delivery): Promise<{ out: string; files: string[] }> {
  const channels = d.audioTrackCount ?? 2;
  const wav = path.join(work, `${name}.wav`);
  const pan = `pan=${channels}c|c0=c0|c1=c0`;
  sh(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-af", pan, "-c:a", "pcm_s16le", wav]);
  const frame = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      frame[i] = (x * 255) / W;
      frame[i + 1] = (y * 255) / H;
      frame[i + 2] = 128;
      frame[i + 3] = 255;
    }
  }
  const out = path.join(work, `${name}.${d.format}`);
  const args = resolveExportArgs(
    {
      width: W, height: H, frameRate: d.frameRate, codec: d.codec, format: d.format, bitrateKbps: 0, outputPath: out, totalFrames: FRAMES,
      audioSampleRate: 48000, audioChannels: channels, encodeMode: "smallest", quality: 100,
      ...(d.proresProfile ? { proresProfile: d.proresProfile } : {}),
      ...(d.scan ? { scan: d.scan } : {}),
      ...(d.mxfPattern ? { mxfPattern: d.mxfPattern } : {}),
      ...(d.audioTrackCount ? { audioTrackCount: d.audioTrackCount } : {}),
      ...(d.startTimecode ? { startTimecode: d.startTimecode } : {}),
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
  return { out, files: exportOutputPaths(args) };
}

beforeAll(() => {
  if (!enabled) return;
  work = mkdtempSync(path.join(os.tmpdir(), "openreel-broadcast-"));
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

xdcam("XDCAM HD422 exports through the ExportJob, verified with ffprobe", () => {
  it("1080i25 MXF OP1a: mpeg2video 4:2:2 profile, High level, yuv422p, top field first, 50 Mb/s, 8 mono PCM tracks, timecode 10:00:00:00", async () => {
    const { out } = await deliver("xdcam-i25", { codec: "xdcamhd422", format: "mxf", frameRate: 25, scan: "interlaced-tff", audioTrackCount: 8, startTimecode: "10:00:00:00" });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "mpeg2video", profile: "4:2:2", level: 2, pix_fmt: "yuv422p", field_order: "tt", width: W, height: H, r_frame_rate: "25/1" });
    expect(Number(video(p).bit_rate)).toBe(50_000_000);
    const tracks = audio(p);
    expect(tracks).toHaveLength(8);
    for (const t of tracks) expect(t).toMatchObject({ codec_name: "pcm_s24le", channels: 1, sample_rate: "48000" });
    expect(String(p.format.format_name)).toBe("mxf");
    expect(timecodeOf(p)).toBe("10:00:00:00");
    // Tracks 1 and 2 carry the mix, 3 to 8 are silent.
    expect(maxVolume(out, 0)).toBeGreaterThan(-20);
    expect(maxVolume(out, 1)).toBeGreaterThan(-20);
    for (let i = 2; i < 8; i++) expect(maxVolume(out, i)).toBeLessThan(-80);
  }, 120_000);

  it("1080p25 MXF OP1a is progressive; the stereo mix without mono tracks stays two mono MXF streams of one WAV", async () => {
    const { out } = await deliver("xdcam-p25", { codec: "xdcamhd422", format: "mxf", frameRate: 25 });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "mpeg2video", profile: "4:2:2", level: 2, pix_fmt: "yuv422p", field_order: "progressive" });
    expect(Number(video(p).bit_rate)).toBe(50_000_000);
    expect(audio(p).reduce((n, t) => n + Number(t.channels), 0)).toBe(2);
    expect(timecodeOf(p)).toBe("00:00:00:00");
  }, 120_000);

  it("MXF OP-Atom writes one file per essence track, each tagged with the start timecode", async () => {
    const { out, files } = await deliver("xdcam-atom", { codec: "xdcamhd422", format: "mxf", frameRate: 25, scan: "interlaced-tff", mxfPattern: "opatom", audioTrackCount: 4, startTimecode: "10:00:00:00" });
    expect(files.map((f) => path.basename(f))).toEqual(["xdcam-atom_V01.mxf", "xdcam-atom_A01.mxf", "xdcam-atom_A02.mxf", "xdcam-atom_A03.mxf", "xdcam-atom_A04.mxf"]);
    expect(existsSync(out)).toBe(false);
    const v = ffprobe(files[0]);
    expect(v.streams).toHaveLength(1);
    expect(video(v)).toMatchObject({ codec_name: "mpeg2video", profile: "4:2:2", pix_fmt: "yuv422p", field_order: "tt" });
    expect(timecodeOf(v)).toBe("10:00:00:00");
    files.slice(1).forEach((file, i) => {
      const a = ffprobe(file);
      expect(a.streams).toHaveLength(1);
      expect(a.streams[0]).toMatchObject({ codec_type: "audio", codec_name: "pcm_s24le", channels: 1 });
      expect(timecodeOf(a)).toBe("10:00:00:00");
      expect(maxVolume(file, 0)).toBeGreaterThan(i < 2 ? -20 : -200);
      if (i >= 2) expect(maxVolume(file, 0)).toBeLessThan(-80);
    });
  }, 120_000);

  it("drop-frame 29.97 start timecode is written with the semicolon and read back by the importer's probe", async () => {
    const { out } = await deliver("xdcam-df", { codec: "xdcamhd422", format: "mxf", frameRate: 30000 / 1001, scan: "interlaced-tff", startTimecode: "10:00:00;00" });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "mpeg2video", r_frame_rate: "30000/1001", field_order: "tt" });
    expect(timecodeOf(p)).toBe("10:00:00;00");
    expect((await probeMediaFile(out))?.startTimecode).toBe("10:00:00;00");
  }, 120_000);
});

avci("AVC-Intra 100 exports through the ExportJob, verified with ffprobe", () => {
  it("1080i25 MXF OP1a: h264 High 4:2:2 Intra, yuv422p10le, level 4.1, top field first, mono tracks, timecode", async () => {
    const { out } = await deliver("avci-i25", { codec: "avcintra100", format: "mxf", frameRate: 25, scan: "interlaced-tff", audioTrackCount: 8, startTimecode: "10:00:00:00" });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "h264", profile: "High 4:2:2 Intra", level: 41, pix_fmt: "yuv422p10le", field_order: "tt", width: W, height: H });
    expect(audio(p)).toHaveLength(8);
    for (const t of audio(p)) expect(t).toMatchObject({ codec_name: "pcm_s24le", channels: 1 });
    expect(timecodeOf(p)).toBe("10:00:00:00");
  }, 180_000);

  it("1080p25 is progressive and every frame is an intra picture", async () => {
    const { out } = await deliver("avci-p25", { codec: "avcintra100", format: "mxf", frameRate: 25 });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "h264", profile: "High 4:2:2 Intra", pix_fmt: "yuv422p10le", field_order: "progressive" });
    const types = execFileSync(ffprobeBin!, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pict_type", "-of", "csv=p=0", out]).toString().trim().split(/[\s,]+/).filter(Boolean);
    expect(types.length).toBe(FRAMES);
    expect(new Set(types)).toEqual(new Set(["I"]));
  }, 180_000);

  it("OP-Atom AVC-Intra: picture file is h264 High 4:2:2 Intra, audio files are mono PCM", async () => {
    const { files } = await deliver("avci-atom", { codec: "avcintra100", format: "mxf", frameRate: 25, mxfPattern: "opatom", audioTrackCount: 2, startTimecode: "10:00:00:00" });
    expect(files).toHaveLength(3);
    expect(video(ffprobe(files[0]))).toMatchObject({ codec_name: "h264", profile: "High 4:2:2 Intra" });
    for (const f of files) expect(timecodeOf(ffprobe(f))).toBe("10:00:00:00");
  }, 180_000);
});

generic("mono tracks and timecode in MOV and MXF masters", () => {
  it("ProRes 422 HQ MOV with 8 mono PCM tracks and a 10:00:00:00 timecode track", async () => {
    const { out } = await deliver("prores-8ch", { codec: "prores", format: "mov", frameRate: 25, proresProfile: "hq", audioTrackCount: 8, startTimecode: "10:00:00:00" });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "prores", profile: "HQ", pix_fmt: "yuv422p10le" });
    expect(audio(p)).toHaveLength(8);
    for (const t of audio(p)) expect(t).toMatchObject({ codec_name: "pcm_s24le", channels: 1, sample_rate: "48000" });
    expect(p.streams.some((s) => s.codec_tag_string === "tmcd")).toBe(true);
    expect(timecodeOf(p)).toBe("10:00:00:00");
    expect(maxVolume(out, 0)).toBeGreaterThan(-20);
    expect(maxVolume(out, 7)).toBeLessThan(-80);
    expect((await probeMediaFile(out))?.startTimecode).toBe("10:00:00:00");
  }, 120_000);

  it("DNxHR HQ MXF OP1a with 4 mono tracks and timecode; the importer's probe reads the start timecode and 4 audio streams", async () => {
    const { out } = await deliver("dnxhr-4ch", { codec: "dnxhr", format: "mxf", frameRate: 25, audioTrackCount: 4, startTimecode: "01:00:00:00" });
    const p = ffprobe(out);
    expect(video(p)).toMatchObject({ codec_name: "dnxhd", profile: "DNXHR HQ", pix_fmt: "yuv422p" });
    expect(audio(p)).toHaveLength(4);
    expect(timecodeOf(p)).toBe("01:00:00:00");
    const probed = await probeMediaFile(out);
    expect(probed?.startTimecode).toBe("01:00:00:00");
    expect(probed?.audioStreams).toHaveLength(4);
  }, 120_000);

  it("a MOV without a timecode request carries none, and the probe reports none", async () => {
    const { out } = await deliver("prores-none", { codec: "prores", format: "mov", frameRate: 25, proresProfile: "hq" });
    expect(timecodeOf(ffprobe(out))).toBeUndefined();
    expect((await probeMediaFile(out))?.startTimecode).toBeUndefined();
  }, 120_000);
});

describe("broadcast export argument validation", () => {
  const base = { width: W, height: H, frameRate: 25, bitrateKbps: 0, outputPath: "/tmp/x.mxf", totalFrames: 1, audioSampleRate: 48000, audioChannels: 8, format: "mxf" };
  const list = ["mpeg2video", "libx264", "dnxhd", "prores_ks"];
  it("rejects a malformed timecode, a channel count that does not match the mono tracks, and OP-Atom outside MXF", () => {
    expect(() => resolveExportArgs({ ...base, codec: "xdcamhd422", startTimecode: "10:00" }, "darwin", list, "/tmp/a.wav")).toThrow(/timecode/);
    expect(() => resolveExportArgs({ ...base, codec: "xdcamhd422", audioTrackCount: 4 }, "darwin", list, "/tmp/a.wav")).toThrow(/one channel per mono track/);
    expect(() => resolveExportArgs({ ...base, codec: "prores", format: "mov", mxfPattern: "opatom" }, "darwin", list, "/tmp/a.wav")).toThrow(/OP-Atom/);
  });
  it("names the missing encoder when the ffmpeg build lacks libx264 / mpeg2video", () => {
    expect(() => resolveExportArgs({ ...base, codec: "avcintra100" }, "darwin", ["mpeg2video"], "/tmp/a.wav")).toThrow(/libx264/);
    expect(() => resolveExportArgs({ ...base, codec: "xdcamhd422" }, "darwin", ["libx264"], "/tmp/a.wav")).toThrow(/mpeg2video/);
  });
});
