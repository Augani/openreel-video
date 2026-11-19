import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildProxyArgs } from "../src/main/ingest/proxy-args";
import { resolveExportArgs } from "../src/main/ipc/export";
import { PROXY_PRESETS } from "../../../packages/core/src/media/proxy-presets";

const spec = { srcPath: "/in.mov", outPath: "/o.mov.part", srcWidth: 3840, srcHeight: 2160, threads: 2 };
const after = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];
const preset = (id: string) => PROXY_PRESETS.find((p) => p.id === id)!.profile;

describe("proxy preset ffmpeg arguments", () => {
  it("ProRes Proxy: prores_ks profile 0, 4:2:2 10-bit, half size", () => {
    const a = buildProxyArgs({ ...spec, profile: preset("prores-proxy") });
    expect(after(a, "-c:v")).toBe("prores_ks");
    expect(after(a, "-profile:v")).toBe("0");
    expect(after(a, "-vf")).toContain("scale=1920:1080");
    expect(after(a, "-vf")).toContain("yuv422p10le");
  });
  it("H.264 half and quarter differ only in size", () => {
    const half = buildProxyArgs({ ...spec, outPath: "/o.mp4.part", profile: preset("h264-half") });
    const quarter = buildProxyArgs({ ...spec, outPath: "/o.mp4.part", profile: preset("h264-quarter") });
    expect(after(half, "-c:v")).toBe("libx264");
    expect(after(half, "-vf")).toContain("scale=1920:1080");
    expect(after(quarter, "-vf")).toContain("scale=960:540");
    expect(half).toContain("+faststart");
  });
  it("DNxHR LB: dnxhd encoder with the dnxhr_lb profile, 8-bit 4:2:2 in a mov", () => {
    const a = buildProxyArgs({ ...spec, profile: preset("dnxhr-lb") });
    expect(after(a, "-c:v")).toBe("dnxhd");
    expect(after(a, "-profile:v")).toBe("dnxhr_lb");
    expect(after(a, "-vf")).toContain("format=yuv422p");
    expect(after(a, "-f")).toBe("mov");
  });
  it("DNxHR LB with a preview twin writes the intermediate and an H.264 mp4 from one decode", () => {
    const a = buildProxyArgs({ ...spec, profile: preset("dnxhr-lb"), previewOutPath: "/o.preview.mp4.part" });
    expect(a.filter((x) => x === "-c:v")).toHaveLength(2);
    expect(a).toContain("dnxhd");
    expect(a).toContain("libx264");
    expect(a.filter((x) => x === "-i")).toHaveLength(1);
  });
});

describe("export encoder choice reaches the encoder", () => {
  const start = { width: 1920, height: 1080, frameRate: 30, codec: "h264", format: "mp4", bitrateKbps: 8000, outputPath: "/tmp/x.mp4", totalFrames: 10, audioSampleRate: 48000, audioChannels: 2 };
  const encoders = ["libx264", "h264_videotoolbox"];
  const run = (choice: "auto" | "hardware" | "software" | undefined, available = encoders) =>
    resolveExportArgs({ ...start, ...(choice ? { encoderChoice: choice } : {}) }, "darwin", available, "/tmp/a.wav").encoder;
  it("Software forces libx264 even in a hardware-first mode", () => {
    expect(run("software")).toBe("libx264");
  });
  it("Hardware and Auto use VideoToolbox when present", () => {
    expect(run("hardware")).toBe("h264_videotoolbox");
    expect(run("auto")).toBe("h264_videotoolbox");
    expect(run(undefined)).toBe("h264_videotoolbox");
  });
  it("Hardware refuses, with a reason, when no hardware encoder works; Auto falls back", () => {
    expect(() => run("hardware", ["libx264"])).toThrow(/VideoToolbox/);
    expect(run("auto", ["libx264"])).toBe("libx264");
  });
  const hevc = { ...start, codec: "h265", outputPath: "/tmp/x.mov", format: "mov" };
  const pq = { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" } as const;
  const go = (over: Record<string, unknown>, available = ["libx264", "libx265", "h264_videotoolbox", "hevc_videotoolbox"]) =>
    resolveExportArgs({ ...hevc, ...over } as never, "darwin", available, "/tmp/a.wav").encoder;
  it("Hardware with Two-pass VBR is refused, not silently switched to libx264", () => {
    expect(() => go({ codec: "h264", encoderChoice: "hardware", rateControl: "vbr2" })).toThrow(/two-pass/i);
    expect(go({ codec: "h264", encoderChoice: "software", rateControl: "vbr2" })).toBe("libx264");
  });
  it("Hardware with Rec.2020 output is refused; Software gets libx265", () => {
    expect(() => go({ encoderChoice: "hardware", color: pq })).toThrow(/Rec\.2020/);
    expect(go({ encoderChoice: "software", color: pq })).toBe("libx265");
  });
  it("Software never ends up on a hardware encoder under colour output", () => {
    const sdr2020 = { ...pq, transfer: "bt709" };
    expect(go({ encoderChoice: "software", color: sdr2020 })).toBe("libx265");
    expect(() => go({ encoderChoice: "software", color: pq }, ["hevc_videotoolbox"])).toThrow();
  });
});
