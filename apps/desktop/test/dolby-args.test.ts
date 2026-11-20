import { vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, usesPcmAudio, type ExportArgs } from "../src/main/sidecar/export-job";
import { buildAssembleArgs } from "../src/main/sidecar/smart-export";
import { buildDolbyStreamArgs, dolbyPlanFromRequest } from "../src/main/sidecar/dolby-args";
import { resolveExportArgs } from "../src/main/ipc/export";

const ENCODERS = ["libx264", "libx265", "ac3", "eac3", "aac", "prores_ks"];
const plan = (patch: Partial<Parameters<typeof dolbyPlanFromRequest>[0]> = {}) =>
  dolbyPlanFromRequest({ audioCodec: "ac3", audioChannels: 6, audioSampleRate: 48000, audioBitrateKbps: 448, ...patch })!;

const request = (patch: Record<string, unknown> = {}) => ({
  width: 1920, height: 1080, frameRate: 30, codec: "h264", format: "mp4", bitrateKbps: 15000, outputPath: "/tmp/out.mp4",
  totalFrames: 30, audioSampleRate: 48000, audioChannels: 6, audioCodec: "ac3", audioBitrateKbps: 448, ...patch,
}) as Parameters<typeof resolveExportArgs>[0];
const resolve = (patch: Record<string, unknown> = {}, encoders = ENCODERS) => resolveExportArgs(request(patch), "linux", encoders, "/tmp/mix.wav");

const exportArgs = (format: string, dolby = plan()): ExportArgs => ({
  width: 1280, height: 720, frameRate: 30, codec: "h264", encoder: "libx264", mode: "balanced", quality: 80, bitrateKbps: 5000,
  outputPath: `/tmp/out.${format}`, audioWavPath: "/tmp/mix.wav", format, dolby,
});

const audioOptions = (args: string[]): string[] => args.slice(args.indexOf("-i", args.indexOf("-i") + 1) + 2);

describe("Dolby Digital audio track of a video export", () => {
  it.each([
    ["mp4", "ac3"],
    ["mov", "ac3"],
    ["mkv", "eac3"],
  ] as const)("%s: encodes the audio with %s, relabels 5.1 by index, and drops the AAC options", (format, codec) => {
    const args = buildFfmpegArgs(exportArgs(format, plan({ audioCodec: codec, audioBitrateKbps: codec === "eac3" ? 640 : 448 })));
    const text = args.join(" ");
    expect(text).toContain("-af channelmap=map=0|1|2|3|4|5:channel_layout=5.1(side)");
    expect(text).toContain(`-c:a ${codec} -b:a ${codec === "eac3" ? 640 : 448}k -ar 48000 -dialnorm -31`);
    expect(text).not.toMatch(/-c:a (aac|libopus|pcm)/);
    expect(args.at(-1)).toBe(`/tmp/out.${format}`);
    expect(args.includes("+faststart")).toBe(format !== "mkv");
    expect(args.includes("matroska")).toBe(format === "mkv");
  });

  it("stereo has no channel filter and keeps the dialnorm", () => {
    const text = buildFfmpegArgs(exportArgs("mp4", plan({ audioChannels: 2, audioBitrateKbps: 192, dialnorm: -24 }))).join(" ");
    expect(text).not.toContain("channelmap");
    expect(text).toContain("-c:a ac3 -b:a 192k -ar 48000 -dialnorm -24");
  });

  it("does not turn the audio into PCM even beside ProRes in MOV", () => {
    expect(usesPcmAudio({ format: "mov", codec: "prores" })).toBe(true);
    expect(usesPcmAudio({ format: "mov", codec: "prores", dolby: plan() })).toBe(false);
  });

  it("the smart-render assemble pass writes the same Dolby track", () => {
    const args = buildAssembleArgs({ videoPath: "/tmp/v.ts", audioWavPath: "/tmp/mix.wav", outputPath: "/tmp/o.mp4", frameRate: 30, codec: "avc", audioCodec: "aac", audioBitrateKbps: 192, dolby: plan(), format: "mp4" });
    const text = args.join(" ");
    expect(text).toContain("-c:a ac3 -b:a 448k -ar 48000 -dialnorm -31");
    expect(text).not.toContain("-c:a aac");
  });

  it("an audio-only job takes a WAV in and writes a raw elementary stream", () => {
    expect(buildDolbyStreamArgs("/tmp/in.wav", "/tmp/out.ec3", plan({ audioCodec: "eac3", audioBitrateKbps: 1000 }))).toEqual([
      "-y", "-i", "/tmp/in.wav", "-vn",
      "-af", "channelmap=map=0|1|2|3|4|5:channel_layout=5.1(side)",
      "-c:a", "eac3", "-b:a", "1024k", "-ar", "48000", "-dialnorm", "-31",
      "-f", "eac3", "/tmp/out.ec3",
    ]);
  });
});

describe("resolving a Dolby export request", () => {
  it("accepts AC-3 and E-AC-3 in MP4, MOV and MKV, snapping the bitrate and the rate", () => {
    for (const format of ["mp4", "mov", "mkv"]) {
      const resolved = resolve({ format, audioCodec: "eac3", audioBitrateKbps: 600, audioSampleRate: 96000 });
      expect(resolved.dolby).toEqual({ codec: "eac3", channels: 6, bitrateKbps: 640, sampleRate: 48000, dialnorm: -31 });
    }
    expect(resolve({ dialnorm: -24, audioChannels: 2 }).dolby).toMatchObject({ channels: 2, dialnorm: -24 });
  });

  it("leaves non-Dolby exports untouched", () => {
    expect(resolve({ audioCodec: undefined }).dolby).toBeUndefined();
  });

  it("refuses WebM and MXF, mono, an unknown codec, mono audio tracks, a missing encoder, and MKV with ProRes", () => {
    expect(() => resolve({ format: "webm", codec: "vp9" })).toThrow(/WebM cannot carry/);
    expect(() => resolve({ format: "mxf", codec: "dnxhr", audioChannels: 2 })).toThrow(/PCM/);
    expect(() => resolve({ audioChannels: 1 })).toThrow(/stereo or 5.1/);
    expect(() => resolve({ audioCodec: "dts" })).toThrow(/Unknown audio codec/);
    expect(() => resolve({ format: "mov", audioChannels: 6, audioTrackCount: 6 })).toThrow(/mono audio tracks/);
    expect(() => resolve({}, ENCODERS.filter((e) => e !== "ac3"))).toThrow(/no ac3 encoder/);
    expect(() => resolve({ format: "mkv", codec: "prores", audioCodec: undefined })).toThrow(/not MKV/);
  });
});
