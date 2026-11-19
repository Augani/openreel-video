import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_SETTINGS } from "./types";
import {
  EMPTY_EXPORT_QUEUE,
  cancelExportJob,
  clearFinishedExportJobs,
  completeExportJob,
  enqueueExportJob,
  estimateEtaMs,
  exportQueueSummary,
  failExportJob,
  hydrateExportQueue,
  moveExportJob,
  nextRunnableJob,
  removeExportJob,
  reportExportProgress,
  resetExportProgress,
  retryExportJob,
  setExportQueuePaused,
  startExportJob,
  type ExportQueueState,
} from "./export-queue";

const job = (id: string) => ({
  id,
  sequenceName: "Seq",
  presetLabel: "H.264 1080p",
  outputName: `${id}.mp4`,
  settings: DEFAULT_VIDEO_SETTINGS,
  usePreviews: true,
  createdAt: 0,
});
const build = (...ids: string[]): ExportQueueState =>
  ids.reduce((s, id) => enqueueExportJob(s, job(id)), EMPTY_EXPORT_QUEUE);
const ids = (s: ExportQueueState) => s.jobs.map((j) => `${j.id}:${j.status}`);
const out = { filename: "a.mp4", bytes: 10, storage: "browser" as const };

describe("export queue model", () => {
  it("runs jobs one at a time in order", () => {
    let s = build("a", "b");
    expect(nextRunnableJob(s)?.id).toBe("a");
    s = startExportJob(s, "a", 1000);
    expect(nextRunnableJob(s)).toBeUndefined();
    expect(startExportJob(s, "b", 1001)).toBe(s);
    s = completeExportJob(s, "a", 5000, { output: out });
    expect(nextRunnableJob(s)?.id).toBe("b");
    expect(s.jobs[0]).toMatchObject({ status: "completed", progress: 1, elapsedMs: 4000 });
  });

  it("does not start jobs while paused", () => {
    const s = setExportQueuePaused(build("a"), true);
    expect(nextRunnableJob(s)).toBeUndefined();
    expect(nextRunnableJob(setExportQueuePaused(s, false))?.id).toBe("a");
  });

  it("tracks progress monotonically with elapsed time and an ETA", () => {
    let s = startExportJob(build("a"), "a", 0);
    s = reportExportProgress(s, "a", 0.5, "Rendering", 2000);
    expect(s.jobs[0]).toMatchObject({ progress: 0.5, elapsedMs: 2000, etaMs: 2000, phase: "Rendering" });
    s = reportExportProgress(s, "a", 0.3, "Rendering", 2500);
    expect(s.jobs[0].progress).toBe(0.5);
    expect(estimateEtaMs(1000, 0)).toBeUndefined();
    expect(estimateEtaMs(1000, 1)).toBeUndefined();
  });

  it("resets progress, phase and ETA for a re-run so the failed attempt's value does not freeze the bar", () => {
    let s = startExportJob(build("a"), "a", 0);
    s = reportExportProgress(s, "a", 0.8, "Encoding", 4000);
    expect(s.jobs[0].progress).toBe(0.8);
    s = resetExportProgress(s, "a", 5000);
    expect(s.jobs[0]).toMatchObject({ status: "running", progress: 0, phase: "Preparing", elapsedMs: 0, etaMs: undefined, startedAt: 5000, attempts: 1 });
    s = reportExportProgress(s, "a", 0.1, "Rendering", 5500);
    expect(s.jobs[0]).toMatchObject({ progress: 0.1, phase: "Rendering", elapsedMs: 500 });
    expect(s.jobs).toHaveLength(1);
    const queued = build("b");
    expect(resetExportProgress(queued, "b")).toBe(queued);
  });

  it("ignores progress for jobs that are not running", () => {
    const s = build("a");
    expect(reportExportProgress(s, "a", 0.5, "x", 10)).toBe(s);
  });

  it("cancels queued and running jobs and retries them at the end", () => {
    let s = build("a", "b", "c");
    s = startExportJob(s, "a", 0);
    s = cancelExportJob(s, "a", 100);
    s = cancelExportJob(s, "b", 100);
    expect(ids(s)).toEqual(["a:cancelled", "b:cancelled", "c:queued"]);
    s = retryExportJob(s, "a");
    expect(ids(s)).toEqual(["b:cancelled", "c:queued", "a:queued"]);
    expect(s.jobs[2]).toMatchObject({ progress: 0, error: undefined, startedAt: undefined });
    expect(retryExportJob(s, "c")).toBe(s);
  });

  it("retries failed jobs and keeps the attempt count", () => {
    let s = startExportJob(build("a"), "a", 0);
    s = failExportJob(s, "a", 50, "encoder crashed");
    expect(s.jobs[0]).toMatchObject({ status: "failed", error: "encoder crashed", attempts: 1 });
    s = startExportJob(retryExportJob(s, "a"), "a", 60);
    expect(s.jobs[0]).toMatchObject({ status: "running", attempts: 2 });
  });

  it("reorders only queued jobs", () => {
    let s = build("a", "b", "c", "d");
    s = startExportJob(s, "a", 0);
    s = moveExportJob(s, "d", 0);
    expect(ids(s)).toEqual(["a:running", "d:queued", "b:queued", "c:queued"]);
    s = moveExportJob(s, "d", 99);
    expect(ids(s)).toEqual(["a:running", "b:queued", "c:queued", "d:queued"]);
    expect(moveExportJob(s, "a", 2)).toBe(s);
  });

  it("removes jobs except the running one and clears finished ones", () => {
    let s = build("a", "b", "c");
    s = startExportJob(s, "a", 0);
    expect(removeExportJob(s, "a")).toBe(s);
    s = removeExportJob(s, "b");
    s = completeExportJob(s, "a", 9, { output: out });
    s = clearFinishedExportJobs(s);
    expect(ids(s)).toEqual(["c:queued"]);
  });

  it("hydrates a running job as interrupted and comes back paused", () => {
    let s = build("a", "b");
    s = startExportJob(s, "a", 0);
    const back = hydrateExportQueue(s, 500);
    expect(ids(back)).toEqual(["a:interrupted", "b:queued"]);
    expect(back.paused).toBe(true);
    expect(back.jobs[0].error).toMatch(/reloaded/);
    expect(nextRunnableJob(back)).toBeUndefined();
    expect(nextRunnableJob(setExportQueuePaused(retryExportJob(back, "a"), false))?.id).toBe("b");
  });

  it("does not duplicate job ids and summarizes", () => {
    let s = build("a", "a", "b");
    expect(s.jobs).toHaveLength(2);
    s = startExportJob(s, "a", 0);
    s = failExportJob(s, "a", 1, "x");
    expect(exportQueueSummary(s)).toEqual({ total: 2, queued: 1, running: 0, completed: 0, failed: 1 });
  });
});

