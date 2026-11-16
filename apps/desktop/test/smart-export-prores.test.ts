import { vi, describe, it, expect } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildAssembleArgs, buildCopyRunArgs, buildEncodeRunArgs, concatListFor } from "../src/main/sidecar/smart-export";

const base = {
  width: 1920,
  height: 1080,
  frameRate: 29.97,
  codec: "prores" as const,
  encoder: "prores_ks",
  mode: "balanced" as const,
  quality: 80,
  bitrateKbps: 8000,
};
const match = { codec: "prores" as const, proresProfile: "hq" as const, color: { matrix: "bt709" }, frameRate: 29.97 };

describe("ProRes runs (MPEG-TS cannot carry ProRes: one MOV file per run, joined by the concat demuxer)", () => {
  it("re-encoded runs write a MOV at the source profile with the source's colour tags", () => {
    const args = buildEncodeRunArgs({ base, match, startFrame: 60, outputFile: "/t/v.ts.run1.mov" });
    expect(args.slice(args.indexOf("-profile:v"), args.indexOf("-profile:v") + 2)).toEqual(["-profile:v", "3"]);
    expect(args).toContain("yuv422p10le");
    expect(args).toContain("scale=out_color_matrix=bt709:out_range=tv");
    expect(args.slice(args.indexOf("-colorspace"), args.indexOf("-colorspace") + 2)).toEqual(["-colorspace", "bt709"]);
    expect(args).not.toContain("mpegts");
    expect(args).not.toContain("-output_ts_offset");
    expect(args.at(-1)).toBe("/t/v.ts.run1.mov");
    expect(args[args.indexOf("-f", args.indexOf("-an")) + 1]).toBe("mov");
  });

  it("a proxy-profile source produces a proxy-profile run", () => {
    const args = buildEncodeRunArgs({ base, match: { ...match, proresProfile: "proxy" }, startFrame: 0, outputFile: "/t/r.mov" });
    expect(args[args.indexOf("-profile:v") + 1]).toBe("0");
  });

  it("refuses to build a ProRes run without a file to write", () => {
    expect(() => buildEncodeRunArgs({ base, match, startFrame: 0 })).toThrow(/output file/);
  });

  it("copy runs write a MOV file without MPEG-TS timestamps", () => {
    const args = buildCopyRunArgs({ sourcePath: "/m/a.mov", sourceStart: 1.234, outputStartFrame: 37, frames: 100, frameRate: 29.97, outputFile: "/t/r.mov" });
    // half a frame past the wanted frame (29.97 fps) so the demuxer lands on it exactly
    expect(args[args.indexOf("-ss") + 1]).toBe("1.250683");
    expect(args[args.indexOf("-seek_timestamp") + 1]).toBe("1");
    expect(args.indexOf("-seek_timestamp")).toBeLessThan(args.indexOf("-ss"));
    expect(args).toContain("make_zero");
    expect(args[args.indexOf("-frames:v") + 1]).toBe("100");
    expect(args).toContain("copy");
    expect(args).not.toContain("-copyts");
    expect(args).not.toContain("mpegts");
    expect(args.at(-1)).toBe("/t/r.mov");
  });

  it("the final pass joins the run list with the concat demuxer and copies video", () => {
    const args = buildAssembleArgs({
      videoPath: "/t/list.txt",
      concatList: true,
      audioWavPath: "/t/a.wav",
      outputPath: "/o/out.mov",
      frameRate: 29.97,
      codec: "prores",
      audioCodec: "aac",
      format: "mov",
    });
    expect(args.slice(0, 6)).toEqual(["-y", "-f", "concat", "-safe", "0", "-i"]);
    expect(args[6]).toBe("/t/list.txt");
    expect(args).not.toContain("-tag:v");
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe("30000");
  });

  it("escapes quotes in the concat list", () => {
    expect(concatListFor(["/t/a.mov", "/t/it's.mov"])).toBe("file '/t/a.mov'\nfile '/t/it'\\''s.mov'\n");
  });
});
