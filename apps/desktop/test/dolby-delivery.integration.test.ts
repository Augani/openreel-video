/**
 * Real-ffmpeg coverage of Dolby Digital / Digital Plus delivery, no Electron. Files are written by the same
 * `resolveExportArgs` + `ExportJob` (video) and `encodeDolbyAudio` (audio-only) the desktop app runs, then read back:
 *
 *  - ffprobe: codec_name ac3 / eac3, channels, channel_layout, bit_rate, duration, the `ac-3` / `ec-3` sample entries in
 *    MP4 and MOV, the A_AC3 / A_EAC3 codec ids in MKV;
 *  - the dialnorm parsed out of the AC-3 bitstream information;
 *  - the file decoded back: every channel of a 5.1 mix (a different tone per channel, L R C LFE Ls Rs) arrives on its own
 *    channel at its own level (within 0.5 dB) with no energy from the other tones.
 *
 * Runs against the bundled sidecar (apps/desktop/resources/bin) when it is there, else an installed ffmpeg;
 * ffprobe comes from PATH (Homebrew paths) or next to the ffmpeg. Skipped when either is missing or the ffmpeg has no
 * ac3 / eac3 encoder.
 */
import { vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

const bundled = path.resolve(__dirname, "../resources/bin", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffmpegCandidates = [process.env.OPENREEL_FFMPEG_PATH, bundled, "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].filter((p): p is string => Boolean(p));
const ffmpegBin = ffmpegCandidates.find((p) => existsSync(p));
const ffprobeCandidates = [process.env.OPENREEL_FFPROBE, ffmpegBin && path.join(path.dirname(ffmpegBin), "ffprobe"), "/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"].filter((p): p is string => Boolean(p));
const ffprobeBin = ffprobeCandidates.find((p) => existsSync(p));
if (ffmpegBin) process.env.OPENREEL_FFMPEG_PATH = ffmpegBin;

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { ExportJob } from "../src/main/sidecar/export-job";
import { resolveExportArgs } from "../src/main/ipc/export";
import { encodeDolbyAudio } from "../src/main/ipc/dolby-audio";
import { parseEncoders } from "../src/main/sidecar/encoder-probe";

const encoders = ffmpegBin ? parseEncoders(execFileSync(ffmpegBin, ["-hide_banner", "-encoders"]).toString()) : [];
const enabled = Boolean(ffmpegBin && ffprobeBin && encoders.includes("ac3") && encoders.includes("eac3") && encoders.includes("libx264"));
const suite = enabled ? describe : describe.skip;

const SR = 48000;
const SECONDS = 2;
/** One tone per channel in the L R C LFE Ls Rs order of the 5.1 mixer, and a distinct level for each. */
const TONES = [300, 500, 700, 60, 1100, 1300];
const LEVELS = [0.5, 0.4, 0.3, 0.5, 0.2, 0.1];
const NAMES = ["L", "R", "C", "LFE", "Ls", "Rs"];
const W = 320;
const H = 180;
const FRAMES = 30;

let work = "";

/** 16-bit PCM WAV, one tone per channel. `mask` set = WAVE_FORMAT_EXTENSIBLE (the audio-only path); unset = the plain header the video path writes. */
function toneWav(file: string, channels: number, mask?: number): ArrayBuffer {
  const extensible = mask !== undefined;
  const fmtSize = extensible ? 40 : 16;
  const frames = SR * SECONDS;
  const dataSize = frames * channels * 2;
  const buf = Buffer.alloc(12 + 8 + fmtSize + 8 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(fmtSize, 16);
  buf.writeUInt16LE(extensible ? 0xfffe : 1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  if (extensible) {
    buf.writeUInt16LE(22, 36);
    buf.writeUInt16LE(16, 38);
    buf.writeUInt32LE(mask, 40);
    Buffer.from([0x01, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]).copy(buf, 44);
  }
  const at = 20 + fmtSize;
  buf.write("data", at);
  buf.writeUInt32LE(dataSize, at + 4);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) buf.writeInt16LE(Math.round(LEVELS[c] * Math.sin((2 * Math.PI * TONES[c] * i) / SR) * 32767), at + 8 + (i * channels + c) * 2);
  }
  writeFileSync(file, buf);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

interface Probed {
  streams: Array<Record<string, string | number>>;
  format: { format_name: string; duration: string };
}
function ffprobe(file: string): Probed {
  return JSON.parse(execFileSync(ffprobeBin!, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 1 << 24 }).toString()) as Probed;
}
const audioStream = (p: Probed) => p.streams.find((s) => s.codec_type === "audio")!;

/** Decoded 6-channel float PCM of the first audio stream. */
function decode(file: string, channels: number): Float32Array[] {
  const r = spawnSync(ffmpegBin!, ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "f32le", "-acodec", "pcm_f32le", "-ac", String(channels), "-"], { maxBuffer: 1 << 29 });
  const all = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength));
  return Array.from({ length: channels }, (_, c) => all.filter((_v, i) => i % channels === c));
}

