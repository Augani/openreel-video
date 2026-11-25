import { describe, expect, it } from "vitest";
import { assertRawYuv420Allowed, buildFfmpegArgs, pipeFrameBytes, pipePixelFormat, type ExportArgs } from "../src/main/sidecar/export-job";
import { buildSegmentArgs } from "../src/main/sidecar/segment-args";

const base = (over: Partial<ExportArgs> = {}): ExportArgs => ({
  width: 1920,
  height: 1080,
  frameRate: 30,
  codec: "h264",
  encoder: "libx264",
  mode: "balanced",
  quality: 80,
  bitrateKbps: 0,
  totalFrames: 300,
  outputPath: "/tmp/out.mp4",
  audioWavPath: "/tmp/a.wav",
  format: "mp4",
  keyframeInterval: 60,
  ...over,
});

const pipeFormat = (args: string[]): string => args[args.indexOf("-pix_fmt") + 1];

describe("raw 4:2:0 input pipe", () => {
  it("keeps RGBA and ffmpeg's BT.709 conversion unless the renderer asked for I420", () => {
    const args = buildFfmpegArgs(base());
    expect(pipeFormat(args)).toBe("rgba");
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=out_color_matrix=bt709:out_range=tv");
    expect(pipePixelFormat(base())).toBe("rgba");
    expect(pipeFrameBytes(base())).toBe(1920 * 1080 * 4);
  });

  it("reads yuv420p from the pipe and only tags it: no scale filter, the same BT.709 tags", () => {
    const args = buildFfmpegArgs(base({ rawYuv420: true }));
    expect(pipeFormat(args)).toBe("yuv420p");
    const vf = args[args.indexOf("-vf") + 1];
    expect(vf).toBe("setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv");
    expect(args.join(" ")).not.toContain("scale=");
    expect(args[args.indexOf("-colorspace") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    expect(pipeFrameBytes(base({ rawYuv420: true }))).toBe(1920 * 1080 * 1.5);
    // The encoder side is untouched.
    const encode = (a: string[]): string[] => a.slice(a.indexOf("-c:v"), a.indexOf("-pix_fmt", a.indexOf("-c:v")) + 2);
    expect(encode(args)).toEqual(encode(buildFfmpegArgs(base())));
  });

  it("does the same for a parallel segment", () => {
    const args = buildSegmentArgs(base({ rawYuv420: true, segment: { startFrame: 300 } }));
    expect(pipeFormat(args)).toBe("yuv420p");
    expect(args[args.indexOf("-vf") + 1]).toContain("setparams=");
    expect(args.join(" ")).not.toContain("scale=");
    expect(pipeFormat(buildSegmentArgs(base({ segment: { startFrame: 0 } })))).toBe("rgba");
  });

  it("accepts plain H.264 / HEVC and refuses everything that would read the pipe as RGBA", () => {
    const ok = { codec: "h264" as const, width: 1920, height: 1080, format: "mp4" };
    expect(() => assertRawYuv420Allowed(ok)).not.toThrow();
    expect(() => assertRawYuv420Allowed({ ...ok, codec: "hevc" })).not.toThrow();
    expect(() => assertRawYuv420Allowed({ ...ok, codec: "prores" })).toThrow(/H.264/);
    expect(() => assertRawYuv420Allowed({ ...ok, alpha: true })).toThrow(/alpha/);
    expect(() => assertRawYuv420Allowed({ ...ok, color: { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" } })).toThrow(/colour/);
    expect(() => assertRawYuv420Allowed({ ...ok, rateControl: "vbr2" })).toThrow(/two-pass/);
    expect(() => assertRawYuv420Allowed({ ...ok, format: "mxf" })).toThrow(/broadcast/);
    expect(() => assertRawYuv420Allowed({ ...ok, width: 1919 })).toThrow(/even/);
  });
});
