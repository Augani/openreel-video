import { describe, it, expect } from "vitest";
import { buildFfmpegArgs, threadQueueSize, type ExportArgs } from "../src/main/sidecar/export-job";

const base: ExportArgs = {
  width: 1920, height: 1080, frameRate: 30,
  codec: "hevc", encoder: "hevc_videotoolbox", mode: "balanced", quality: 80,
  bitrateKbps: 15000, outputPath: "/tmp/out.mp4", audioWavPath: "/tmp/a.wav",
  format: "mp4",
};

describe("buildFfmpegArgs", () => {
  it("pipes rawvideo rgba in and the wav, then quality-based video args", () => {
    const a = buildFfmpegArgs(base);
    expect(a.slice(0, 12)).toEqual([
      "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "1920x1080", "-r", "30",
      "-thread_queue_size", "64", "-i",
    ]);
    expect(a).toContain("hevc_videotoolbox");
    expect(a).toContain("-b:v");
    expect(a).toContain("-tag:v");
    expect(a).not.toContain("-shortest");
    expect(a[a.length - 1]).toBe("/tmp/out.mp4");
  });

  it("converts RGB with BT.709 limited range and tags the output (ffmpeg's default would be BT.601, untagged)", () => {
    const a = buildFfmpegArgs(base);
    expect(a[a.indexOf("-vf") + 1]).toBe("scale=out_color_matrix=bt709:out_range=tv");
    expect(a.slice(a.indexOf("-colorspace"), a.indexOf("-colorspace") + 8)).toEqual([
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    ]);
  });

  it("software smallest uses crf, no bitrate", () => {
    const a = buildFfmpegArgs({ ...base, mode: "smallest", encoder: "libx265" });
    expect(a).toContain("-crf");
    expect(a).not.toContain("-b:v");
  });

  it("prores writes profile + 10-bit with PCM audio", () => {
    const a = buildFfmpegArgs({
      ...base, codec: "prores", encoder: "prores_videotoolbox",
      proresProfile: "hq", outputPath: "/tmp/out.mov", format: "mov",
    });
    expect(a).toContain("-profile:v");
    expect(a[a.indexOf("-pix_fmt", a.lastIndexOf("-i")) + 1]).toBe("yuv422p10le");
    expect(a).toContain("-c:a");
    expect(a[a.indexOf("-c:a") + 1]).toBe("pcm_s24le");
  });

  it("prores 4444 with alpha writes yuva444p10le from prores_ks, without alpha yuv444p10le", () => {
    const a = buildFfmpegArgs({
      ...base, codec: "prores", encoder: "prores_ks", proresProfile: "4444", alpha: true,
      outputPath: "/tmp/out.mov", format: "mov",
    });
    expect(a[a.indexOf("-profile:v") + 1]).toBe("4");
    expect(a[a.indexOf("-vendor") + 1]).toBe("apl0");
    expect(a[a.indexOf("-pix_fmt", a.lastIndexOf("-i")) + 1]).toBe("yuva444p10le");
    const opaque = buildFfmpegArgs({ ...base, codec: "prores", encoder: "prores_ks", proresProfile: "4444xq", outputPath: "/tmp/out.mov", format: "mov" });
    expect(opaque[opaque.indexOf("-profile:v") + 1]).toBe("5");
    expect(opaque[opaque.indexOf("-pix_fmt", opaque.lastIndexOf("-i")) + 1]).toBe("yuv444p10le");
  });

  it("dnxhr maps each flavour to its profile and pixel format, drops GOP and audio bitrate, PCM in MXF", () => {
    const expected: Array<["lb" | "sq" | "hq" | "hqx" | "444", string, string]> = [
      ["lb", "dnxhr_lb", "yuv422p"], ["sq", "dnxhr_sq", "yuv422p"], ["hq", "dnxhr_hq", "yuv422p"],
      ["hqx", "dnxhr_hqx", "yuv422p10le"], ["444", "dnxhr_444", "yuv444p10le"],
    ];
    for (const [dnxhrProfile, profile, pix] of expected) {
      const a = buildFfmpegArgs({
        ...base, codec: "dnxhr", encoder: "dnxhd", dnxhrProfile, keyframeInterval: 1, audioBitrateKbps: 320,
        outputPath: "/tmp/out.mxf", format: "mxf",
      });
      expect(a[a.indexOf("-c:v") + 1]).toBe("dnxhd");
      expect(a[a.indexOf("-profile:v") + 1]).toBe(profile);
      expect(a[a.indexOf("-pix_fmt", a.lastIndexOf("-i")) + 1]).toBe(pix);
      expect(a).not.toContain("-g");
      expect(a).not.toContain("-b:a");
      expect(a).not.toContain("-movflags");
      expect(a[a.indexOf("-c:a") + 1]).toBe("pcm_s24le");
      expect(a[a.indexOf("-f", a.lastIndexOf("-i")) + 1]).toBe("mxf");
    }
  });

  it("an mxf wrapper of any codec forces PCM audio", () => {
    const a = buildFfmpegArgs({ ...base, format: "mxf", outputPath: "/tmp/out.mxf" });
    expect(a[a.indexOf("-c:a") + 1]).toBe("pcm_s24le");
  });

  it("webm uses libvpx-vp9 constant quality with opus audio", () => {
    const a = buildFfmpegArgs({
      ...base, codec: "vp9", encoder: "libvpx-vp9",
      outputPath: "/tmp/out.webm", format: "webm",
    });
    expect(a[a.indexOf("-c:v") + 1]).toBe("libvpx-vp9");
    expect(a[a.indexOf("-b:v") + 1]).toBe("0");
    expect(a).not.toContain("-preset");
    expect(a[a.indexOf("-c:a") + 1]).toBe("libopus");
  });
});

describe("buildFfmpegArgs tuning flags", () => {
  it("adds faststart for mp4/mov only", () => {
    const a = buildFfmpegArgs(base);
    expect(a[a.indexOf("-movflags") + 1]).toBe("+faststart");
    const w = buildFfmpegArgs({
      ...base, codec: "vp9", encoder: "libvpx-vp9", outputPath: "/tmp/o.webm", format: "webm",
    });
    expect(w).not.toContain("-movflags");
  });

  it("applies the user's audio bitrate only when set", () => {
    expect(buildFfmpegArgs({ ...base, audioBitrateKbps: 256 })).toContain("256k");
    expect(buildFfmpegArgs(base)).not.toContain("-b:a");
  });

  it("threads software encoders, forbids VideoToolbox software fallback, honors -g", () => {
    const sw = buildFfmpegArgs({ ...base, encoder: "libx265", keyframeInterval: 60 });
    expect(sw[sw.indexOf("-threads") + 1]).toBe("0");
    expect(sw[sw.indexOf("-g") + 1]).toBe("60");
    const hw = buildFfmpegArgs(base);
    expect(hw).toContain("-allow_sw");
    expect(hw).not.toContain("-threads");
    expect(hw).not.toContain("-g");
  });
});

describe("threadQueueSize", () => {
  it("keeps 64 for small frames and shrinks with frame size, feeding the ffmpeg args", () => {
    expect(threadQueueSize(1920, 1080)).toBe(64);
    expect(threadQueueSize(3840, 2160)).toBe(16);
    expect(threadQueueSize(7680, 4320)).toBe(4);
    const a = buildFfmpegArgs({ ...base, width: 3840, height: 2160 });
    expect(a[a.indexOf("-thread_queue_size") + 1]).toBe("16");
  });
});
