import { describe, it, expect } from "vitest";
import {
  qualityToCrf,
  hardwareTargetKbps,
  containerForCodec,
  pixelFormatForCodec,
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

describe("containerForCodec", () => {
  it("forces mov for prores, mp4 otherwise", () => {
    expect(containerForCodec("prores")).toBe("mov");
    expect(containerForCodec("h264")).toBe("mp4");
    expect(containerForCodec("hevc")).toBe("mp4");
  });
});

describe("pixelFormatForCodec", () => {
  it("uses 10-bit 422 for prores, 420 otherwise", () => {
    expect(pixelFormatForCodec("prores")).toBe("yuv422p10le");
    expect(pixelFormatForCodec("h264")).toBe("yuv420p");
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

  it("software balanced uses a faster preset than smallest", () => {
    const plan: EncodePlan = { codec: "h264", encoder: "libx264", mode: "balanced", ...base };
    const args = videoEncodeArgs(plan);
    expect(args[args.indexOf("-preset") + 1]).toBe("fast");
  });

  it("software fast uses an export-speed preset", () => {
    const plan: EncodePlan = { codec: "h264", encoder: "libx264", mode: "fast", ...base };
    const args = videoEncodeArgs(plan);
    expect(args[args.indexOf("-preset") + 1]).toBe("veryfast");
  });

  it("svt-av1 presets track export mode", () => {
    const fast = videoEncodeArgs({ codec: "av1", encoder: "libsvtav1", mode: "fast", ...base });
    const balanced = videoEncodeArgs({ codec: "av1", encoder: "libsvtav1", mode: "balanced", ...base });
    const smallest = videoEncodeArgs({ codec: "av1", encoder: "libsvtav1", mode: "smallest", ...base });

    expect(fast[fast.indexOf("-preset") + 1]).toBe("8");
    expect(balanced[balanced.indexOf("-preset") + 1]).toBe("6");
    expect(smallest[smallest.indexOf("-preset") + 1]).toBe("5");
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

  it("hevc target is smaller than h264 target at the same settings", () => {
    const h264 = hardwareTargetKbps({ codec: "h264", mode: "balanced", ...base });
    const hevc = hardwareTargetKbps({ codec: "hevc", mode: "balanced", ...base });
    expect(hevc).toBeLessThan(h264);
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
});
