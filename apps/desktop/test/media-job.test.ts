import { describe, it, expect } from "vitest";
import {
  buildProxyArgs,
  proxyUsesHwDecode,
  buildTranscodeArgs,
  buildExtractAudioArgs,
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

  it("extract-audio: pcm_f32le wav, optional stream map, no video", () => {
    const a = buildExtractAudioArgs("/in.mp4", "/out.wav", 1);
    expect(a.join(" ")).toContain("-map 0:a:1");
    expect(a).toContain("pcm_f32le");
    expect(a).toContain("-vn");
    expect(a[a.length - 1]).toBe("/out.wav");
  });

});

import { sweepStaleTemp, newTempPathReady, releaseTemp, appTempDir } from "../src/main/temp-dir";
import { promises as fsp, existsSync } from "node:fs";

describe("hardware encoder media args", () => {
  it("proxy with a hardware encoder uses bitrate, not crf", () => {
    const a = buildProxyArgs("/in.mp4", "/out.mp4", "medium", "h264_videotoolbox");
    expect(a).toContain("h264_videotoolbox");
    expect(a).toContain("3000k");
    expect(a).not.toContain("-crf");
    expect(a).toContain("yuv420p");
  });

  it("proxy: macOS decodes in software (hwaccel readback was 2x slower); other platforms keep hwaccel", () => {
    expect(proxyUsesHwDecode("darwin")).toBe(false);
    expect(proxyUsesHwDecode("win32")).toBe(true);
    expect(proxyUsesHwDecode("linux")).toBe(true);
    expect(buildProxyArgs("/in.mp4", "/out.mp4", "medium", "libx264", false)).not.toContain("-hwaccel");
    const hw = buildProxyArgs("/in.mp4", "/out.mp4", "medium", "libx264", true);
    expect(hw.slice(hw.indexOf("-hwaccel"), hw.indexOf("-hwaccel") + 2)).toEqual(["-hwaccel", "auto"]);
  });

});

describe("temp-dir", () => {
  it("tracks, releases and sweeps stale files", async () => {
    const p = await newTempPathReady("t", "bin");
    expect(p.startsWith(appTempDir())).toBe(true);
    await fsp.writeFile(p, "x");
    expect(await sweepStaleTemp(24 * 3600e3)).toBe(0);
    expect(existsSync(p)).toBe(true);
    expect(await releaseTemp(p)).toBe(true);
    expect(existsSync(p)).toBe(false);
    expect(await releaseTemp("/etc/hosts")).toBe(false);
    const q = await newTempPathReady("t", "bin");
    await fsp.writeFile(q, "x");
    expect(await sweepStaleTemp(1000, Date.now() + 5000)).toBeGreaterThanOrEqual(1);
    expect(existsSync(q)).toBe(false);
  });
});
