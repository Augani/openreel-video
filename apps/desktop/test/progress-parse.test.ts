import { describe, it, expect } from "vitest";
import { parseProgressBlock, buildFfmpegArgs } from "../src/main/sidecar/export-job";

describe("parseProgressBlock", () => {
  it("extracts frame number from ffmpeg -progress output", () => {
    const block = "frame=42\nfps=30\nbitrate=...\nprogress=continue\n";
    expect(parseProgressBlock(block)?.frame).toBe(42);
  });
  it("detects end", () => {
    expect(parseProgressBlock("frame=100\nprogress=end\n")?.done).toBe(true);
  });
  it("returns null when no frame field present", () => {
    expect(parseProgressBlock("fps=30\nbitrate=...\n")).toBeNull();
  });
  it("returns the LATEST frame from a multi-block buffer (progress must advance, not freeze)", () => {
    const buf = "frame=10\nprogress=continue\nframe=20\nprogress=continue\nframe=37\nprogress=continue\n";
    expect(parseProgressBlock(buf)?.frame).toBe(37);
  });
});

describe("buildFfmpegArgs", () => {
  it("declares rawvideo stdin video input AND the audio file input up front", () => {
    const args = buildFfmpegArgs({
      width: 1920, height: 1080, frameRate: 30, codec: "h264", encoder: "h264_videotoolbox",
      mode: "balanced", quality: 80,
      bitrateKbps: 8000, outputPath: "/tmp/out.mp4", audioWavPath: "/tmp/a.wav", format: "mp4",
    });
    // video input: rawvideo rgba from stdin
    expect(args).toContain("-f"); expect(args).toContain("rawvideo");
    expect(args).toContain("rgba");
    expect(args).toContain("pipe:0");
    // audio input declared too (both inputs before output)
    expect(args).toContain("/tmp/a.wav");
    expect(args).toContain("h264_videotoolbox");
    // output last
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
    // both -i inputs precede the output path
    const lastInput = args.lastIndexOf("-i");
    expect(lastInput).toBeLessThan(args.length - 1);
  });
});
