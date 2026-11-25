import { describe, expect, it } from "vitest";
import type { ExportArgs } from "../src/main/sidecar/export-job";
import { buildFfmpegArgs } from "../src/main/sidecar/export-job";
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
  outputPath: "/tmp/segment-0001.ts",
  audioWavPath: "/tmp/a.wav",
  format: "mp4",
  keyframeInterval: 60,
  segment: { startFrame: 300 },
  ...over,
});

describe("buildSegmentArgs", () => {
  it("is video only, MPEG-TS, closed-GOP, with timestamps pinned to the segment's start on the frame grid", () => {
    const args = buildSegmentArgs(base());
    expect(args).toContain("-an");
    expect(args.join(" ")).toContain("-f mpegts");
    expect(args).toContain("+cgop");
    // 2 s base + frame 300 at 30 fps = 12 s
    expect(args[args.indexOf("-output_ts_offset") + 1]).toBe("12.000000");
    expect(args).not.toContain("-movflags");
    expect(args.filter((arg) => arg === "-i")).toHaveLength(1);
  });

  it("encodes with exactly the serial export's picture arguments", () => {
    const serial = buildFfmpegArgs(base({ segment: undefined, outputPath: "/tmp/out.mp4" }));
    const segment = buildSegmentArgs(base());
    const picture = (args: string[]): string[] => {
      const start = args.indexOf("-vf");
      return args.slice(start, args.indexOf("-pix_fmt", start) + 2);
    };
    expect(picture(segment)).toEqual(picture(serial));
    expect(segment[segment.indexOf("-crf") + 1]).toBe(serial[serial.indexOf("-crf") + 1]);
  });

  it("uses the exact NTSC grid for the timestamp offset", () => {
    const args = buildSegmentArgs(base({ frameRate: 30000 / 1001, segment: { startFrame: 30000 } }));
    // 30000 frames at 30000/1001 fps = 1001 s, plus the 2 s base
    expect(args[args.indexOf("-output_ts_offset") + 1]).toBe("1003.000000");
  });

  it("writes ProRes as an intra-only MOV, without the TS options", () => {
    const args = buildSegmentArgs(base({ codec: "prores", encoder: "prores_ks", format: "mov", proresProfile: "hq", outputPath: "/tmp/segment-0001.mov" }));
    expect(args.join(" ")).toContain("-f mov");
    expect(args).not.toContain("-output_ts_offset");
    expect(args).not.toContain("+cgop");
  });

  it("closes the GOP of x265 segments", () => {
    const args = buildSegmentArgs(base({ codec: "hevc", encoder: "libx265" }));
    expect(args[args.indexOf("-x265-params") + 1]).toContain("open-gop=0");
  });

  it("refuses to build without a segment", () => {
    expect(() => buildSegmentArgs(base({ segment: undefined }))).toThrow(/needs a segment/);
  });
});
