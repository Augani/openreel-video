import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const h = vi.hoisted(() => ({
  jobs: [] as Array<{
    args: { encoder: string };
    onError: (m: string) => void;
    onDone: () => void;
    start: ReturnType<typeof vi.fn>;
    writeFrame: ReturnType<typeof vi.fn>;
    endInput: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  }>,
  ports: [] as Array<{ emitter: EventEmitter; postMessage: ReturnType<typeof vi.fn> }>,
  encoders: [] as string[],
  lost: [] as Array<(() => void) | undefined>,
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
  acquirePowerHold: (_id: string, _wc: unknown, onLost?: () => void) => h.lost.push(onLost),
  releasePowerHold: vi.fn(),
  releaseAllPowerHolds: vi.fn(),
}));
vi.mock("../src/main/temp-dir", () => ({
  newTempPathReady: async (prefix: string, ext: string) => `/tmp/${prefix}.${ext}`,
  releaseTemp: async () => true,
  releaseTempSync: () => true,
}));
vi.mock("../src/main/sidecar/encoder-probe", async () => {
  const actual = await vi.importActual<typeof import("../src/main/sidecar/encoder-probe")>(
    "../src/main/sidecar/encoder-probe",
  );
  return { ...actual, getVerifiedEncoders: async () => h.encoders };
});
vi.mock("../src/main/sidecar/export-job", () => ({
  ExportJob: class {
    start = vi.fn();
    writeFrame = vi.fn(async () => {});
    endInput = vi.fn();
    cancel = vi.fn();
    constructor(
      public args: { encoder: string },
      _onFrame: unknown,
      public onDone: () => void,
      public onError: (m: string) => void,
    ) {
      h.jobs.push(this as never);
    }
  },
}));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, promises: { ...actual.promises, writeFile: vi.fn(async () => {}) } };
});

import {
  startExport,
  writeAudioWav,
  cancelExport,
  softwareFallbackEncoder,
  hardwareFailureMessage,
  isOutputIoFailure,
} from "../src/main/ipc/export";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const wc = { postMessage: vi.fn() } as never;
const startArgs = {
  width: 2,
  height: 2,
  frameRate: 30,
  codec: "h264",
  format: "mp4",
  bitrateKbps: 1000,
  outputPath: "/tmp/out.mp4",
  totalFrames: 3,
  audioSampleRate: 48000,
  audioChannels: 2,
};

const realPlatform = process.platform;

beforeEach(() => {
  h.jobs.length = 0;
  h.ports.length = 0;
  h.lost.length = 0;
  h.encoders = ["h264_videotoolbox", "libx264"];
  Object.defineProperty(process, "platform", { value: "darwin" });
});
afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
});

async function begin(): Promise<{ jobId: string; send: (m: unknown) => void; errors: () => unknown[] }> {
  const { jobId } = await startExport(wc, startArgs);
  const port = h.ports[h.ports.length - 1];
  await writeAudioWav({ jobId, wav: new ArrayBuffer(4) });
  return {
    jobId,
    send: (m) => port.emitter.emit("message", { data: m }),
    errors: () => port.postMessage.mock.calls.map((c) => c[0]).filter((m) => m.type === "error"),
  };
}

describe("softwareFallbackEncoder", () => {
  it("maps a hardware encoder to its software counterpart when available", () => {
    expect(softwareFallbackEncoder("h264", "h264_videotoolbox", ["libx264"])).toBe("libx264");
    expect(softwareFallbackEncoder("hevc", "hevc_nvenc", ["libx265"])).toBe("libx265");
    expect(softwareFallbackEncoder("av1", "av1_qsv", ["libsvtav1"])).toBe("libsvtav1");
  });
  it("returns null for software encoders or a missing fallback", () => {
    expect(softwareFallbackEncoder("h264", "libx264", ["libx264"])).toBeNull();
    expect(softwareFallbackEncoder("h264", "h264_nvenc", [])).toBeNull();
  });
  it("makes the failure message actionable", () => {
    expect(hardwareFailureMessage("h264_nvenc", "boom")).toContain("software encoder");
  });
});