/** Amplitude of `freq` in the steady middle of a channel (single-bin DFT). */
function toneAmp(x: Float32Array, freq: number): number {
  const from = Math.floor(SR * 0.5);
  const to = Math.floor(SR * 1.5);
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i += 2) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im += x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / ((to - from) / 2);
}

/** Every channel carries its own tone at its own level (dB error under 0.5) and no other channel's tone. */
function expectDiscreteChannels(file: string): void {
  const pcm = decode(file, 6);
  pcm.forEach((channel, c) => {
    const own = toneAmp(channel, TONES[c]);
    const dbError = 20 * Math.log10(own / LEVELS[c]);
    expect(Math.abs(dbError), `${NAMES[c]} level error ${dbError.toFixed(2)} dB`).toBeLessThan(0.5);
    TONES.forEach((tone, other) => {
      if (other !== c) expect(toneAmp(channel, tone), `${NAMES[other]} tone on ${NAMES[c]}`).toBeLessThan(0.01);
    });
  });
}

/** Dialnorm of the first AC-3 syncframe in a raw stream (bsid <= 8: ATSC A/52 bit stream information; E-AC-3 has the same field at a different offset). */
function ac3Dialnorm(file: string): number | null {
  const bytes = readFileSync(file);
  if (bytes[0] !== 0x0b || bytes[1] !== 0x77) return null;
  let bit = 16 + 16 + 2 + 6; // syncword, crc1, fscod, frmsizecod
  const read = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    return v;
  };
  const bsid = read(5);
  if (bsid > 8) return null;
  read(3); // bsmod
  const acmod = read(3);
  if (acmod & 1 && acmod !== 1) read(2); // cmixlev
  if (acmod & 4) read(2); // surmixlev
  if (acmod === 2) read(2); // dsurmod
  read(1); // lfeon
  const dialnorm = read(5);
  return dialnorm === 0 ? -31 : -dialnorm;
}

interface Delivery {
  format: "mp4" | "mov" | "mkv";
  codec: "ac3" | "eac3";
  channels: 2 | 6;
  bitrate: number;
  dialnorm?: number;
}

