import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const h = vi.hoisted(() => ({ procs: [] as any[], argv: [] as string[][] }));

vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (_cmd: string, argv: string[]) => {
    const proc: any = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { writable: true, write: () => true, end: vi.fn() }),
      kill: vi.fn(),
    });
    h.procs.push(proc);
    h.argv.push(argv);
    return proc;
  },
}));
vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

import { buildFfmpegArgs, buildPass1Args, ExportJob, isTwoPass, type ExportArgs } from "../src/main/sidecar/export-job";
import { videoEncodeArgs } from "../src/main/sidecar/encode-args";
import { resolveExportArgs } from "../src/main/ipc/export";

function passDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openreel-2pass-test-"));
  writeFileSync(join(dir, "pass-0.log"), "stats");
  writeFileSync(join(dir, "pass-0.log.mbtree"), "tree");
  writeFileSync(join(dir, "intermediate.mkv"), "frames");
  return dir;
}

const base = (dir: string, over: Partial<ExportArgs> = {}): ExportArgs => ({
  width: 1920, height: 1080, frameRate: 30, codec: "h264", encoder: "libx264", mode: "balanced",
  quality: 80, bitrateKbps: 8000, maxBitrateKbps: 12000, rateControl: "vbr2", passDir: dir, totalFrames: 100,
  outputPath: "/o.mp4", audioWavPath: "/a.wav", format: "mp4", ...over,
});

const after = (args: string[], flag: string, n = 1): string[] => args.slice(args.indexOf(flag) + 1, args.indexOf(flag) + 1 + n);

beforeEach(() => {
  h.procs.length = 0;
  h.argv.length = 0;
});

describe("two-pass ffmpeg arguments", () => {
  it("pass 1 keeps a lossless intermediate and runs the analysis encode to a null output", () => {
    const dir = "/tmp/pd";
    const args = buildPass1Args(base(dir));
    expect(args).toContain("pipe:0");
    expect(args).toContain("ffv1");
    expect(args).toContain(join(dir, "intermediate.mkv"));
    expect(after(args, "-pass")).toEqual(["1"]);
    expect(after(args, "-passlogfile")).toEqual([join(dir, "pass")]);
    expect(after(args, "-b:v", 5)).toEqual(["8000k", "-maxrate", "12000k", "-bufsize", "24000k", "-preset"].slice(0, 5));
    expect(args.slice(args.indexOf("-an"), args.indexOf("-an") + 4)).toEqual(["-an", "-f", "null", "-"]);
    // The statistics file is named after the output stream index, so the analysis encode is output 0
    // (pass 2, with one output stream, reads pass-0.log).
    expect(args.indexOf("null")).toBeLessThan(args.indexOf("ffv1"));
    expect(args[args.length - 1]).toBe(join(dir, "intermediate.mkv"));
    expect(args).not.toContain("/o.mp4");
    // The analysis sees the same colour conversion the final encode does.
    expect(args).toContain("scale=out_color_matrix=bt709:out_range=tv");
  });

  it("pass 2 reads the intermediate with the same rate and the pass-1 statistics", () => {
    const dir = "/tmp/pd";
    const args = buildFfmpegArgs(base(dir), "pass2");
    expect(args).not.toContain("pipe:0");
    expect(args).not.toContain("rawvideo");
    expect(after(args, "-i")).toEqual([join(dir, "intermediate.mkv")]);
    expect(after(args, "-pass")).toEqual(["2"]);
    expect(after(args, "-passlogfile")).toEqual([join(dir, "pass")]);
    expect(after(args, "-b:v", 5)).toEqual(["8000k", "-maxrate", "12000k", "-bufsize", "24000k", "-preset"].slice(0, 5));
    expect(args).not.toContain("-crf");
    expect(args[args.length - 1]).toBe("/o.mp4");
  });

  it("the single-pass arguments are unchanged and carry no -pass", () => {
    const args = buildFfmpegArgs(base("/tmp/pd", { rateControl: "vbr" }));
    expect(args).toContain("pipe:0");
    expect(args).not.toContain("-pass");
    expect(args).not.toContain("-passlogfile");
  });

  it("libx265 takes the same -pass flags", () => {
    const args = buildPass1Args(base("/tmp/pd", { codec: "hevc", encoder: "libx265" }));
    expect(after(args, "-pass")).toEqual(["1"]);
    expect(args).toContain("libx265");
  });

  it("only libx264 / libx265 run two passes; a hardware encoder never gets -pass", () => {
    expect(isTwoPass(base("/tmp/pd"))).toBe(true);
    expect(isTwoPass(base("/tmp/pd", { encoder: "h264_videotoolbox" }))).toBe(false);
    expect(isTwoPass(base("/tmp/pd", { rateControl: "vbr" }))).toBe(false);
    const hw = videoEncodeArgs({
      codec: "h264", encoder: "h264_videotoolbox", mode: "balanced", quality: 80, width: 1920, height: 1080, frameRate: 30,
      rate: { targetKbps: 6000 }, pass: { stage: 1, logPrefix: "/x" },
    });
    expect(hw).not.toContain("-pass");
  });
});

