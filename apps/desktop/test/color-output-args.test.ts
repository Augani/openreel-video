import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildFfmpegArgs, type ExportArgs } from "../src/main/sidecar/export-job";
import { videoEncodeArgs } from "../src/main/sidecar/encode-args";
import {
  HDR10_MASTER_DISPLAY,
  isNativeColorOutput,
  rawFrameBytes,
  rawInputPixelFormat,
  x265ColorParams,
  type NativeColorOutput,
} from "../src/main/sidecar/color-output-args";
import { resolveExportArgs, selectColorEncoder } from "../src/main/ipc/export";

const PQ: NativeColorOutput = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" };
const HLG: NativeColorOutput = { primaries: "bt2020", transfer: "hlg", bitDepth: 10, chroma: "420" };
const SDR2020: NativeColorOutput = { primaries: "bt2020", transfer: "bt709", bitDepth: 8, chroma: "420" };
const PRORES_PQ: NativeColorOutput = { ...PQ, chroma: "444" };

const job: ExportArgs = {
  width: 1920, height: 1080, frameRate: 30,
  codec: "hevc", encoder: "libx265", mode: "balanced", quality: 80,
  bitrateKbps: 15000, outputPath: "/tmp/out.mp4", audioWavPath: "/tmp/a.wav",
  format: "mp4",
};

const after = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

describe("raw frame format", () => {
  it("names the pixel format and size of what the renderer sends", () => {
    expect(rawInputPixelFormat(PQ)).toBe("yuv420p10le");
    expect(rawInputPixelFormat(SDR2020)).toBe("yuv420p");
    expect(rawInputPixelFormat(PRORES_PQ)).toBe("yuv444p10le");
    expect(rawFrameBytes(4, 2, PQ)).toBe((8 + 2 * 2) * 2);
    expect(rawFrameBytes(4, 2, SDR2020)).toBe(8 + 2 * 2);
    expect(rawFrameBytes(4, 2, PRORES_PQ)).toBe(4 * 2 * 3 * 2);
  });

  it("validates the shape the renderer sends", () => {
    expect(isNativeColorOutput(PQ)).toBe(true);
    expect(isNativeColorOutput({ ...PQ, transfer: "gamma" })).toBe(false);
    expect(isNativeColorOutput({ ...PQ, bitDepth: 12 })).toBe(false);
    expect(isNativeColorOutput(null)).toBe(false);
  });
});

describe("HDR10 x265 parameters", () => {
  it("PQ carries the mastering display and content light level SEI", () => {
    const params = x265ColorParams(PQ);
    expect(params).toContain("colorprim=bt2020");
    expect(params).toContain("transfer=smpte2084");
    expect(params).toContain("colormatrix=bt2020nc");
    expect(params).toContain("hdr10=1");
    expect(params).toContain(`master-display=${HDR10_MASTER_DISPLAY}`);
    expect(params).toContain("max-cll=1000,400");
  });

  it("HLG is tagged arib-std-b67 with no HDR10 SEI", () => {
    const params = x265ColorParams(HLG);
    expect(params).toContain("transfer=arib-std-b67");
    expect(params).not.toContain("master-display");
    expect(params).not.toContain("hdr10=1");
  });
});

describe("videoEncodeArgs with colour", () => {
  const plan = { mode: "balanced" as const, quality: 80, width: 1920, height: 1080, frameRate: 30 };

  it("libx265 writes Main10 4:2:0 10-bit with the HDR params", () => {
    const args = videoEncodeArgs({ ...plan, codec: "hevc", encoder: "libx265", color: PQ });
    expect(after(args, "-pix_fmt")).toBe("yuv420p10le");
    expect(after(args, "-x265-params")).toContain("hdr10=1");
    expect(after(args, "-tag:v")).toBe("hvc1");
  });

  it("hevc_videotoolbox asks for Main10 and p010", () => {
    const args = videoEncodeArgs({ ...plan, codec: "hevc", encoder: "hevc_videotoolbox", color: PQ });
    expect(after(args, "-profile:v")).toBe("main10");
    expect(after(args, "-pix_fmt")).toBe("p010le");
  });

  it("ProRes 4444 XQ is 4:4:4 10-bit", () => {
    const args = videoEncodeArgs({ ...plan, codec: "prores", encoder: "prores_ks", proresProfile: "4444xq", color: PRORES_PQ });
    expect(after(args, "-profile:v")).toBe("5");
    expect(after(args, "-pix_fmt")).toBe("yuv444p10le");
  });

  it("ProRes 422 HQ takes the renderer's 4:4:4 planes down to 4:2:2 10-bit", () => {
    const args = videoEncodeArgs({ ...plan, codec: "prores", encoder: "prores_ks", proresProfile: "hq", color: PRORES_PQ });
    expect(after(args, "-profile:v")).toBe("3");
    expect(after(args, "-pix_fmt")).toBe("yuv422p10le");
  });

  it("without colour nothing changes (Rec.709 SDR stays argument for argument)", () => {
    const args = videoEncodeArgs({ ...plan, codec: "hevc", encoder: "libx265" });
    expect(args).not.toContain("-x265-params");
    expect(after(args, "-pix_fmt")).toBe("yuv420p");
  });
});

