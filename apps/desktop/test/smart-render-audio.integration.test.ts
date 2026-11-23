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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveFfmpegPath } from "../src/main/sidecar/ffmpeg-path";
import { SmartExportSession, buildAssembleArgs } from "../src/main/sidecar/smart-export";
import { buildAacCopyArgs, buildPcmExtractArgs, parseAudioProbe, probeAudioSource, validateAudioPlan, type SmartAudioCopyPlan, type SmartAudioCopySegment } from "../src/main/sidecar/smart-audio";

const ffmpeg = resolveFfmpegPath();
const ffprobe = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const available = existsSync(ffmpeg) && existsSync(ffprobe);
const work = mkdtempSync(path.join(tmpdir(), "oreel-smart-audio-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const SR = 48000;
const FPS = 30;
const W = 320;
const H = 180;
const FRAMES = 240; // 8 s

function run(args: string[]): void {
  execFileSync(ffmpeg, ["-y", "-v", "error", ...args], { maxBuffer: 1 << 28 });
}

/** Decoded samples as 32-bit integers, interleaved (what the final track decodes to). */
function decode(file: string): Int32Array {
  const out = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "pcm_s32le", "-f", "s32le", "-"], { maxBuffer: 1 << 30 });
  return new Int32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length));
}

/** Decoded samples as 32-bit float (AAC decodes to float). */
function decodeFloat(file: string): Float32Array {
  const out = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  return new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length));
}

