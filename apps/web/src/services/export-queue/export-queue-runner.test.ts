import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const hoisted = vi.hoisted(() => ({
  calls: [] as string[],
  live: { id: "live" },
  fail: { current: false },
  initFail: { current: false },
  singletonUsed: vi.fn(),
  disposed: vi.fn(async () => undefined),
  isolatedCreated: vi.fn(),
  options: [] as unknown[],
}));

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return {
    ...actual,
    getExportEngine: () => {
      hoisted.singletonUsed();
      throw new Error("the shared export engine must not be used by a queued job");
    },
    planInvalidation: () => ({ all: true, ranges: [] }),
    createIsolatedExportEngine: () => {
      hoisted.isolatedCreated();
      return {
        engine: {
          initialize: async () => {
            if (hoisted.initFail.current) throw new Error("init failed");
          },
          cancel: () => hoisted.calls.push("engine.cancel"),
          async *exportVideo(_project: unknown, _settings: unknown, _writable: unknown, options: unknown) {
            hoisted.calls.push("engine.exportVideo");
            hoisted.options.push(options);
            yield { phase: "rendering", progress: 0.5 };
            if (hoisted.fail.current) throw new Error("encoder crashed");
            return {
              success: true,
              stats: { framesFromCache: 0, smartRender: { active: true, copiedFrames: 62, totalFrames: 100, copiedPercent: 62, copiedRuns: 1, reasons: [], summary: "Smart render: 62% copied" } },
            };
          },
        },
        dispose: async () => {
          hoisted.calls.push("engine.dispose");
          await hoisted.disposed();
        },
      };
    },
  };
});
vi.mock("../project-fonts", () => ({ ensureProjectFonts: async () => undefined }));
vi.mock("../render-cache-service", () => ({ renderCacheService: { createExportFrameSource: () => null } }));
vi.mock("../export-runner", () => ({ mimeForExt: () => "video/mp4", extForFormat: () => "mp4" }));
vi.mock("../native-ffmpeg-backend", () => ({ NativeFFmpegBackend: class {} }));
vi.mock("./export-queue-storage", () => ({
  createBrowserOutputSink: async () => ({
    writable: { abort: async () => undefined },
    finish: async () => 123,
    discard: async () => undefined,
  }),
}));
vi.mock("../../stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({
      getFullProject: () => hoisted.live,
      syncRenderProcessingFrom: (project: unknown) => hoisted.calls.push(project === hoisted.live ? "sync(live)" : "sync(snapshot)"),
    }),
  },
}));
vi.mock("../../stores/timeline-store", () => ({
  useTimelineStore: {
    getState: () => ({
      pause: () => hoisted.calls.push("pause"),
      lockPlayback: () => hoisted.calls.push("lock"),
      unlockPlayback: () => hoisted.calls.push("unlock"),
    }),
  },
}));

import { cancelRunningExportJob, runExportJob } from "./export-queue-runner";

const job = {
  id: "j1",
  sequenceName: "Seq",
  presetLabel: "P",
  outputName: "out.mp4",
  settings: { format: "mp4", codec: "h264", width: 640, height: 360, frameRate: 30, bitrate: 2000, bitrateMode: "cbr", quality: 80, keyframeInterval: 60, audioSettings: {} },
  usePreviews: false,
  status: "running",
  progress: 0,
  phase: "",
  createdAt: 0,
  elapsedMs: 0,
  attempts: 1,
} as never;
const snapshot = { id: "snapshot" } as never;
const hooks = { onProgress: vi.fn(), isCancelled: () => false };

beforeEach(() => {
  hoisted.calls.length = 0;
  hoisted.options.length = 0;
  calls.length = 0;
  hoisted.fail.current = false;
  hoisted.initFail.current = false;
  hoisted.singletonUsed.mockClear();
  hoisted.isolatedCreated.mockClear();
});

describe("runExportJob isolation from the live preview", () => {
  it("renders with its own engines, never the shared export engine, and restores the editor afterwards", async () => {
    const result = await runExportJob(job, snapshot, hooks);
    expect(hoisted.isolatedCreated).toHaveBeenCalledTimes(1);
    expect(hoisted.singletonUsed).not.toHaveBeenCalled();
    // Lock the editor, point the shared processing at the snapshot, export,
    // restore the LIVE project, unlock, release the job's engines.
    expect(hoisted.calls).toEqual(["pause", "lock", "sync(snapshot)", "engine.exportVideo", "sync(live)", "unlock", "engine.dispose"]);
    expect(result.smartRender).toEqual({ copiedPercent: 62, summary: "Smart render: 62% copied", copiedFrames: 62, totalFrames: 100, copiedRuns: 1, reasons: [] });
  });

  it("passes the software preference to the browser engine for this run only", async () => {
    await runExportJob(job, snapshot, hooks, "prefer-software");
    await runExportJob(job, snapshot, hooks);
    expect(hoisted.options[0]).toMatchObject({ encoderPreference: "prefer-software" });
    expect(hoisted.options[1]).not.toHaveProperty("encoderPreference");
  });

  it("restores and unlocks when the export fails midway", async () => {
    hoisted.fail.current = true;
    await expect(runExportJob(job, snapshot, hooks)).rejects.toThrow("encoder crashed");
    expect(hoisted.calls).toEqual(["pause", "lock", "sync(snapshot)", "engine.exportVideo", "sync(live)", "unlock", "engine.dispose"]);
  });

  it("releases the job's engines when it fails before the export starts", async () => {
    hoisted.initFail.current = true;
    await expect(runExportJob(job, snapshot, hooks)).rejects.toThrow("init failed");
    expect(hoisted.calls).toEqual(["engine.dispose"]);
  });

  it("cancels the job's own engine, not the live one", async () => {
    const gate = runExportJob(job, snapshot, { ...hooks, isCancelled: () => true });
    await expect(gate).rejects.toThrow();
    cancelRunningExportJob(); // nothing running any more: must be a harmless no-op
    expect(hoisted.singletonUsed).not.toHaveBeenCalled();
  });
});