describe("buildFfmpegArgs with colour", () => {
  it("reads raw 10-bit planes, stamps and tags the stream as PQ BT.2020, and does no RGB conversion", () => {
    const a = buildFfmpegArgs({ ...job, color: PQ });
    expect(a.slice(0, 6)).toEqual(["-y", "-f", "rawvideo", "-pix_fmt", "yuv420p10le", "-s"]);
    expect(after(a, "-vf")).toBe("setparams=colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084:range=tv");
    expect(a.join(" ")).not.toContain("scale=out_color_matrix");
    const tags = a.slice(a.indexOf("-colorspace"), a.indexOf("-colorspace") + 8);
    expect(tags).toEqual(["-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-color_range", "tv"]);
  });

  it("Rec.2020 SDR is 8-bit BT.2020 primaries with the BT.709 transfer", () => {
    const a = buildFfmpegArgs({ ...job, encoder: "libx264", codec: "h264", color: SDR2020 });
    expect(a.slice(3, 5)).toEqual(["-pix_fmt", "yuv420p"]);
    expect(a.slice(a.indexOf("-colorspace"), a.indexOf("-colorspace") + 6)).toEqual(["-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "bt709"]);
  });

  it("a job with no colour is unchanged: RGBA pipe and the BT.709 scale", () => {
    const a = buildFfmpegArgs(job);
    expect(a[4]).toBe("rgba");
    expect(after(a, "-vf")).toBe("scale=out_color_matrix=bt709:out_range=tv");
  });
});

describe("encoder selection for colour exports", () => {
  const all = ["libx264", "libx265", "hevc_videotoolbox", "prores_ks", "prores_videotoolbox"];
  it("prefers libx265 for HDR (it writes the mastering metadata), falls back to VideoToolbox", () => {
    expect(selectColorEncoder("hevc", PQ, all, "darwin", "balanced")).toBe("libx265");
    expect(selectColorEncoder("hevc", PQ, ["hevc_videotoolbox"], "darwin", "balanced")).toBe("hevc_videotoolbox");
  });

  it("uses prores_ks for HDR ProRes and refuses codecs that cannot carry HDR", () => {
    expect(selectColorEncoder("prores", PRORES_PQ, all, "darwin", "balanced")).toBe("prores_ks");
    expect(() => selectColorEncoder("h264", PQ, all, "darwin", "balanced")).toThrow(/H.265/);
    expect(() => selectColorEncoder("hevc", PQ, ["libx264"], "darwin", "balanced")).toThrow(/10-bit HEVC/);
    expect(() => selectColorEncoder("prores", PRORES_PQ, ["libx264"], "darwin", "balanced")).toThrow(/prores_ks/);
  });

  it("an SDR Rec.2020 export keeps the usual encoder choice", () => {
    expect(selectColorEncoder("h264", SDR2020, all, "darwin", "balanced")).not.toBe("");
  });

  it("resolveExportArgs carries the colour; HDR ProRes keeps 422 HQ / 4444 and raises the coarse profiles", () => {
    const start = {
      width: 1920, height: 1080, frameRate: 30, codec: "prores", format: "mov", bitrateKbps: 0,
      outputPath: "/tmp/o.mov", totalFrames: 10, audioSampleRate: 48000, audioChannels: 2,
      proresProfile: "hq" as const, color: PRORES_PQ,
    };
    const resolved = resolveExportArgs(start, "darwin", all, "/tmp/a.wav");
    expect(resolved.encoder).toBe("prores_ks");
    expect(resolved.proresProfile).toBe("hq");
    expect(resolveExportArgs({ ...start, proresProfile: "lt" }, "darwin", all, "/tmp/a.wav").proresProfile).toBe("hq");
    expect(resolveExportArgs({ ...start, proresProfile: undefined }, "darwin", all, "/tmp/a.wav").proresProfile).toBe("4444xq");
    expect(resolveExportArgs({ ...start, proresProfile: "4444" }, "darwin", all, "/tmp/a.wav").proresProfile).toBe("4444");
    expect(resolved.color).toEqual(PRORES_PQ);
    expect(() => resolveExportArgs({ ...start, color: { nope: 1 } as never }, "darwin", all, "/tmp/a.wav")).toThrow(/colour/);
  });
});
