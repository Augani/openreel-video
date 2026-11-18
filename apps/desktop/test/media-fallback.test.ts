import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const h = vi.hoisted(() => ({
  calls: [] as string[][],
  exitCodes: [] as number[],
}));

vi.mock("node:child_process", () => ({
  spawn: (_bin: string, args: string[]) => {
    h.calls.push(args);
    const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
    const code = h.exitCodes.shift() ?? 0;
    setTimeout(() => proc.emit("close", code), 0);
    return proc;
  },
  execFile: vi.fn(),
}));
vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

import { runWithHwaccelFallback, buildProxyArgs } from "../src/main/sidecar/media-job";
import { pickH264Encoder } from "../src/main/sidecar/encoder-probe";

beforeEach(() => {
  h.calls.length = 0;
  h.exitCodes.length = 0;
});

describe("runWithHwaccelFallback", () => {
  it("retries a failed hardware-encoder job on libx264 without -hwaccel", async () => {
    h.exitCodes.push(1, 0);
    const hw = buildProxyArgs("/in.mp4", "/o.mp4", "low", "h264_nvenc");
    const sw = buildProxyArgs("/in.mp4", "/o.mp4", "low", "libx264");
    await runWithHwaccelFallback(hw, sw);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toContain("libx264");
    expect(h.calls[1]).toContain("-crf");
    expect(h.calls[1]).not.toContain("-hwaccel");
    expect(h.calls[1]).not.toContain("h264_nvenc");
  });

  it("retries only once, then rejects", async () => {
    h.exitCodes.push(1, 1);
    const hw = buildProxyArgs("/in.mp4", "/o.mp4", "low", "h264_nvenc");
    await expect(runWithHwaccelFallback(hw, buildProxyArgs("/in.mp4", "/o.mp4", "low"))).rejects.toThrow();
    expect(h.calls).toHaveLength(2);
  });

  it("without software args only strips -hwaccel", async () => {
    h.exitCodes.push(1, 0);
    await runWithHwaccelFallback(buildProxyArgs("/in.mp4", "/o.mp4", "low", "libx264", true));
    expect(h.calls[0]).toContain("-hwaccel");
    expect(h.calls[1]).not.toContain("-hwaccel");
  });
});

describe("pickH264Encoder", () => {
  it("never selects a vaapi encoder", () => {
    expect(pickH264Encoder("linux", ["h264_vaapi", "libx264"])).toBe("libx264");
    expect(pickH264Encoder("linux", ["h264_vaapi", "h264_nvenc", "libx264"])).toBe("h264_nvenc");
    expect(pickH264Encoder("linux", ["h264_vaapi"])).toBe("libx264");
  });
});
