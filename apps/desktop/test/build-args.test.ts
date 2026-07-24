import { describe, it, expect } from "vitest";
import { buildFfmpegArgs, type ExportArgs } from "../src/main/sidecar/export-job";

const base: ExportArgs = {
  width: 1920, height: 1080, frameRate: 30,
  codec: "hevc", encoder: "hevc_videotoolbox", mode: "balanced", quality: 80,
  bitrateKbps: 15000, outputPath: "/tmp/out.mp4", audioWavPath: "/tmp/a.wav",
  format: "mp4",
};

describe("buildFfmpegArgs", () => {
  it("pipes rawvideo rgba in and the wav, then quality-based video args", () => {
    const a = buildFfmpegArgs(base);
    expect(a.slice(0, 10)).toEqual([
      "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "1920x1080", "-r", "30", "-i",
    ]);
    expect(a).toContain("hevc_videotoolbox");
    expect(a).toContain("-b:v");
    expect(a).toContain("-tag:v");
    expect(a).not.toContain("-shortest");
    expect(a[a.length - 1]).toBe("/tmp/out.mp4");
  });

  it("software smallest uses crf, no bitrate", () => {
    const a = buildFfmpegArgs({ ...base, mode: "smallest", encoder: "libx265" });
    expect(a).toContain("-crf");
    expect(a).not.toContain("-b:v");
  });

  it("prores writes profile + 10-bit and keeps aac audio", () => {
    const a = buildFfmpegArgs({
      ...base, codec: "prores", encoder: "prores_videotoolbox",
      proresProfile: "hq", outputPath: "/tmp/out.mov", format: "mov",
    });
    expect(a).toContain("-profile:v");
    expect(a[a.indexOf("-pix_fmt", a.lastIndexOf("-i")) + 1]).toBe("yuv422p10le");
    expect(a).toContain("-c:a");
    expect(a[a.indexOf("-c:a") + 1]).toBe("aac");
  });
});
