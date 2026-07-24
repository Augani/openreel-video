import { describe, it, expect } from "vitest";
import {
  buildProxyArgs,
  buildTranscodeArgs,
  buildExtractAudioArgs,
  PROXY_SCALE,
} from "../src/main/sidecar/media-job";

describe("media-job arg builders", () => {
  it("proxy: scales to the preset height, h264, faststart, progress pipe", () => {
    const a = buildProxyArgs("/in.mp4", "/out.mp4", "medium");
    expect(a).toContain("/in.mp4");
    expect(a[a.length - 1]).toBe("/out.mp4");
    expect(a.join(" ")).toMatch(/scale=-2:720/); // medium = 720p
    expect(a).toContain("libx264");
    expect(a.join(" ")).toContain("faststart");
    expect(a).toContain("-progress");
    // input must precede output
    expect(a.indexOf("-i")).toBeLessThan(a.length - 1);
  });

  it("transcode: container/codec/bitrates honored, input before output", () => {
    const a = buildTranscodeArgs("/in.mov", "/out.mp4", {
      container: "mp4",
      videoBitrateKbps: 5000,
      audioBitrateKbps: 192,
    });
    expect(a.indexOf("-i")).toBeLessThan(a.length - 1);
    expect(a).toContain("5000k");
    expect(a).toContain("192k");
    expect(a).toContain("libx264");
    expect(a[a.length - 1]).toBe("/out.mp4");
  });

  it("transcode webm: vp9/opus", () => {
    const a = buildTranscodeArgs("/in.mp4", "/out.webm", {
      container: "webm",
      videoBitrateKbps: 2000,
      audioBitrateKbps: 128,
    });
    expect(a).toContain("libvpx-vp9");
    expect(a).toContain("libopus");
    expect(a[a.length - 1]).toBe("/out.webm");
  });

  it("extract-audio: pcm_f32le wav, optional stream map, no video", () => {
    const a = buildExtractAudioArgs("/in.mp4", "/out.wav", 1);
    expect(a.join(" ")).toContain("-map 0:a:1");
    expect(a).toContain("pcm_f32le");
    expect(a).toContain("-vn");
    expect(a[a.length - 1]).toBe("/out.wav");
  });

  it("extract-audio: defaults to first audio stream when index omitted", () => {
    const a = buildExtractAudioArgs("/in.mp4", "/out.wav");
    expect(a.join(" ")).toContain("-map 0:a:0");
  });

  it("exposes PROXY_SCALE heights matching the web presets", () => {
    expect(PROXY_SCALE).toEqual({ low: 540, medium: 720, high: 1080 });
  });
});