describe("stems jobs", () => {
  const stemsJob = (id: string) => ({
    ...job(id),
    kind: "stems" as const,
    stems: { busIds: ["bus-a", "bus-b"], bitDepth: 24 as const },
    outputName: `${id}.zip`,
  });
  const outputs = [
    { busId: "bus-a", name: "Dialogue", filename: "P_Dialogue.wav", bytes: 100, sampleRate: 48000, channels: 2, durationSec: 4 },
    { busId: "bus-b", name: "Music", filename: "P_Music.wav", bytes: 100, sampleRate: 48000, channels: 2, durationSec: 4 },
  ];

  it("queues, runs and completes with per-stem outputs listed", () => {
    let s = enqueueExportJob(EMPTY_EXPORT_QUEUE, stemsJob("s1"));
    expect(s.jobs[0].kind).toBe("stems");
    expect(s.jobs[0].stems?.busIds).toEqual(["bus-a", "bus-b"]);
    s = startExportJob(s, "s1", 1);
    s = completeExportJob(s, "s1", 5, {
      output: { filename: "s1.zip", bytes: 300, storage: "browser" },
      stemOutputs: outputs,
    });
    expect(s.jobs[0].status).toBe("completed");
    expect(s.jobs[0].stemOutputs?.map((o) => o.filename)).toEqual(["P_Dialogue.wav", "P_Music.wav"]);
  });

  it("a failed stems job retries with its stems spec intact and no stale listing", () => {
    let s = enqueueExportJob(EMPTY_EXPORT_QUEUE, stemsJob("s1"));
    s = startExportJob(s, "s1", 1);
    s = failExportJob(s, "s1", 9, "x");
    s = retryExportJob(s, "s1");
    expect(s.jobs[0].stemOutputs).toBeUndefined();
    expect(s.jobs[0].stems?.bitDepth).toBe(24);
    expect(s.jobs[0].status).toBe("queued");
  });

  it("video jobs are unaffected", () => {
    const s = enqueueExportJob(EMPTY_EXPORT_QUEUE, job("v"));
    expect(s.jobs[0].kind).toBeUndefined();
    expect(s.jobs[0].stemOutputs).toBeUndefined();
  });
});