function equal(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Lag (samples) at which `b` best lines up with `a`, searched over +-range around zero on the first channel. */
function bestLag(a: Float32Array, b: Float32Array, range: number): number {
  const n = Math.min(a.length, b.length) / 2;
  const from = 4096;
  const len = Math.min(n - range - from, 20000);
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -range; lag <= range; lag++) {
    let score = 0;
    for (let i = 0; i < len; i++) score += a[(from + i) * 2] * b[(from + i + lag) * 2];
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

function probeJson(file: string): { streams: Array<Record<string, string | number>>; format: Record<string, string> } {
  return JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
}

function packets(file: string, stream: "a" | "v"): number[] {
  const out = execFileSync(ffprobe, ["-v", "error", "-select_streams", stream, "-show_entries", "packet=pts", "-of", "json", file], { encoding: "utf8", maxBuffer: 1 << 26 });
  return (JSON.parse(out).packets as Array<{ pts: number }>).map((packet) => packet.pts);
}

function packetPts(file: string, stream: "a" | "v", count = 2): number[] {
  return packets(file, stream).slice(0, count);
}

function packetCount(file: string): number {
  return packets(file, "a").length;
}

/** The 44-byte-header stereo 16-bit WAV the renderer writes. */
function writeRendererWav(file: string, samples: Int16Array): void {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

function videoSource(name: string, audioArgs: string[], audioInput: string): string {
  const file = path.join(work, name);
  run([
    "-f", "lavfi", "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=8`,
    "-f", "lavfi", "-i", audioInput,
    "-c:v", "libx264", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-bf", "0", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "3.1",
    "-colorspace", "bt709", "-color_range", "tv",
    ...audioArgs, file,
  ]);
  return file;
}

/** Steady tones with a slow sweep: no noise substitution, so every frame of the AAC decodes from itself and the one before. */
const TONES = "aevalsrc='0.3*sin(2*PI*(220+30*t)*t)|0.25*sin(2*PI*(331+20*t)*t)':d=8:s=48000";
/** Pink noise: the AAC encoder substitutes noise for bands (PNS), which makes a decoder's output depend on every frame before. */
const NOISE = "anoisesrc=d=8.0:c=pink:r=48000:a=0.3,aformat=channel_layouts=stereo";

/** A video of `frames` copied frames from the source's first key frame, so the audio tests have a picture to mux against. */
async function session(name: string, src: string, frames: number, format: "mp4" | "mov"): Promise<{ session: SmartExportSession; out: string }> {
  const out = path.join(work, `${name}.${format}`);
  const s = new SmartExportSession({
    args: { width: W, height: H, frameRate: FPS, codec: "h264", encoder: "libx264", mode: "fast", quality: 80, bitrateKbps: 2000, outputPath: out, audioWavPath: "", format, keyframeInterval: 30 },
    match: { codec: "avc", profile: 100, level: 31, frameRate: FPS },
    videoPath: path.join(work, `${name}.ts`),
    totalFrames: frames,
  });
  expect(await s.copyRun({ sourcePath: src, sourceStart: 0, outputStartFrame: 0, frames, frameRate: FPS })).toBe(frames);
  return { session: s, out };
}

const aacPlan = (src: string, sourceStart: number, samples: number, priming: number): SmartAudioCopyPlan => ({
  codec: "aac",
  sampleRate: SR,
  channels: 2,
  totalSamples: samples,
  segments: [{ kind: "copy", start: 0, end: samples, sourcePath: src, sourceStart, priming }],
});

describe("parseAudioProbe", () => {
  it("reads the codec, rate, channels and the encoder delay from the packet list", () => {
    const stderr = "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 191 kb/s (default)";
    const framecrc = ["#tb 0: 1/48000", "0, -1024, -1024, 1024, 430, 0x1", "0, 0, 0, 1024, 570, 0x2", "0, 1024, 1024, 480, 510, 0x3"].join("\n");
    expect(parseAudioProbe(stderr, framecrc)).toMatchObject({
      codec: "aac", profile: "LC", sampleRate: 48000, channels: 2, sampleFormat: "fltp", bitrateKbps: 191, firstPts: -1024, frameSamples: 1024, packets: 3, endSamples: 1504,
    });
    const pcm = "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, 2 channels, s16, 1411 kb/s";
    expect(parseAudioProbe(pcm, ["#tb 0: 1/44100", "0, 0, 0, 1024, 4096, 0x1", "0, 1024, 1024, 1024, 4096, 0x2"].join("\n"))).toMatchObject({
      codec: "pcm_s16le", sampleRate: 44100, channels: 2, sampleFormat: "s16", frameSamples: 1024, endSamples: 2048,
    });
    expect(parseAudioProbe("no audio", "")).toBeNull();
  });
});

describe("audio copy arguments", () => {
  const segment = (sourceStart: number, samples: number, priming: number): SmartAudioCopySegment => ({ kind: "copy", start: 0, end: samples, sourcePath: "/m/a.mp4", sourceStart, priming });

  it("copies a whole stream from its first packet with the source's own delay", () => {
    const { args, firstPacket, packets } = buildAacCopyArgs(segment(0, 384000, 1024), 48000, "/t/out.m4a");
    expect(firstPacket).toBe(0);
    expect(packets).toBe(376);
    expect(args).toEqual(expect.arrayContaining(["-c", "copy", "-frames:a", "376", "-movie_timescale", "48000"]));
    expect(args).not.toContain("-ss");
  });

  it("starts a mid-stream copy one packet early and gives it one frame of delay", () => {
    // decoded sample 102400 + delay 1024 is packet 101: the copy starts at packet 100
    const { args, firstPacket, packets } = buildAacCopyArgs(segment(102400, 153600, 1024), 48000, "/t/out.m4a");
    expect(firstPacket).toBe(100);
    expect(packets).toBe(151);
    expect(args[args.indexOf("-ss") + 1]).toBe(((100 * 1024 - 1024 - 512) / 48000).toFixed(6));
    expect(args[args.indexOf("-output_ts_offset") + 1]).toBe((-1536 / 48000).toFixed(6));
  });

  it("follows the source's frame grid for 2112 samples of delay", () => {
    const start = 1024 * 40 - 2112 + 1024;
    const { firstPacket } = buildAacCopyArgs(segment(start, 1024 * 90, 2112), 48000, "/t/out.m4a");
    expect(firstPacket).toBe(40);
  });

  it("cuts PCM by sample count, not by time", () => {
    const args = buildPcmExtractArgs("/m/a.wav", 96005, 288000, "/t/out.raw");
    expect(args).toContain("atrim=start_sample=96005:end_sample=384005");
    expect(args).not.toContain("-ss");
  });

  it("the final pass takes the copied audio as its input and writes it without re-encoding", () => {
    const args = buildAssembleArgs({
      videoPath: "/t/v.ts", audioWavPath: "/t/unused.wav", outputPath: "/t/o.mp4", frameRate: 30, codec: "avc", audioCodec: "aac", format: "mp4",
      audioInput: { inputArgs: ["-i", "/t/a.m4a"], codecArgs: ["-c:a", "copy"] },
    });
    expect(args).not.toContain("/t/unused.wav");
    expect(args.slice(args.indexOf("-i", args.indexOf("-i") + 1))).toEqual(expect.arrayContaining(["/t/a.m4a", "-c:a", "copy"]));
    expect(args).not.toContain("aac");
    expect(args).not.toContain("-b:a");
  });
});

describe("validateAudioPlan", () => {
  const base = (start: number, samples: number, priming = 1024): SmartAudioCopyPlan => aacPlan("/tmp/a.mp4", start, samples, priming);
  it("accepts an AAC copy from the stream start or from a frame boundary", () => {
    expect(validateAudioPlan(base(0, 1024 * 10))).toBeNull();
    expect(validateAudioPlan(base(1024 * 100, 1024 * 10))).toBeNull();
    // 2112 samples of encoder delay (Apple): frames start 64 samples into the decoded audio
    expect(validateAudioPlan(base(1024 * 3 - 2112 + 1024, 1024 * 10, 2112))).toBeNull();
  });
  it("refuses an AAC copy that starts or ends between frames, or that is not whole", () => {
    expect(validateAudioPlan(base(1000, 1024 * 10))).toMatch(/start on a frame boundary/);
    expect(validateAudioPlan(base(1024 * 100, 1024 * 10 + 5))).toMatch(/end on a frame boundary/);
    const split: SmartAudioCopyPlan = { ...base(0, 2048), segments: [{ kind: "copy", start: 0, end: 1024, sourcePath: "/tmp/a.mp4", sourceStart: 0 }, { kind: "encode", start: 1024, end: 2048 }] };
    expect(validateAudioPlan(split)).toMatch(/whole or not at all/);
  });
  it("refuses segments that do not tile the output", () => {
    const gap: SmartAudioCopyPlan = { codec: "pcm", sampleRate: SR, channels: 2, totalSamples: 100, segments: [{ kind: "encode", start: 0, end: 40 }, { kind: "encode", start: 50, end: 100 }] };
    expect(validateAudioPlan(gap)).toMatch(/tile/);
    const short: SmartAudioCopyPlan = { ...gap, segments: [{ kind: "encode", start: 0, end: 90 }] };
    expect(validateAudioPlan(short)).toMatch(/cover/);
  });
});

describe.skipIf(!available)("smart audio: AAC stream copy (real ffmpeg)", () => {
  const src = (() => (available ? videoSource("aac-src.mp4", ["-c:a", "aac", "-aac_pns", "0", "-b:a", "192k"], TONES) : ""))();

  it("probes the source with the sidecar alone", async () => {
    const probe = await probeAudioSource(src);
    expect(probe).toMatchObject({ codec: "aac", profile: "LC", sampleRate: SR, channels: 2, firstPts: -1024, frameSamples: 1024 });
    expect(probe!.endSamples).toBe(8 * SR);
  });

  it("whole export: the AAC packets are the source's; decoded audio is bit-identical and as long as a full render", async () => {
    const copy = await session("aac-whole", src, FRAMES, "mp4");
    expect(await copy.session.prepareAudio(aacPlan(src, 0, 8 * SR, 1024))).toBeNull();
    await copy.session.assemble({ audioWavPath: "", outputPath: copy.out, audioCodec: "aac", format: "mp4" });
    await copy.session.dispose();

    const sourceDecode = decodeFloat(src);
    const copyDecode = decodeFloat(copy.out);
    expect(copyDecode.length).toBe(8 * SR * 2);
    expect(equal(copyDecode, sourceDecode)).toBe(true);
    // The packets are not re-encoded: same count, same sizes, one frame of delay in the edit list.
    expect(packetCount(copy.out)).toBe(packetCount(src));
    expect(packetPts(copy.out, "a")).toEqual([-1024, 0]);

    // A full render of the same timeline: the mixdown WAV encoded to AAC in the final pass.
    const wav = path.join(work, "aac-whole-mix.wav");
    run(["-i", src, "-map", "0:a:0", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", wav]);
    const full = await session("aac-whole-full", src, FRAMES, "mp4");
    await full.session.assemble({ audioWavPath: wav, outputPath: full.out, audioCodec: "aac", format: "mp4" });
    await full.session.dispose();
    const fullDecode = decodeFloat(full.out);
    expect(fullDecode.length).toBe(copyDecode.length);
    // Same start (lag 0) and the same sync with the picture.
    expect(bestLag(fullDecode, copyDecode, 64)).toBe(0);
    const [copyA, fullA] = [probeJson(copy.out), probeJson(full.out)];
    const start = (info: ReturnType<typeof probeJson>, type: string) => Number(info.streams.find((s) => s.codec_type === type)!.start_time);
    expect(start(copyA, "audio")).toBe(start(fullA, "audio"));
    expect(start(copyA, "video")).toBe(start(fullA, "video"));
    expect(packetPts(copy.out, "a")).toEqual(packetPts(full.out, "a"));
  }, 120_000);

  it("a cut inside the stream on a frame boundary carries one frame of pre-roll and decodes like the source", async () => {
    const start = 1024 * 100;
    const samples = 1024 * 150;
    const copy = await session("aac-mid", src, Math.ceil((samples / SR) * FPS), "mp4");
    expect(await copy.session.prepareAudio(aacPlan(src, start, samples, 1024))).toBeNull();
    await copy.session.assemble({ audioWavPath: "", outputPath: copy.out, audioCodec: "aac", format: "mp4" });
    await copy.session.dispose();
    const sourceDecode = decodeFloat(src);
    const copyDecode = decodeFloat(copy.out);
    expect(copyDecode.length).toBe(samples * 2);
    expect(equal(copyDecode, sourceDecode.subarray(start * 2, (start + samples) * 2))).toBe(true);
    expect(packetPts(copy.out, "a")).toEqual([-1024, 0]);
    // 150 frames plus the pre-roll frame
    expect(packetCount(copy.out)).toBe(151);
    const info = probeJson(copy.out);
    expect(Number(info.streams.find((s) => s.codec_type === "audio")!.start_time)).toBe(0);
  }, 120_000);

  it("a source with 2112 samples of encoder delay is cut on its own frame grid", async () => {
    const delayed = path.join(work, "aac-delay.mp4");
    // Same packets, first packet at -2112: the container now trims 2112 samples at the start.
    run(["-i", src, "-map", "0:a:0", "-c", "copy", "-output_ts_offset", String(-1088 / SR), delayed]);
    const probe = await probeAudioSource(delayed);
    expect(probe!.firstPts).toBe(-2112);
    const sourceDecode = decodeFloat(delayed);
    const start = 1024 * 40 - 2112 + 1024; // decoded sample at the start of packet 41
    const samples = 1024 * 90;
    const copy = await session("aac-delay-mid", src, Math.ceil((samples / SR) * FPS), "mp4");
    expect(await copy.session.prepareAudio(aacPlan(delayed, start, samples, 2112))).toBeNull();
    await copy.session.assemble({ audioWavPath: "", outputPath: copy.out, audioCodec: "aac", format: "mp4" });
    await copy.session.dispose();
    const copyDecode = decodeFloat(copy.out);
    expect(copyDecode.length).toBe(samples * 2);
    expect(equal(copyDecode, sourceDecode.subarray(start * 2, (start + samples) * 2))).toBe(true);
  }, 120_000);

  it("a stream whose decoder carries noise-substitution state is copied from its start but declined mid-stream", async () => {
    const noisy = videoSource("aac-noise.mp4", ["-c:a", "aac", "-aac_pns", "1", "-b:a", "128k"], NOISE);
    const whole = await session("aac-noise-whole", noisy, FRAMES, "mp4");
    expect(await whole.session.prepareAudio(aacPlan(noisy, 0, 8 * SR, 1024))).toBeNull();
    await whole.session.assemble({ audioWavPath: "", outputPath: whole.out, audioCodec: "aac", format: "mp4" });
    await whole.session.dispose();
    expect(equal(decodeFloat(whole.out), decodeFloat(noisy))).toBe(true);

    const mid = await session("aac-noise-mid", noisy, 90, "mp4");
    const reason = await mid.session.prepareAudio(aacPlan(noisy, 1024 * 100, 1024 * 90, 1024));
    expect(reason).toMatch(/carries state/);
    expect(mid.session.audioCopyPlan).toBeNull();
    await mid.session.dispose();
  }, 120_000);
});

describe.skipIf(!available)("smart audio: PCM spans (real ffmpeg)", () => {
  const N = 6 * SR; // 6 s of audio, 180 frames
  const mix = (a: Int16Array, from: number, to: number, b: Int16Array): Int16Array => {
    const out = Int16Array.from(a);
    for (let i = from * 2; i < to * 2; i++) out[i] = b[i];
    return out;
  };
  const sourceS16 = (() => {
    if (!available) return "";
    return path.join(work, "pcm16.wav");
  })();

  function makeSources(): { video: string; s16: string; s24mov: string; s16Samples: Int16Array; s24Samples: Int32Array } {
    const video = videoSource("pcm-video.mp4", ["-c:a", "aac", "-b:a", "128k"], TONES);
    run(["-f", "lavfi", "-i", TONES, "-t", "8", "-c:a", "pcm_s16le", sourceS16]);
    const s24mov = path.join(work, "pcm24.mov");
    run(["-f", "lavfi", "-i", TONES.replace("0.3*", "0.21*"), "-t", "8", "-c:a", "pcm_s24le", s24mov]);
    const raw = execFileSync(ffmpeg, ["-v", "error", "-i", sourceS16, "-f", "s16le", "-"], { maxBuffer: 1 << 29 });
    const s16Samples = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    return { video, s16: sourceS16, s24mov, s16Samples, s24Samples: decode(s24mov) };
  }

  it("copies the untouched span sample for sample and joins it with the rendered mixdown (16-bit source = full render)", async () => {
    const { video, s16, s16Samples } = makeSources();
    // The mixdown carries a different signal in the spans an edit touches, the source everywhere else.
    const other = new Int16Array(s16Samples.length).map((_, i) => ((i * 7919) % 20001) - 10000);
    const a = 1 * SR + 777; // not frame aligned: PCM can be cut anywhere
    const b = 4 * SR + 31;
    const mixdown = mix(other, a, b, s16Samples).subarray(0, N * 2);
    const wav = path.join(work, "pcm-mix.wav");
    writeRendererWav(wav, mixdown);
    // The mixdown a full render would have rendered for the same edit: the source in the untouched span.
    const plan: SmartAudioCopyPlan = {
      codec: "pcm", sampleRate: SR, channels: 2, totalSamples: N,
      segments: [
        { kind: "encode", start: 0, end: a },
        { kind: "copy", start: a, end: b, sourcePath: s16, sourceStart: a },
        { kind: "encode", start: b, end: N },
      ],
    };
    const copy = await session("pcm-hybrid", video, (N / SR) * FPS, "mov");
    expect(await copy.session.prepareAudio(plan)).toBeNull();
    await copy.session.assemble({ audioWavPath: wav, outputPath: copy.out, audioCodec: "pcm_s24le", format: "mov" });
    await copy.session.dispose();
    const copied = decode(copy.out);

    // Full render: the same WAV straight through the normal final pass.
    const full = await session("pcm-hybrid-full", video, (N / SR) * FPS, "mov");
    await full.session.assemble({ audioWavPath: wav, outputPath: full.out, audioCodec: "pcm_s24le", format: "mov" });
    await full.session.dispose();
    const rendered = decode(full.out);

    expect(copied.length).toBe(N * 2);
    expect(rendered.length).toBe(N * 2);
    expect(equal(copied, rendered)).toBe(true);
    // The copied span is the source's samples (16-bit values in the top of the 24-bit word), the rest the mixdown.
    for (let i = a * 2; i < b * 2; i += 997) expect(copied[i]).toBe(s16Samples[i] << 16);
    expect(copyStart(copy.out)).toBe(copyStart(full.out));
  }, 180_000);

  it("a copy that spans the whole export needs no rendered audio at all and keeps 24-bit precision", async () => {
    const { video, s24mov, s24Samples } = makeSources();
    const plan: SmartAudioCopyPlan = {
      codec: "pcm", sampleRate: SR, channels: 2, totalSamples: N,
      segments: [{ kind: "copy", start: 0, end: N, sourcePath: s24mov, sourceStart: 2 * SR - 5 }],
    };
    const copy = await session("pcm-whole", video, (N / SR) * FPS, "mov");
    expect(await copy.session.prepareAudio(plan)).toBeNull();
    await copy.session.assemble({ audioWavPath: path.join(work, "does-not-exist.wav"), outputPath: copy.out, audioCodec: "pcm_s24le", format: "mov" });
    await copy.session.dispose();
    const copied = decode(copy.out);
    const from = (2 * SR - 5) * 2;
    expect(copied.length).toBe(N * 2);
    expect(equal(copied, s24Samples.subarray(from, from + N * 2))).toBe(true);
    expect(Array.from(copied).some((v) => (v & 0xff) !== 0)).toBe(false); // 24-bit words in a 32-bit decode
    expect(copyStart(copy.out)).toBe(0);
    // the prepared copies and the joined track are removed with the session
    expect(readdirSync(work).filter((name) => name.startsWith("pcm-whole.ts."))).toEqual([]);
  }, 180_000);

  it("a source that is shorter than the plan is declined, not padded wrongly", async () => {
    const { video, s16 } = makeSources();
    const plan: SmartAudioCopyPlan = {
      codec: "pcm", sampleRate: SR, channels: 2, totalSamples: 10 * SR,
      segments: [{ kind: "copy", start: 0, end: 10 * SR, sourcePath: s16, sourceStart: 0 }],
    };
    const copy = await session("pcm-short", video, 30, "mov");
    expect(await copy.session.prepareAudio(plan)).toMatch(/samples/);
    await copy.session.dispose();
  }, 120_000);
});

function copyStart(file: string): number {
  const info = probeJson(file);
  return Number(info.streams.find((s) => s.codec_type === "audio")!.start_time);
}

describe("fixture sanity", () => {
  it("the renderer WAV helper writes a 44-byte header", () => {
    const file = path.join(work, "hdr.wav");
    writeRendererWav(file, new Int16Array([1, 2, 3, 4]));
    expect(readFileSync(file).length).toBe(44 + 8);
  });
});
