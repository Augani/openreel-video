import { describe, it, expect } from "vitest";
import {
  qualityToCrf,
  videoEncodeArgs,
  type EncodePlan,
} from "../src/main/sidecar/encode-args";

const base = { width: 1920, height: 1080, frameRate: 30, quality: 80 };

describe("qualityToCrf", () => {
  it("is monotonic decreasing and clamped per family", () => {
    expect(qualityToCrf("x264", 50)).toBeGreaterThan(qualityToCrf("x264", 100));
    expect(qualityToCrf("svtav1", 50)).toBeGreaterThan(qualityToCrf("svtav1", 100));
    expect(qualityToCrf("x264", 0)).toBe(qualityToCrf("x264", 50)); // clamp low
    expect(qualityToCrf("x264", 200)).toBe(qualityToCrf("x264", 100)); // clamp high
  });
});

describe("videoEncodeArgs", () => {
  it("software smallest uses CRF + preset, no bitrate", () => {
    const plan: EncodePlan = { codec: "h265", encoder: "libx265", mode: "smallest", ...base };
    const args = videoEncodeArgs(plan);
    expect(args).toContain("-c:v");
    expect(args).toContain("libx265");
    expect(args).toContain("-crf");
    expect(args).toContain("-preset");
    expect(args).not.toContain("-b:v");
    expect(args).toContain("-pix_fmt");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
  });

  it("hardware balanced uses capped VBR derived from resolution/quality", () => {
    const plan: EncodePlan = { codec: "hevc", encoder: "hevc_videotoolbox", mode: "balanced", ...base };
    const args = videoEncodeArgs(plan);
    expect(args).toContain("hevc_videotoolbox");
    expect(args).toContain("-b:v");
    expect(args).toContain("-maxrate");
    expect(args).toContain("-bufsize");
    expect(args).toContain("-tag:v");
    expect(args[args.indexOf("-tag:v") + 1]).toBe("hvc1");
    expect(args).not.toContain("-crf");
  });

  it("prores uses profile, no crf/bitrate, 10-bit 422", () => {
    const plan: EncodePlan = { codec: "prores", encoder: "prores_videotoolbox", mode: "fast", proresProfile: "hq", ...base };
    const args = videoEncodeArgs(plan);
    expect(args).toContain("-profile:v");
    expect(args[args.indexOf("-profile:v") + 1]).toBe("3");
    expect(args).not.toContain("-crf");
    expect(args).not.toContain("-b:v");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv422p10le");
  });

  it("lets VideoToolbox fall back to software above 4K", () => {
    const plan = (width: number, height: number): EncodePlan =>
      ({ ...base, width, height, codec: "h264", encoder: "h264_videotoolbox", mode: "balanced" });
    expect(videoEncodeArgs(plan(3840, 2160))).toContain("-allow_sw");
    expect(videoEncodeArgs(plan(7680, 4320))).not.toContain("-allow_sw");
  });
});
