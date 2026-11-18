import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, type ExportArgs } from "../src/main/sidecar/export-job";
import { rateControlArgs, videoEncodeArgs } from "../src/main/sidecar/encode-args";

const base: ExportArgs = {
  width: 1920, height: 1080, frameRate: 30, codec: "h264", encoder: "libx264", mode: "balanced",
  quality: 80, bitrateKbps: 8000, outputPath: "/o.mp4", audioWavPath: "/a.wav", format: "mp4",
};

describe("rate control", () => {
  it("rateControlArgs caps the peak and sizes the buffer from it", () => {
    expect(rateControlArgs({ targetKbps: 8000, maxKbps: 12000 })).toEqual(["-b:v", "8000k", "-maxrate", "12000k", "-bufsize", "24000k"]);
    expect(rateControlArgs({ targetKbps: 8000 })).toEqual(["-b:v", "8000k", "-maxrate", "12000k", "-bufsize", "24000k"]);
    // A max below the target is lifted to the target.
    expect(rateControlArgs({ targetKbps: 8000, maxKbps: 5000 })[3]).toBe("8000k");
  });

  it("libx264 uses CRF by default and target / max bitrate under VBR", () => {
    const crf = buildFfmpegArgs(base);
    expect(crf).toContain("-crf");
    expect(crf).not.toContain("-maxrate");
    const vbr = buildFfmpegArgs({ ...base, rateControl: "vbr", maxBitrateKbps: 10000 });
    expect(vbr).not.toContain("-crf");
    const i = vbr.indexOf("-b:v");
    expect(vbr.slice(i, i + 6)).toEqual(["-b:v", "8000k", "-maxrate", "10000k", "-bufsize", "20000k"]);
    expect(vbr).toContain("-preset");
  });

  it("VP9 under VBR keeps its libvpx options and drops CRF", () => {
    const args = videoEncodeArgs({ codec: "vp9", encoder: "libvpx-vp9", mode: "balanced", quality: 80, width: 1280, height: 720, frameRate: 30, rate: { targetKbps: 3000, maxKbps: 4000 } });
    expect(args).toContain("-row-mt");
    expect(args).not.toContain("-crf");
    expect(args).toContain("3000k");
  });

  it("hardware encoders take the explicit rate instead of the derived one", () => {
    const args = videoEncodeArgs({ codec: "h264", encoder: "h264_videotoolbox", mode: "balanced", quality: 80, width: 1920, height: 1080, frameRate: 30, rate: { targetKbps: 6000, maxKbps: 7000 } });
    expect(args).toContain("6000k");
    expect(args).toContain("7000k");
    expect(args).toContain("-allow_sw");
  });

  it("ProRes ignores the rate", () => {
    const args = videoEncodeArgs({ codec: "prores", encoder: "prores_ks", mode: "balanced", quality: 80, width: 1920, height: 1080, frameRate: 30, rate: { targetKbps: 6000 } });
    expect(args).not.toContain("-maxrate");
  });

  it("AV1 and the broadcast codecs keep their own rate (the dialog and the agent refuse VBR for them)", () => {
    const plan = { mode: "balanced" as const, quality: 80, width: 1920, height: 1080, frameRate: 30, rate: { targetKbps: 6000, maxKbps: 9000 } };
    const av1 = videoEncodeArgs({ ...plan, codec: "av1", encoder: "libsvtav1" });
    expect(av1).toContain("-crf");
    expect(av1).not.toContain("-maxrate");
    const xdcam = videoEncodeArgs({ ...plan, codec: "xdcamhd422", encoder: "mpeg2video" });
    expect(xdcam).toContain("50000k");
    expect(xdcam).not.toContain("9000k");
    const intra = videoEncodeArgs({ ...plan, codec: "avcintra100", encoder: "libx264" });
    expect(intra.join(" ")).toContain("avcintra-class=100");
    expect(intra).not.toContain("-maxrate");
  });
});
