import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  jobs: [] as Array<{ args: { passDir?: string }; onError: (m: string) => void; onDone: () => void; cancel: ReturnType<typeof vi.fn> }>,
  ports: [] as Array<{ emitter: EventEmitter; postMessage: ReturnType<typeof vi.fn> }>,
  freeBytes: Number.MAX_SAFE_INTEGER as number,
  statfsFails: false,
  tempRoot: "",
}));

vi.mock("electron", () => ({
  MessageChannelMain: class {
    port1: unknown;
    port2 = {};
    constructor() {
      const emitter = new EventEmitter();
      const port = Object.assign(emitter, { start: vi.fn(), postMessage: vi.fn() });
      h.ports.push({ emitter, postMessage: port.postMessage });
      this.port1 = port;
    }
  },
}));
vi.mock("../src/main/power", () => ({
  acquirePowerHold: vi.fn(),
  releasePowerHold: vi.fn(),
  releaseAllPowerHolds: vi.fn(),
}));
vi.mock("../src/main/temp-dir", () => ({
  appTempDir: () => h.tempRoot,
  newTempPathReady: async (prefix: string, ext: string) => `${h.tempRoot}/${prefix}.${ext}`,
  releaseTemp: async () => true,
  releaseTempSync: () => true,
}));
vi.mock("../src/main/sidecar/encoder-probe", async () => {
  const actual = await vi.importActual<typeof import("../src/main/sidecar/encoder-probe")>("../src/main/sidecar/encoder-probe");
  return { ...actual, getVerifiedEncoders: async () => ["libx264", "libx265"] };
});
vi.mock("../src/main/sidecar/export-job", () => ({
  ExportJob: class {
    start = vi.fn();
    writeFrame = vi.fn(async () => {});
    endInput = vi.fn();
    cancel = vi.fn();
    constructor(public args: { passDir?: string }, _onFrame: unknown, public onDone: () => void, public onError: (m: string) => void) {
      h.jobs.push(this as never);
    }
  },
}));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: vi.fn(async () => {}),
      statfs: vi.fn(async () => {
        if (h.statfsFails) throw new Error("no statfs");
        return { bavail: h.freeBytes, bsize: 1 };
      }),
    },
  };
});

import { startExport, writeAudioWav, cancelExport, cancelAllExports, twoPassScratchBytes } from "../src/main/ipc/export";

const wc = { postMessage: vi.fn() } as never;
const twoPassArgs = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  codec: "h264",
  format: "mp4",
  bitrateKbps: 8000,
  maxBitrateKbps: 12000,
  rateControl: "vbr2" as const,
  outputPath: "/tmp/out.mp4",
  totalFrames: 30,
  audioSampleRate: 48000,
  audioChannels: 2,
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const passDirs = (): string[] => readdirSync(h.tempRoot).filter((name) => name.startsWith("openreel-2pass-"));

beforeEach(() => {
  h.tempRoot = mkdtempSync(join(tmpdir(), "openreel-2pass-ipc-"));
  h.jobs.length = 0;
  h.ports.length = 0;
  h.freeBytes = Number.MAX_SAFE_INTEGER;
  h.statfsFails = false;
});
afterAll(() => {
  rmSync(h.tempRoot, { recursive: true, force: true });
});

describe("two-pass export IPC cleanup", () => {
  it("creates a pass directory for vbr2 and cancelExport removes it", async () => {
    const { jobId } = await startExport(wc, twoPassArgs);
    expect(passDirs()).toHaveLength(1);
    await cancelExport({ jobId });
    expect(passDirs()).toHaveLength(0);
  });

  it("a one-pass export never creates a pass directory", async () => {
    const { jobId } = await startExport(wc, { ...twoPassArgs, rateControl: "vbr" });
    expect(passDirs()).toHaveLength(0);
    await cancelExport({ jobId });
  });

  it("cancelAllExports (app quit) removes every pass directory", async () => {
    await startExport(wc, twoPassArgs);
    await startExport(wc, twoPassArgs);
    expect(passDirs()).toHaveLength(2);
    cancelAllExports();
    expect(passDirs()).toHaveLength(0);
  });

  it("a failed job removes the pass directory", async () => {
    const { jobId } = await startExport(wc, twoPassArgs);
    await writeAudioWav({ jobId, wav: new ArrayBuffer(4) });
    expect(h.jobs[0].args.passDir && existsSync(h.jobs[0].args.passDir)).toBe(true);
    h.jobs[0].onError("ffmpeg exploded");
    await flush();
    expect(passDirs()).toHaveLength(0);
    expect(h.ports[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error", message: "ffmpeg exploded" }));
  });

  it("a finished job removes the pass directory", async () => {
    const { jobId } = await startExport(wc, twoPassArgs);
    await writeAudioWav({ jobId, wav: new ArrayBuffer(4) });
    h.jobs[0].onDone();
    await flush();
    expect(passDirs()).toHaveLength(0);
  });
});

describe("two-pass scratch space pre-check", () => {
  it("estimates half the raw RGBA size of the intermediate", () => {
    expect(twoPassScratchBytes(1920, 1080, 100)).toBe(Math.ceil(1920 * 1080 * 4 * 100 * 0.5));
  });

  it("refuses up front, creating nothing, when the temp volume is too small", async () => {
    h.freeBytes = twoPassScratchBytes(1920, 1080, 30) - 1;
    await expect(startExport(wc, twoPassArgs)).rejects.toThrow(/temporary disk space/);
    expect(passDirs()).toHaveLength(0);
    expect(h.ports).toHaveLength(0);
  });

  it("starts when exactly enough space is free, and when free space cannot be read", async () => {
    h.freeBytes = twoPassScratchBytes(1920, 1080, 30);
    const first = await startExport(wc, twoPassArgs);
    await cancelExport(first);
    h.statfsFails = true;
    const second = await startExport(wc, twoPassArgs);
    await cancelExport(second);
  });

  it("does not check space for one-pass exports", async () => {
    h.freeBytes = 0;
    const { jobId } = await startExport(wc, { ...twoPassArgs, rateControl: "vbr" });
    await cancelExport({ jobId });
  });
});
