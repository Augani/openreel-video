import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { VideoExportSettings } from "@openreel/core";
import { encodeAudioBufferToPcm16, gpuYuvInputAvailable, nativeStartFields, yuvInputEligible } from "./native-ffmpeg-backend";

function fakeBuffer(channels: number[][]): AudioBuffer {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (i: number) => Float32Array.from(channels[i]),
  } as unknown as AudioBuffer;
}

describe("encodeAudioBufferToPcm16", () => {
  it("interleaves, clamps and scales", () => {
    const out = new Int16Array(
      encodeAudioBufferToPcm16(fakeBuffer([[0, 1, -1, 2], [0.5, -0.5, -2, 0]]), 2),
    );
    expect(Array.from(out)).toEqual([0, 16384, 32767, -16384, -32768, -32768, 32767, 0]);
  });

  it("duplicates the last source channel when upmixing", () => {
    const out = new Int16Array(encodeAudioBufferToPcm16(fakeBuffer([[1]]), 2));
    expect(Array.from(out)).toEqual([32767, 32767]);
  });
});

describe("raw 4:2:0 pipe eligibility", () => {
  const settings = (over: Partial<VideoExportSettings> = {}): VideoExportSettings =>
    ({ format: "mp4", codec: "h264", width: 1920, height: 1080, frameRate: 30, bitrate: 8000, quality: 80, audioSettings: { sampleRate: 48000, channels: 2, bitrate: 192, format: "aac" }, ...over }) as unknown as VideoExportSettings;

  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "openreel-yuv-input" ? "on" : null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("takes plain one-pass H.264 and H.265", () => {
    expect(yuvInputEligible(settings())).toBe(true);
    expect(yuvInputEligible(settings({ codec: "h265" }))).toBe(true);
    expect(yuvInputEligible(settings({ format: "mkv" }))).toBe(true);
  });

  it("leaves everything that needs RGBA or ffmpeg's own conversion alone", () => {
    expect(yuvInputEligible(settings({ codec: "prores" }))).toBe(false);
    expect(yuvInputEligible(settings({ codec: "vp9" }))).toBe(false);
    expect(yuvInputEligible(settings({ codec: "av1" }))).toBe(false);
    expect(yuvInputEligible(settings({ rateControl: "vbr2" }))).toBe(false);
    expect(yuvInputEligible(settings({ width: 1919 }))).toBe(false);
    expect(yuvInputEligible(settings({ height: 1081 }))).toBe(false);
    expect(yuvInputEligible(settings({ format: "mxf" }))).toBe(false);
  });

  it.each([null, "off"])("keeps the standard conversion unless explicitly enabled (%s)", (value) => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "openreel-yuv-input" ? value : null) });
    expect(yuvInputEligible(settings())).toBe(false);
  });

  it("asks the main process for raw 4:2:0 only when the caller says so", () => {
    expect(nativeStartFields(settings(), "/tmp/out.mp4", 10)).not.toHaveProperty("rawYuv420");
    expect(nativeStartFields(settings(), "/tmp/out.mp4", 10, 0, true)).toMatchObject({ rawYuv420: true });
  });

  it("is unavailable without WebGPU (the pipe stays RGBA)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await gpuYuvInputAvailable(settings())).toBe(false);
    expect(await gpuYuvInputAvailable(settings({ codec: "prores" }))).toBe(false);
  });
});
