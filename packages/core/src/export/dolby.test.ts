import { describe, expect, it, vi } from "vitest";

// export-engine pulls in the decode worker module, which reads `self` at load time.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self ??= globalThis;
});
import {
  AC3_VALID_BITRATES,
  DEFAULT_DIALNORM,
  DOLBY_BITRATES,
  DOLBY_5_1_CHANNELMAP,
  clampDialnorm,
  clampDolbyBitrate,
  defaultDolbyBitrate,
  dolbyChannelsProblem,
  dolbyContainerProblem,
  dolbyDeliveryProblems,
  dolbyEncodeArgs,
  dolbyFileExtension,
  dolbySampleRate,
  isDolbyFormat,
  resolveDialnorm,
  resolveDolbyAudioSettings,
} from "./dolby";
import { exportSettingsRequireNativeEncoder, desktopExportRequiresNativeEncoder } from "./export-engine";
import { getVideoExportValidationError } from "./browser-capabilities";
import { resolveSequenceAudioSettings } from "./surround-export";
import { DEFAULT_VIDEO_SETTINGS, type AudioExportSettings, type VideoExportSettings } from "./types";

const audio = (patch: Partial<AudioExportSettings> = {}): AudioExportSettings => ({
  format: "ac3",
  sampleRate: 48000,
  bitDepth: 24,
  bitrate: 448,
  channels: 6,
  ...patch,
});

describe("Dolby Digital bitrate choices", () => {
  it("offers AC-3 from 192 to 640 kbps, every one a rate the AC-3 bitstream can signal", () => {
    expect(DOLBY_BITRATES.ac3[0]).toBe(192);
    expect(DOLBY_BITRATES.ac3.at(-1)).toBe(640);
    for (const kbps of DOLBY_BITRATES.ac3) expect(AC3_VALID_BITRATES).toContain(kbps);
  });

  it("offers E-AC-3 up to 1024 kbps", () => {
    expect(DOLBY_BITRATES.eac3.at(-1)).toBe(1024);
    expect(DOLBY_BITRATES.eac3).toContain(640);
  });

  it("snaps an unlisted bitrate up to the next offered one and clamps the ends", () => {
    expect(clampDolbyBitrate("ac3", 300)).toBe(320);
    expect(clampDolbyBitrate("ac3", 128)).toBe(192);
    expect(clampDolbyBitrate("ac3", 5000)).toBe(640);
    expect(clampDolbyBitrate("eac3", 960)).toBe(1024);
    expect(clampDolbyBitrate("eac3", Number.NaN)).toBe(192);
  });

  it("defaults to the usual delivery rates", () => {
    expect(defaultDolbyBitrate("ac3", 2)).toBe(192);
    expect(defaultDolbyBitrate("ac3", 6)).toBe(448);
    expect(defaultDolbyBitrate("eac3", 6)).toBe(640);
  });
});

describe("dialnorm", () => {
  it("clamps to -31..-1 dB", () => {
    expect(clampDialnorm(-40)).toBe(-31);
    expect(clampDialnorm(5)).toBe(-1);
    expect(clampDialnorm(-23.6)).toBe(-24);
    expect(clampDialnorm(Number.NaN)).toBe(DEFAULT_DIALNORM);
  });

  it("an explicit value wins, else the loudness target, else -31", () => {
    expect(resolveDialnorm({ dialnorm: -27, loudness: { enabled: true, targetLufs: -24 } })).toBe(-27);
    expect(resolveDialnorm({ loudness: { enabled: true, targetLufs: -24 } })).toBe(-24);
    expect(resolveDialnorm({ loudness: { enabled: false, targetLufs: -24 } })).toBe(-31);
    expect(resolveDialnorm({})).toBe(-31);
  });
});

