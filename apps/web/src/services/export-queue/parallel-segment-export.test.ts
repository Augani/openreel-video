import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportJob, Project, VideoExportSettings } from "@openreel/core";

const hasStabilized = vi.hoisted(() => vi.fn((_clipId: string) => false));
vi.mock("@openreel/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openreel/core")>()),
  getVidstabEngine: () => ({ hasStabilized }),
}));
const saveSnapshot = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./export-queue-storage", () => ({ saveSnapshot }));

import { ParallelExportCancelled, planParallelExport, tryParallelSegmentExport } from "./parallel-segment-export";

const GB = 1024 ** 3;
const settings = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  format: "mp4",
  codec: "h264",
  bitrate: 8000,
  quality: 80,
  keyframeInterval: 60,
  audioSettings: { format: "aac", sampleRate: 48000, bitrate: 192, channels: 2 },
  smartRender: false,
} as unknown as VideoExportSettings;

const projectOf = (seconds: number, effectType?: string): Project =>
  ({
    timeline: {
      duration: seconds,
      tracks: [
        {
          id: "v1",
          clips: [
            {
              id: "c1",
              startTime: 0,
              duration: seconds,
              effects: effectType ? [{ id: "e", type: effectType, enabled: true, params: {} }] : [],
            },
          ],
        },
      ],
    },
  }) as unknown as Project;

const job = { id: "job-1", outputName: "x.mp4" } as ExportJob;
const machine = { logicalCores: 16, memoryBytes: 32 * GB };