describe("two-pass ExportJob", () => {
  it("runs pass 1 then pass 2, reports progress across both, and removes the temp dir when done", () => {
    const dir = passDir();
    const frames: number[] = [];
    const onDone = vi.fn();
    const job = new ExportJob(base(dir), (f) => frames.push(f), onDone, vi.fn());
    job.start();
    expect(h.procs).toHaveLength(1);
    expect(h.argv[0]).toContain("ffv1");
    h.procs[0].stderr.emit("data", Buffer.from("frame=100\nprogress=continue\n"));
    expect(frames.at(-1)).toBe(50);
    expect(existsSync(dir)).toBe(true);
    h.procs[0].emit("close", 0);
    expect(h.procs).toHaveLength(2);
    expect(after(h.argv[1], "-pass")).toEqual(["2"]);
    expect(onDone).not.toHaveBeenCalled();
    expect(existsSync(dir)).toBe(true);
    h.procs[1].stderr.emit("data", Buffer.from("frame=50\nprogress=continue\n"));
    expect(frames.at(-1)).toBe(75);
    h.procs[1].stderr.emit("data", Buffer.from("frame=100\nprogress=end\n"));
    expect(frames.at(-1)).toBe(100);
    h.procs[1].emit("close", 0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes the temp dir and reports the error when pass 1 fails (no pass 2)", () => {
    const dir = passDir();
    const onError = vi.fn();
    new ExportJob(base(dir), vi.fn(), vi.fn(), onError).start();
    h.procs[0].stderr.emit("data", Buffer.from("boom"));
    h.procs[0].emit("close", 1);
    expect(h.procs).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes the temp dir when pass 2 fails", () => {
    const dir = passDir();
    const onError = vi.fn();
    new ExportJob(base(dir), vi.fn(), vi.fn(), onError).start();
    h.procs[0].emit("close", 0);
    h.procs[1].emit("close", 1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(existsSync(dir)).toBe(false);
  });

  it("removes the temp dir on cancel in either pass and never starts pass 2 afterwards", () => {
    const dir = passDir();
    const onError = vi.fn();
    const onDone = vi.fn();
    const job = new ExportJob(base(dir), vi.fn(), onDone, onError);
    job.start();
    job.cancel();
    expect(h.procs[0].kill).toHaveBeenCalledWith("SIGKILL");
    expect(existsSync(dir)).toBe(false);
    h.procs[0].emit("close", 0);
    expect(h.procs).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const dir2 = passDir();
    const job2 = new ExportJob(base(dir2), vi.fn(), onDone, onError);
    job2.start();
    h.procs[1].emit("close", 0);
    job2.cancel();
    expect(h.procs[2].kill).toHaveBeenCalledWith("SIGKILL");
    expect(existsSync(dir2)).toBe(false);
  });

  it("a single-pass job never touches a pass directory", () => {
    const dir = passDir();
    const job = new ExportJob(base(dir, { rateControl: "vbr", passDir: undefined }), vi.fn(), vi.fn(), vi.fn());
    job.start();
    h.procs[0].emit("close", 0);
    expect(h.procs).toHaveLength(1);
    expect(existsSync(dir)).toBe(true);
    mkdirSync(dir, { recursive: true });
  });
});

describe("resolveExportArgs for two-pass", () => {
  const start = {
    width: 1920, height: 1080, frameRate: 30, codec: "h264", format: "mp4", bitrateKbps: 8000, maxBitrateKbps: 12000,
    rateControl: "vbr2" as const, outputPath: "/o.mp4", totalFrames: 300, audioSampleRate: 48000, audioChannels: 2,
  };
  const encoders = ["libx264", "libx265", "h264_videotoolbox", "libvpx-vp9"];

  it("forces the software encoder even where a hardware encoder would win, and passes the target and cap", () => {
    const resolved = resolveExportArgs(start, "darwin", encoders, "/a.wav");
    expect(resolved.encoder).toBe("libx264");
    expect(resolved).toMatchObject({ rateControl: "vbr2", bitrateKbps: 8000, maxBitrateKbps: 12000, totalFrames: 300 });
    expect(resolveExportArgs({ ...start, codec: "h265" }, "darwin", encoders, "/a.wav").encoder).toBe("libx265");
  });

  it("refuses codecs, colour output, smart render and builds where two-pass is not real", () => {
    expect(() => resolveExportArgs({ ...start, codec: "vp9" }, "darwin", encoders, "/a.wav")).toThrow(/H\.264 and H\.265 only/);
    expect(() => resolveExportArgs({ ...start, bitrateKbps: 0 }, "darwin", encoders, "/a.wav")).toThrow(/target bitrate/);
    expect(() => resolveExportArgs({ ...start, color: { primaries: "bt2020", transfer: "pq", bitDepth: 10, chroma: "420" } }, "darwin", encoders, "/a.wav")).toThrow(/HDR/);
    expect(() => resolveExportArgs({ ...start, smartRender: { match: { codec: "h264", frameRate: 30 } as never } }, "darwin", encoders, "/a.wav")).toThrow(/smart render/);
    expect(() => resolveExportArgs(start, "darwin", ["h264_videotoolbox"], "/a.wav")).toThrow(/libx264/);
  });
});
