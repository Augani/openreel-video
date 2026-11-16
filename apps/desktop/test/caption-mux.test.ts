import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

import {
  buildFfmpegArgs,
  captionMuxArgs,
  usableCaptionInputs,
  type ExportArgs,
} from "../src/main/sidecar/export-job";

const base: ExportArgs = {
  width: 640, height: 360, frameRate: 30, codec: "h264", encoder: "libx264", mode: "balanced",
  quality: 80, bitrateKbps: 1000, outputPath: "/o.mp4", audioWavPath: "/a.wav", format: "mp4",
};

describe("embedded caption muxing", () => {
  it("adds nothing without captions (existing exports are unchanged)", () => {
    expect(captionMuxArgs(base)).toEqual({ inputs: [], outputs: [] });
    expect(buildFfmpegArgs(base)).not.toContain("-map");
  });

  it("muxes an SRT as mov_text in MP4 with its language", () => {
    const args = buildFfmpegArgs({ ...base, captionInputs: [{ path: "/c.srt", kind: "mov_text", language: "eng" }] });
    const i = args.indexOf("/c.srt");
    expect(args[i - 1]).toBe("-i");
    // inputs: video pipe, audio wav, captions; maps pick video 0, audio 1, captions 2
    expect(args.join(" ")).toContain("-map 0:v:0 -map 1:a:0 -map 2:0 -c:s:0 mov_text -metadata:s:s:0 language=eng");
    expect(args.indexOf("/c.srt")).toBeLessThan(args.indexOf("-c:v"));
    expect(args[args.length - 1]).toBe("/o.mp4");
  });

  it("copies SCC byte pairs into a c608 track in MOV", () => {
    const args = buildFfmpegArgs({ ...base, format: "mov", outputPath: "/o.mov", captionInputs: [{ path: "/c.scc", kind: "cea608", language: "eng" }] });
    expect(args.join(" ")).toContain("-map 2:0 -c:s:0 copy");
  });

  it("numbers several caption tracks and defaults an unknown language to und", () => {
    const args = buildFfmpegArgs({
      ...base,
      captionInputs: [
        { path: "/en.srt", kind: "mov_text", language: "eng" },
        { path: "/es.srt", kind: "mov_text" },
      ],
    }).join(" ");
    expect(args).toContain("-map 3:0 -c:s:1 mov_text -metadata:s:s:1 language=und");
  });

  it("drops tracks the container cannot hold", () => {
    const scc = { path: "/c.scc", kind: "cea608" as const };
    const srt = { path: "/c.srt", kind: "mov_text" as const };
    expect(usableCaptionInputs("mp4", [scc, srt])).toEqual([srt]);
    expect(usableCaptionInputs("mov", [scc, srt])).toEqual([scc, srt]);
    expect(usableCaptionInputs("webm", [srt])).toEqual([]);
  });
});