describe("planParallelExport", () => {
  it("plans segments and a worker count for a long export", () => {
    const { plan } = planParallelExport(projectOf(60), settings, machine);
    expect(plan).not.toBeNull();
    expect(plan!.workers).toBeGreaterThanOrEqual(2);
    expect(plan!.segments.length).toBeGreaterThan(plan!.workers);
    expect(plan!.segments.at(-1)!.endFrame).toBe(1800);
  });

  it("runs the plan one segment at a time on a small machine, so the file is the same everywhere", () => {
    const { plan } = planParallelExport(projectOf(60), settings, { logicalCores: 4, memoryBytes: 8 * GB });
    expect(plan?.workers).toBe(1);
    expect(plan?.segments.length).toBeGreaterThan(1);
  });

  it("stays one stream when there is no memory for a worker, with a reason", () => {
    const { plan, reasons } = planParallelExport(projectOf(60), settings, { logicalCores: 4, memoryBytes: 1 * GB });
    expect(plan).toBeNull();
    expect(reasons.join(" ")).toMatch(/no room/);
  });

  it("stays serial under critical memory pressure", () => {
    expect(planParallelExport(projectOf(60), settings, { ...machine, pressure: "critical" }).plan).toBeNull();
  });

  it("stays serial when a feedback effect spans the timeline", () => {
    const { plan, reasons } = planParallelExport(projectOf(60, "video-feedback"), settings, machine);
    expect(plan).toBeNull();
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("stays serial for a short export", () => {
    expect(planParallelExport(projectOf(8), settings, machine).plan).toBeNull();
  });
});

describe("tryParallelSegmentExport", () => {
  type Listener = (event: unknown) => void;
  let listener: Listener | null;
  const start = vi.fn(async (_args: unknown) => ({ sessionId: "s1", encoder: "libx264" }));
  const cancel = vi.fn(async (_sessionId: string) => undefined);

  const run = (hooks = { onProgress: vi.fn(), isCancelled: () => false }, project = projectOf(60)) =>
    tryParallelSegmentExport({ job, project, settings, outputPath: "/tmp/out.mp4", hooks });
  const emit = (event: Record<string, unknown>) => listener?.({ sessionId: "s1", ...event });

  beforeEach(() => {
    listener = null;
    start.mockClear();
    cancel.mockClear();
    saveSnapshot.mockResolvedValue(true);
    (window as unknown as { openreel: unknown }).openreel = {
      platform: "desktop",
      probeHardware: async () => ({ cpu: { logicalCores: 16 }, memory: { totalBytes: 32 * GB } }),
      exportSegments: {
        start,
        cancel,
        onEvent: (cb: Listener) => {
          listener = cb;
          return () => {
            listener = null;
          };
        },
      },
    };
  });
  afterEach(() => {
    delete (window as unknown as { openreel?: unknown }).openreel;
  });

  it("returns null (serial) without the desktop bridge", async () => {
    delete (window as unknown as { openreel?: unknown }).openreel;
    expect(await run()).toBeNull();
  });

  it("returns null (serial) when a clip is stabilized, because that render only exists in this window", async () => {
    hasStabilized.mockImplementation((clipId) => clipId === "c1");
    try {
      expect(await run()).toBeNull();
      expect(start).not.toHaveBeenCalled();
    } finally {
      hasStabilized.mockImplementation(() => false);
    }
  });

  it("returns null when the project snapshot cannot be stored, without starting anything", async () => {
    saveSnapshot.mockResolvedValueOnce(false);
    expect(await run()).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("returns null for an export that must stay one stream", async () => {
    const result = await tryParallelSegmentExport({
      job,
      project: projectOf(60),
      settings: { ...settings, codec: "vp9" } as VideoExportSettings,
      outputPath: "/tmp/out.mp4",
      hooks: { onProgress: vi.fn(), isCancelled: () => false },
    });
    expect(result).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts the session with tiling segments and reports progress until done", async () => {
    const hooks = { onProgress: vi.fn(), isCancelled: () => false };
    const pending = run(hooks);
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    const request = start.mock.calls[0][0] as { jobId: string; segments: Array<{ startFrame: number; endFrame: number }>; workers: number; start: { outputPath: string; totalFrames: number } };
    expect(request.jobId).toBe("job-1");
    expect(request.start.outputPath).toBe("/tmp/out.mp4");
    expect(request.start.totalFrames).toBe(1800);
    expect(request.segments[0].startFrame).toBe(0);
    expect(request.segments.at(-1)!.endFrame).toBe(1800);
    request.segments.reduce((expected, segment) => {
      expect(segment.startFrame).toBe(expected);
      return segment.endFrame;
    }, 0);

    emit({ type: "progress", framesDone: 900, totalFrames: 1800, phase: "Rendering segments" });
    await vi.waitFor(() => expect(hooks.onProgress).toHaveBeenCalled());
    expect(hooks.onProgress.mock.calls[0][0]).toBeCloseTo(0.485, 3);
    emit({ type: "done", encoder: "libx264" });
    const result = await pending;
    expect(result).toMatchObject({ path: "/tmp/out.mp4", encoder: "libx264", workers: request.workers });
    expect(hooks.onProgress).toHaveBeenLastCalledWith(1, "Complete");
    expect(listener).toBeNull();
  });

  it("sends the chapter markers with the session start so they are muxed at the final join", async () => {
    const project = projectOf(60);
    (project.timeline as unknown as { markers: unknown[] }).markers = [
      { id: "m1", time: 0, label: "Intro", color: "#fff", kind: "chapter" },
      { id: "m2", time: 30, label: "Act two", color: "#fff", kind: "chapter" },
    ];
    const pending = tryParallelSegmentExport({
      job, project, settings: { ...settings, embedChapters: true } as VideoExportSettings, outputPath: "/tmp/out.mp4",
      hooks: { onProgress: vi.fn(), isCancelled: () => false },
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    const request = start.mock.calls[0][0] as { start: { chaptersMetadata?: string } };
    expect(request.start.chaptersMetadata).toMatch(/^;FFMETADATA1/);
    expect(request.start.chaptersMetadata).toContain("title=Intro");
    expect(request.start.chaptersMetadata).toContain("title=Act two");
    emit({ type: "done", encoder: "libx264" });
    await pending;
  });

  it("ignores events of another session", async () => {
    const pending = run();
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    listener?.({ sessionId: "other", type: "error", message: "not mine" });
    emit({ type: "done", encoder: "libx264" });
    await expect(pending).resolves.toMatchObject({ path: "/tmp/out.mp4" });
  });

  it("rejects with the worker's message and cancels the session when a segment fails", async () => {
    const pending = run();
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    emit({ type: "error", message: "Segment 3 holds 53 of 54 frames." });
    await expect(pending).rejects.toThrow(/53 of 54/);
    expect(cancel).toHaveBeenCalledWith("s1");
  });

  it("cancels the session when the job is cancelled", async () => {
    let cancelled = false;
    const pending = run({ onProgress: vi.fn(), isCancelled: () => cancelled });
    await vi.waitFor(() => expect(start).toHaveBeenCalled());
    cancelled = true;
    await expect(pending).rejects.toBeInstanceOf(ParallelExportCancelled);
    expect(cancel).toHaveBeenCalledWith("s1");
  });
});