/** The real video export: gradient RGBA frames plus the six-channel WAV the native backend writes. */
async function deliver(name: string, d: Delivery): Promise<string> {
  const wav = path.join(work, `${name}.wav`);
  toneWav(wav, d.channels);
  const out = path.join(work, `${name}.${d.format}`);
  const args = resolveExportArgs(
    {
      width: W, height: H, frameRate: FRAMES / SECONDS, codec: "h264", format: d.format, bitrateKbps: 2000, outputPath: out, totalFrames: FRAMES,
      audioSampleRate: SR, audioChannels: d.channels, encodeMode: "smallest", quality: 80, audioCodec: d.codec, audioBitrateKbps: d.bitrate,
      ...(d.dialnorm !== undefined ? { dialnorm: d.dialnorm } : {}),
    },
    "linux",
    encoders.filter((e) => !e.endsWith("_videotoolbox")),
    wav,
  );
  const frame = new Uint8Array(W * H * 4).fill(96);
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

beforeAll(() => {
  if (enabled) work = mkdtempSync(path.join(os.tmpdir(), "openreel-dolby-"));
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

suite("Dolby Digital audio in video files, verified with ffprobe and by decoding", () => {
  it.each([
    ["mp4", "ac3", 448, "ac-3"],
    ["mov", "ac3", 640, "ac-3"],
    ["mp4", "eac3", 640, "ec-3"],
    ["mov", "eac3", 1024, "ec-3"],
  ] as const)("5.1 %s with %s at %i kbps: codec, six channels, 5.1(side), bit rate, sample entry %s, duration, every channel on its own slot", async (format, codec, bitrate, entry) => {
    const out = await deliver(`v51-${format}-${codec}-${bitrate}`, { format, codec, channels: 6, bitrate });
    const p = ffprobe(out);
    expect(audioStream(p)).toMatchObject({ codec_name: codec, codec_tag_string: entry, channels: 6, channel_layout: "5.1(side)", sample_rate: "48000" });
    expect(Number(audioStream(p).bit_rate)).toBe(bitrate * 1000);
    expect(Math.abs(Number(p.format.duration) - SECONDS)).toBeLessThan(0.1);
    expect(p.streams.some((s) => s.codec_name === "h264")).toBe(true);
    expectDiscreteChannels(out);
  }, 120_000);

  it("5.1 MKV with AC-3 and with E-AC-3: Matroska codec ids, six channels, levels per channel", async () => {
    for (const codec of ["ac3", "eac3"] as const) {
      const out = await deliver(`v51-mkv-${codec}`, { format: "mkv", codec, channels: 6, bitrate: codec === "ac3" ? 448 : 640 });
      const p = ffprobe(out);
      expect(String(p.format.format_name)).toContain("matroska");
      expect(audioStream(p)).toMatchObject({ codec_name: codec, channels: 6, channel_layout: "5.1(side)" });
      expect(Number(audioStream(p).bit_rate)).toBe(codec === "ac3" ? 448_000 : 640_000);
      expect(readFileSync(out).includes(Buffer.from(codec === "ac3" ? "A_AC3" : "A_EAC3"))).toBe(true);
      expectDiscreteChannels(out);
    }
  }, 120_000);

  it("stereo AC-3 and E-AC-3: two channels, stereo layout, the requested bit rate", async () => {
    for (const [codec, bitrate] of [["ac3", 192], ["eac3", 256]] as const) {
      const out = await deliver(`v2-${codec}`, { format: "mp4", codec, channels: 2, bitrate });
      const s = audioStream(ffprobe(out));
      expect(s).toMatchObject({ codec_name: codec, channels: 2, channel_layout: "stereo" });
      expect(Number(s.bit_rate)).toBe(bitrate * 1000);
      const pcm = decode(out, 2);
      expect(Math.abs(20 * Math.log10(toneAmp(pcm[0], TONES[0]) / LEVELS[0]))).toBeLessThan(0.5);
      expect(Math.abs(20 * Math.log10(toneAmp(pcm[1], TONES[1]) / LEVELS[1]))).toBeLessThan(0.5);
    }
  }, 120_000);
});

suite("raw .ac3 / .ec3 audio-only export through encodeDolbyAudio", () => {
  const plan = (codec: "ac3" | "eac3", channels: 2 | 6, bitrateKbps: number, dialnorm: number) => ({ codec, channels, bitrateKbps, sampleRate: 48000, dialnorm });

  it.each([
    ["ac3", 6, 448, -27],
    ["ac3", 6, 640, -24],
    ["ac3", 2, 192, -31],
    ["eac3", 6, 1024, -24],
    ["eac3", 2, 256, -1],
  ] as const)("%s, %i channels, %i kbps, dialnorm %i: ffprobe, duration, channel levels", async (codec, channels, bitrate, dialnorm) => {
    const wavFile = path.join(work, `a-${codec}-${channels}.wav`);
    const wav = toneWav(wavFile, channels, channels === 6 ? 0x3f : 0x3);
    const bytes = new Uint8Array(await encodeDolbyAudio({ ...plan(codec, channels, bitrate, dialnorm), wav }));
    const out = path.join(work, `a-${codec}-${channels}-${bitrate}.${codec === "eac3" ? "ec3" : "ac3"}`);
    writeFileSync(out, bytes);
    const p = ffprobe(out);
    expect(audioStream(p)).toMatchObject({ codec_name: codec, channels, channel_layout: channels === 6 ? "5.1(side)" : "stereo", sample_rate: "48000" });
    expect(Number(audioStream(p).bit_rate)).toBe(bitrate * 1000);
    expect(Math.abs(Number(p.format.duration) - SECONDS)).toBeLessThan(0.1);
    if (codec === "ac3") expect(ac3Dialnorm(out)).toBe(dialnorm);
    if (channels === 6) expectDiscreteChannels(out);
  }, 120_000);

  it("a 44.1 kHz request is written at 44.1 kHz", async () => {
    const wavFile = path.join(work, "a-441.wav");
    const wav = toneWav(wavFile, 2, 0x3);
    const bytes = new Uint8Array(await encodeDolbyAudio({ ...plan("ac3", 2, 192, -31), sampleRate: 44100, wav }));
    const out = path.join(work, "a-441.ac3");
    writeFileSync(out, bytes);
    expect(audioStream(ffprobe(out))).toMatchObject({ codec_name: "ac3", sample_rate: "44100" });
  }, 60_000);
});
