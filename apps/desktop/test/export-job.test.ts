import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

const h = vi.hoisted(() => ({ procs: [] as any[] }));

vi.mock("node:child_process", () => ({
  spawn: () => {
    const proc: any = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { writable: true, write: () => true, end: vi.fn() }),
      kill: vi.fn(),
    });
    h.procs.push(proc);
    return proc;
  },
}));
vi.mock("../src/main/sidecar/ffmpeg-path", () => ({ resolveFfmpegPath: () => "ffmpeg" }));

import { ExportJob, type ExportArgs } from "../src/main/sidecar/export-job";

const args: ExportArgs = {
  width: 2, height: 2, frameRate: 30, codec: "h264", encoder: "libx264", mode: "balanced",
  quality: 80, bitrateKbps: 1000, outputPath: "/o.mp4", audioWavPath: "/a.wav", format: "mp4",
};

function make() {
  const onDone = vi.fn();
  const onError = vi.fn();
  const job = new ExportJob(args, vi.fn(), onDone, onError);
  job.start();
  return { job, onDone, onError, proc: h.procs[h.procs.length - 1] };
}

describe("ExportJob reporting", () => {
  it("skips onError after cancel()", () => {
    const { job, onError, onDone, proc } = make();
    job.cancel();
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    proc.emit("close", null);
    proc.emit("error", new Error("x"));
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports at most once when both error and close fire", () => {
    const { onError, proc } = make();
    proc.emit("error", new Error("spawn ENOENT"));
    proc.emit("close", -2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("spawn ENOENT");
  });

  it("reports success once", () => {
    const { onDone, onError, proc } = make();
    proc.emit("close", 0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
