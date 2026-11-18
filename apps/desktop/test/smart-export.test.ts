import { vi, describe, it, expect } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import {
  TS_BASE_SECONDS,
  avcLevelString,
  buildAssembleArgs,
  buildCopyRunArgs,
  buildEncodeRunArgs,
  exactFrameRate,
  frameRateArg,
  frameTime,
  hevcLevelString,
  matchEncodeArgs,
  resolveColor,
  videoTrackTimescale,
} from "../src/main/sidecar/smart-export";

const base = {
  width: 1920,
  height: 1080,
  frameRate: 29.97,
  codec: "h264" as const,
  encoder: "libx264",
  mode: "balanced" as const,
  quality: 80,
  bitrateKbps: 8000,
  keyframeInterval: 60,
};

describe("frame grid", () => {
  it("snaps NTSC rates to exact rationals", () => {
    expect(exactFrameRate(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(exactFrameRate(23.976)).toEqual({ num: 24000, den: 1001 });
    expect(exactFrameRate(59.94)).toEqual({ num: 60000, den: 1001 });
    expect(exactFrameRate(30)).toEqual({ num: 30, den: 1 });
    expect(frameRateArg(29.97)).toBe("30000/1001");
    expect(frameRateArg(25)).toBe("25");
  });

  it("places frames exactly on the grid", () => {
    expect(frameTime(30, 30)).toBe(1);
    expect(frameTime(60, 29.97)).toBeCloseTo(2.002, 9);
  });

  it("picks an MP4 timescale that holds a whole frame duration", () => {
    expect(videoTrackTimescale(29.97)).toBe(30000);
    expect(videoTrackTimescale(24)).toBe(24000);
    expect(videoTrackTimescale(25)).toBe(25000);
  });
});

describe("matching the source stream", () => {
  it("formats levels", () => {
    expect(avcLevelString(31)).toBe("3.1");
    expect(avcLevelString(40)).toBe("4.0");
    expect(avcLevelString(5)).toBeNull();
    expect(hevcLevelString(93)).toBe("3.1");
    expect(hevcLevelString(120)).toBe("4");
  });

  it("converts with the source matrix and tags only what the source declares", () => {
    expect(resolveColor({ matrix: "bt709", transfer: "bt709", primaries: "bt709" }, 1080)).toEqual({
      scaleMatrix: "bt709",
      tags: ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"],
    });
    expect(resolveColor(undefined, 1080)).toEqual({ scaleMatrix: "bt709", tags: [] });
    expect(resolveColor(undefined, 480)).toEqual({ scaleMatrix: "bt601", tags: [] });
    expect(resolveColor({ matrix: "smpte170m" }, 1080).scaleMatrix).toBe("bt601");
  });

  it("asks x264 for the source profile and level", () => {
    const args = matchEncodeArgs("libx264", { codec: "avc", profile: 100, level: 40, frameRate: 30 }, 1080);
    expect(args).toEqual(["-profile:v", "high", "-level", "4.0"]);
  });

  it("asks x265 for the source level via x265-params", () => {
    const args = matchEncodeArgs("libx265", { codec: "hevc", profile: 1, level: 120, frameRate: 30 }, 1080);
    expect(args).toEqual(["-profile:v", "main", "-x265-params", "level-idc=4"]);
  });
});

describe("run arguments", () => {
  it("re-encoded runs read RGBA, convert with the source matrix and write transport stream to stdout at their start time", () => {
    const args = buildEncodeRunArgs({
      base,
      match: { codec: "avc", profile: 100, level: 40, color: { matrix: "bt709" }, frameRate: 29.97 },
      startFrame: 60,
    });
    expect(args.slice(args.indexOf("-r"), args.indexOf("-r") + 2)).toEqual(["-r", "30000/1001"]);
    expect(args).toContain("scale=out_color_matrix=bt709:out_range=tv");
    expect(args).toContain("+cgop");
    const offset = args[args.indexOf("-output_ts_offset") + 1];
    expect(Number(offset)).toBeCloseTo(TS_BASE_SECONDS + 2.002, 6);
    expect(args.at(-1)).toBe("pipe:1");
    expect(args[args.indexOf("-f", args.indexOf("-an")) + 1]).toBe("mpegts");
  });

  it("copy runs seek just past the key frame, copy an exact packet count and keep source timestamps shifted to the output slot", () => {
    const args = buildCopyRunArgs({ sourcePath: "/m/a.mp4", sourceStart: 2.002, outputStartFrame: 90, frames: 120, frameRate: 29.97 });
    expect(args[args.indexOf("-ss") + 1]).toBe("2.002100");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("120");
    expect(args).toContain("-copyts");
    expect(args).toContain("copy");
    // sourceStart is the file's own presentation time: -ss must not be offset by the container start_time
    expect(args[args.indexOf("-seek_timestamp") + 1]).toBe("1");
    expect(args.indexOf("-seek_timestamp")).toBeLessThan(args.indexOf("-ss"));
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    // output slot 90 / 29.97 = 3.003 s; source key frame at 2.002 s
    expect(Number(args[args.indexOf("-output_ts_offset") + 1])).toBeCloseTo(TS_BASE_SECONDS + 3.003 - 2.002, 6);
  });

  it("the final pass stream-copies video, encodes audio and fixes the timescale", () => {
    const args = buildAssembleArgs({
      videoPath: "/t/v.ts",
      audioWavPath: "/t/a.wav",
      outputPath: "/o/out.mp4",
      frameRate: 29.97,
      codec: "avc",
      audioCodec: "aac",
      audioBitrateKbps: 192,
      format: "mp4",
    });
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"]);
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe("30000");
    expect(args).toContain("192k");
    expect(args.at(-1)).toBe("/o/out.mp4");
    expect(args).not.toContain("-tag:v");
  });

  it("tags HEVC as hvc1 and maps caption tracks", () => {
    const args = buildAssembleArgs({
      videoPath: "/t/v.ts",
      audioWavPath: "/t/a.wav",
      outputPath: "/o/out.mov",
      frameRate: 24,
      codec: "hevc",
      audioCodec: "aac",
      format: "mov",
      captionInputs: [{ path: "/t/c.srt", kind: "mov_text", language: "eng" }],
    });
    expect(args.slice(args.indexOf("-tag:v"), args.indexOf("-tag:v") + 2)).toEqual(["-tag:v", "hvc1"]);
    expect(args).toContain("/t/c.srt");
    expect(args).toContain("2:0");
  });
});