describe("hardware encoder failure", () => {
  it("replays received frames into a software job and finishes it", async () => {
    const t = await begin();
    expect(h.jobs[0].args.encoder).toBe("h264_videotoolbox");
    const f0 = new ArrayBuffer(16);
    const f1 = new ArrayBuffer(16);
    t.send({ type: "frame", buffer: f0, ts: 0 });
    t.send({ type: "frame", buffer: f1, ts: 1 / 30 });
    await flush();
    h.jobs[0].onError("ffmpeg exited with code 1");
    t.send({ type: "finish" });
    await flush();

    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].args.encoder).toBe("libx264");
    expect(h.jobs[1].start).toHaveBeenCalled();
    expect(h.jobs[1].writeFrame).toHaveBeenCalledTimes(2);
    expect(h.jobs[1].endInput).toHaveBeenCalledTimes(1);
    expect(t.errors()).toEqual([]);
  });

  it("reports an actionable error when the software retry also fails, without looping", async () => {
    const t = await begin();
    t.send({ type: "frame", buffer: new ArrayBuffer(16), ts: 0 });
    await flush();
    h.jobs[0].onError("hw fail");
    await flush();
    h.jobs[1].onError("sw fail");
    await flush();
    expect(h.jobs).toHaveLength(2);
    expect(t.errors()).toEqual([{ type: "error", message: "sw fail" }]);
  });

  it("explains the failure when no software encoder is available", async () => {
    h.encoders = ["h264_videotoolbox"];
    const t = await begin();
    h.jobs[0].onError("hw fail");
    await flush();
    expect(h.jobs).toHaveLength(1);
    expect(JSON.stringify(t.errors())).toContain("software encoder");
  });

  it("does not retry a cancelled job", async () => {
    const t = await begin();
    await cancelExport({ jobId: t.jobId });
    h.jobs[0].onError("killed");
    await flush();
    expect(h.jobs).toHaveLength(1);
    expect(t.errors()).toEqual([]);
  });

  it("cancels the job when the power hold reports the renderer is gone", async () => {
    const t = await begin();
    h.lost[h.lost.length - 1]?.();
    await flush();
    expect(h.jobs[0].cancel).toHaveBeenCalled();
    h.jobs[0].onError("killed");
    await flush();
    expect(t.errors()).toEqual([]);
  });

  it("does not schedule a software retry when cancelled while a retry is pending", async () => {
    const t = await begin();
    t.send({ type: "frame", buffer: new ArrayBuffer(16), ts: 0 });
    await flush();
    h.jobs[0].onError("hw fail");
    await cancelExport({ jobId: t.jobId });
    await flush();
    expect(h.jobs).toHaveLength(1);
    expect(t.errors()).toEqual([]);
  });

  it("reports disk/path failures plainly, with no retry and no encoder hint", async () => {
    const t = await begin();
    t.send({ type: "frame", buffer: new ArrayBuffer(16), ts: 0 });
    await flush();
    h.jobs[0].onError("ffmpeg exited with code 1: Error writing trailer: No space left on device");
    await flush();
    expect(h.jobs).toHaveLength(1);
    expect(t.errors()).toEqual([
      { type: "error", message: "ffmpeg exited with code 1: Error writing trailer: No space left on device" },
    ]);
  });
});

describe("isOutputIoFailure", () => {
  it("flags disk and permission problems", () => {
    expect(isOutputIoFailure("write failed: ENOSPC", "/o.mp4")).toBe(true);
    expect(isOutputIoFailure("/o.mp4: Permission denied", "/o.mp4")).toBe(true);
  });
  it("flags path errors only when they concern the output", () => {
    expect(isOutputIoFailure("/out/o.mp4: No such file or directory", "/out/o.mp4")).toBe(true);
    expect(isOutputIoFailure("Error opening output file: Invalid argument", "/out/o.mp4")).toBe(true);
    expect(isOutputIoFailure("[h264_nvenc] Invalid argument", "/out/o.mp4")).toBe(false);
  });
  it("does not flag encoder failures", () => {
    expect(isOutputIoFailure("ffmpeg exited with code 1: Cannot load libcuda.so.1", "/o.mp4")).toBe(false);
  });
});