describe("delivery rules", () => {
  it("is Dolby only for ac3 / eac3", () => {
    expect(isDolbyFormat("ac3")).toBe(true);
    expect(isDolbyFormat("eac3")).toBe(true);
    expect(isDolbyFormat("aac")).toBe(false);
    expect(isDolbyFormat(undefined)).toBe(false);
    expect(dolbyFileExtension("ac3")).toBe("ac3");
    expect(dolbyFileExtension("eac3")).toBe("ec3");
  });

  it("carries AC-3 in MP4, MOV and MKV and refuses WebM and MXF with a reason", () => {
    for (const container of ["mp4", "mov", "mkv"]) expect(dolbyContainerProblem(container)).toBeNull();
    expect(dolbyContainerProblem("webm")).toMatch(/WebM cannot carry/);
    expect(dolbyContainerProblem("mxf")).toMatch(/PCM/);
  });

  it("takes stereo and 5.1 only", () => {
    expect(dolbyChannelsProblem(2)).toBeNull();
    expect(dolbyChannelsProblem(6)).toBeNull();
    expect(dolbyChannelsProblem(1)).toMatch(/stereo or 5.1/);
    expect(dolbyChannelsProblem(8)).toMatch(/stereo or 5.1/);
    expect(dolbyDeliveryProblems({ format: "aac", channels: 1 }, "webm")).toEqual([]);
    expect(dolbyDeliveryProblems({ format: "ac3", channels: 1 }, "webm")).toHaveLength(2);
  });

  it("writes 48 kHz for a 96 kHz request and keeps 44.1 kHz", () => {
    expect(dolbySampleRate(96000)).toBe(48000);
    expect(dolbySampleRate(44100)).toBe(44100);
    expect(dolbySampleRate(48000)).toBe(48000);
  });

  it("resolves the audio settings a Dolby export uses", () => {
    const resolved = resolveDolbyAudioSettings(audio({ sampleRate: 96000, bitrate: 300, loudness: { enabled: true, targetLufs: -24, truePeakCeilingDb: -2 } }));
    expect(resolved).toMatchObject({ sampleRate: 48000, bitrate: 320, dialnorm: -24 });
    const other = audio({ format: "aac" });
    expect(resolveDolbyAudioSettings(other)).toBe(other);
  });

  it("raises a 5.1 sequence's Dolby bitrate to the 5.1 floor and leaves a stereo one", () => {
    const surround = { settings: { channels: 6, channelLayout: "5.1" } } as Parameters<typeof resolveSequenceAudioSettings>[0];
    const stereo = { settings: { channels: 2 } } as Parameters<typeof resolveSequenceAudioSettings>[0];
    expect(resolveSequenceAudioSettings(surround, audio({ channels: 2, bitrate: 192 })).bitrate).toBe(384);
    expect(resolveSequenceAudioSettings(surround, audio({ channels: 2, bitrate: 192 })).channels).toBe(6);
    const same = audio({ channels: 2, bitrate: 192 });
    expect(resolveSequenceAudioSettings(stereo, same)).toBe(same);
  });
});

describe("ffmpeg arguments", () => {
  it("5.1 relabels L R C LFE Ls Rs by index to the encoder's 5.1(side) layout, then encodes at the offered rate with dialnorm", () => {
    expect(dolbyEncodeArgs({ codec: "ac3", channels: 6, bitrateKbps: 448, sampleRate: 48000, dialnorm: -27 })).toEqual([
      "-af", DOLBY_5_1_CHANNELMAP,
      "-c:a", "ac3", "-b:a", "448k", "-ar", "48000", "-dialnorm", "-27",
    ]);
    expect(DOLBY_5_1_CHANNELMAP).toBe("channelmap=map=0|1|2|3|4|5:channel_layout=5.1(side)");
  });

  it("stereo has no channel filter; E-AC-3 uses the eac3 encoder; 96 kHz and odd bitrates are corrected", () => {
    expect(dolbyEncodeArgs({ codec: "eac3", channels: 2, bitrateKbps: 1000, sampleRate: 96000, dialnorm: -99 })).toEqual([
      "-c:a", "eac3", "-b:a", "1024k", "-ar", "48000", "-dialnorm", "-31",
    ]);
  });
});

describe("routing and validation", () => {
  const base = (patch: Partial<VideoExportSettings> = {}): VideoExportSettings => ({ ...DEFAULT_VIDEO_SETTINGS, ...patch });

  it("MKV and Dolby audio need the native encoder; plain MP4 with AAC does not", () => {
    expect(exportSettingsRequireNativeEncoder(base())).toBe(false);
    expect(exportSettingsRequireNativeEncoder(base({ format: "mkv" }))).toBe(true);
    expect(exportSettingsRequireNativeEncoder(base({ audioSettings: audio({ format: "eac3" }) }))).toBe(true);
    expect(desktopExportRequiresNativeEncoder(base({ audioSettings: audio() }))).toBe(true);
  });

  it("validation refuses Dolby audio in WebM and MXF", () => {
    expect(getVideoExportValidationError(base({ audioSettings: audio() }), 10)).toBeNull();
    expect(getVideoExportValidationError(base({ format: "webm", codec: "vp9", audioSettings: audio() }), 10)).toMatch(/WebM cannot carry/);
  });
});
