import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  project: { current: null as unknown },
  runs: [] as Array<{
    jobId: string;
    project: unknown;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    isCancelled: () => boolean;
    onProgress: (p: number, phase: string) => void;
    encoder?: string;
  }>,
  persisted: { current: null as unknown },
  cancelEngine: vi.fn(),
}));

vi.mock("./project-store", () => ({
  useProjectStore: { getState: () => ({ getFullProject: () => hoisted.project.current }) },
}));
vi.mock("./ui-store", () => ({ useUIStore: { getState: () => ({ exportState: { isExporting: false } }) } }));
vi.mock("./notification-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("../services/render-cache-service", () => ({ renderCacheService: { isRenderingNow: () => false } }));
vi.mock("../services/export-runner", () => ({
  extForFormat: (format: string) => format,
}));
vi.mock("../services/export-queue/export-queue-storage", () => ({
  deleteBrowserOutput: vi.fn(async () => undefined),
  loadQueueState: vi.fn(async () => hoisted.persisted.current),
  loadSnapshot: vi.fn(async () => null),
  pruneStorage: vi.fn(async () => undefined),
  readBrowserOutput: vi.fn(async () => null),
  saveQueueState: vi.fn(async () => undefined),
  saveSnapshot: vi.fn(async () => true),
}));
vi.mock("../services/export-queue/export-queue-runner", () => {
  class ExportJobCancelled extends Error {}
  return {
    ExportJobCancelled,
    cancelRunningExportJob: () => hoisted.cancelEngine(),
    runExportJob: (
      job: { id: string },
      project: unknown,
      hooks: { isCancelled: () => boolean; onProgress: (p: number, phase: string) => void },
      encoder?: string,
    ) =>
      new Promise((resolve, reject) => {
        hoisted.runs.push({
          jobId: job.id,
          project,
          resolve,
          reject,
          isCancelled: hooks.isCancelled,
          onProgress: hooks.onProgress,
          encoder,
        });
      }),
  };
});
vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return { ...actual, getExportEngine: () => ({ cancel: hoisted.cancelEngine }) };
});

import { addDialogExportToQueue, useExportQueueStore } from "./export-queue-store";

const settings = { width: 640, height: 360, frameRate: 30, format: "mp4" as const, codec: "h264" as const, bitrate: 2000 };
const makeProject = (volume = 1) => ({
  id: "p",
  name: "My Film",
  settings: { width: 640, height: 360, frameRate: 30 },
  timeline: { duration: 6, tracks: [{ id: "t", clips: [{ id: "c", volume }] }] },
  mediaLibrary: { items: [] },
});
const done = { output: { filename: "x.mp4", bytes: 10, storage: "browser" as const }, framesFromCache: 0 };
const status = () => useExportQueueStore.getState().queue.jobs.map((job) => `${job.presetLabel}:${job.status}`);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  // Let any pump still waiting on a fake run finish so module state does not leak between tests.
  useExportQueueStore.getState().pause();
  const { ExportJobCancelled } = await import("../services/export-queue/export-queue-runner");
  for (const run of hoisted.runs) run.reject(new ExportJobCancelled());
  await flush();
  await flush();
});

beforeEach(() => {
  hoisted.runs.length = 0;
  hoisted.persisted.current = null;
  hoisted.project.current = makeProject();
  useExportQueueStore.setState({ queue: { jobs: [], paused: true }, hydrated: false, panelOpen: false });
});

const audioProject = () => {
  const clip = (id: string, trackId: string, audioType?: string) => ({
    id, mediaId: `m-${id}`, trackId, startTime: 0, duration: 4, inPoint: 0, outPoint: 4, volume: 1, effects: [], audioEffects: [], keyframes: [], ...(audioType ? { audioType } : {}),
  });
  const track = (id: string, name: string, role: string, clips: unknown[]) => ({ id, name, role, type: "audio", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false });
  return {
    ...makeProject(),
    mediaLibrary: { items: ["a", "b"].map((id) => ({ id: `m-${id}`, type: "audio", metadata: { duration: 4 } })) },
    timeline: { duration: 4, tracks: [track("t1", "Voice", "dialogue", [clip("a", "t1")]), track("t2", "Bed", "music", [clip("b", "t2")])] },
  };
};

describe("stems jobs by track and audio type", () => {
  it("queues one stems job per mode, remembering the mode and the chosen sources", () => {
    hoisted.project.current = audioProject();
    const store = useExportQueueStore.getState();
    const byTrack = store.enqueueStems({ mode: "track", ids: ["t2"], bitDepth: 16 });
    expect(byTrack?.stems).toMatchObject({ mode: "track", ids: ["t2"], bitDepth: 16 });
    expect(byTrack?.presetLabel).toBe("Stems: 1 track · 16-bit WAV");
    const byType = useExportQueueStore.getState().enqueueStems({ mode: "audioType" });
    expect(byType?.stems).toMatchObject({ mode: "audioType", ids: ["dialogue", "music"], bitDepth: 24 });
    expect(byType?.presetLabel).toBe("Stems: 2 audio types · 24-bit WAV");
    expect(byType?.outputName.endsWith(".zip")).toBe(true);
  });

  it("queues nothing when no track or clip carries audio", () => {
    expect(useExportQueueStore.getState().enqueueStems({ mode: "track" })).toBeNull();
    expect(useExportQueueStore.getState().queue.jobs).toHaveLength(0);
  });
});

describe("export queue store", () => {
  it("does not run anything until started, then runs one job at a time in order", async () => {
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    store.enqueue({ settings, presetLabel: "B" });
    await flush();
    expect(hoisted.runs).toHaveLength(0);
    expect(status()).toEqual(["A:queued", "B:queued"]);

    useExportQueueStore.getState().start();
    await flush();
    expect(hoisted.runs).toHaveLength(1);
    expect(status()).toEqual(["A:running", "B:queued"]);

    hoisted.runs[0].onProgress(0.5, "rendering");
    hoisted.runs[0].resolve(done);
    await flush();
    await flush();
    expect(hoisted.runs).toHaveLength(2);
    expect(status()).toEqual(["A:completed", "B:running"]);

    hoisted.runs[1].resolve(done);
    await flush();
    await flush();
    expect(status()).toEqual(["A:completed", "B:completed"]);
  });

  it("a job added after the started queue has drained runs without another Start", async () => {
    useExportQueueStore.getState().enqueue({ settings, presetLabel: "A" });
    useExportQueueStore.getState().start();
    await flush();
    hoisted.runs[0].resolve(done);
    await flush();
    await flush();
    expect(status()).toEqual(["A:completed"]);
    expect(useExportQueueStore.getState().queue.paused).toBe(false);

    useExportQueueStore.getState().enqueue({ settings, presetLabel: "B" });
    await flush();
    expect(hoisted.runs).toHaveLength(2);
    expect(status()).toEqual(["A:completed", "B:running"]);
  });

  it("renders the project as it was when queued, not as it is when the job starts", async () => {
    const live = makeProject(1);
    hoisted.project.current = live;
    useExportQueueStore.getState().enqueue({ settings, presetLabel: "A" });
    // The action system edits the project in place.
    live.timeline.tracks[0].clips[0].volume = 0.1;
    live.timeline.tracks[0].clips.push({ id: "extra", volume: 1 });
    useExportQueueStore.getState().start();
    await flush();
    const seen = hoisted.runs[0].project as ReturnType<typeof makeProject>;
    expect(seen.timeline.tracks[0].clips).toEqual([{ id: "c", volume: 1 }]);
  });

  it("keeps editing while a job is exporting: the running job keeps its snapshot, the next queued job takes the edited project", async () => {
    const live = makeProject(1);
    hoisted.project.current = live;
    useExportQueueStore.getState().enqueue({ settings, presetLabel: "A" });
    useExportQueueStore.getState().start();
    await flush();
    expect(status()).toEqual(["A:running"]);

    // The user edits in place while A renders, then queues B.
    live.timeline.tracks[0].clips[0].volume = 0.25;
    live.timeline.tracks[0].clips.push({ id: "added", volume: 1 });
    useExportQueueStore.getState().enqueue({ settings, presetLabel: "B" });
    live.timeline.tracks[0].clips[0].volume = 0.9;
    await flush();

    // One export at a time, however many are queued.
    expect(hoisted.runs).toHaveLength(1);
    const running = hoisted.runs[0].project as ReturnType<typeof makeProject>;
    expect(running.timeline.tracks[0].clips).toEqual([{ id: "c", volume: 1 }]);

    hoisted.runs[0].resolve(done);
    await flush();
    await flush();
    expect(hoisted.runs).toHaveLength(2);
    const second = hoisted.runs[1].project as ReturnType<typeof makeProject>;
    expect(second.timeline.tracks[0].clips).toEqual([{ id: "c", volume: 0.25 }, { id: "added", volume: 1 }]);
    // The snapshot is a copy: B is unaffected by the edit made after it was queued.
    expect(second.timeline.tracks[0].clips[0].volume).toBe(0.25);
    expect(status()).toEqual(["A:completed", "B:running"]);
  });

  it("never runs two jobs at once, whatever the order of enqueue, cancel and retry", async () => {
    const store = useExportQueueStore.getState();
    for (const label of ["A", "B", "C"]) store.enqueue({ settings, presetLabel: label });
    useExportQueueStore.getState().start();
    await flush();
    const concurrent = () => useExportQueueStore.getState().queue.jobs.filter((job) => job.status === "running").length;
    expect(concurrent()).toBe(1);
    const [a, b] = useExportQueueStore.getState().queue.jobs;
    useExportQueueStore.getState().cancel(b.id);
    expect(concurrent()).toBe(1);
    useExportQueueStore.getState().cancel(a.id);
    // The cancelled encode unwinds, then the queue moves on to the next job.
    const { ExportJobCancelled } = await import("../services/export-queue/export-queue-runner");
    hoisted.runs[0].reject(new ExportJobCancelled());
    await flush();
    await flush();
    expect(concurrent()).toBe(1);
    expect(status()).toEqual(["A:cancelled", "B:cancelled", "C:running"]);
    useExportQueueStore.getState().retry(b.id);
    await flush();
    expect(concurrent()).toBe(1);
    expect(status()).toEqual(["A:cancelled", "C:running", "B:queued"]);
  });

  it("shows an ETA that stays hidden early, converges on the real remaining time (fake clock) and ends at zero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      const store = useExportQueueStore.getState();
      store.enqueue({ settings, presetLabel: "A" });
      store.start();
      await flush();
      const job = () => useExportQueueStore.getState().queue.jobs[0];
      // A 120 s export that reports every 2 s.
      const etas: Array<number | undefined> = [];
      for (let s = 2; s <= 120; s += 2) {
        vi.setSystemTime(1_000_000 + s * 1000);
        hoisted.runs[0].onProgress(s / 120, "rendering");
        etas.push(job().etaMs);
        if (s === 2) expect(job().etaMs).toBeUndefined();
        if (s === 60) expect(Math.abs(job().etaMs! - 60_000)).toBeLessThan(3_000);
        if (s === 100) expect(Math.abs(job().etaMs! - 20_000)).toBeLessThan(2_000);
      }
      expect(job().progress).toBe(1);
      expect(job().etaMs).toBe(0);
      // Progress and ETA never move the wrong way.
      hoisted.runs[0].onProgress(0.2, "rendering");
      expect(job().progress).toBe(1);
      hoisted.runs[0].resolve(done);
      await flush();
      await flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the smart-render report on a finished job", async () => {
    useExportQueueStore.getState().enqueue({ settings, presetLabel: "A" });
    useExportQueueStore.getState().start();
    await flush();
    hoisted.runs[0].resolve({ ...done, smartRender: { copiedPercent: 62, summary: "Smart render: 62% copied" } });
    await flush();
    await flush();
    expect(useExportQueueStore.getState().queue.jobs[0].smartRender?.summary).toBe("Smart render: 62% copied");
  });

  it("marks a failed job and retries it at the end of the line", async () => {
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    store.enqueue({ settings, presetLabel: "B" });
    store.start();
    await flush();
    hoisted.runs[0].reject(new Error("encoder crashed"));
    await flush();
    await flush();
    expect(status()).toEqual(["A:failed", "B:running"]);
    expect(useExportQueueStore.getState().queue.jobs[0].error).toBe("encoder crashed");

    useExportQueueStore.getState().retry(useExportQueueStore.getState().queue.jobs[0].id);
    expect(status()).toEqual(["B:running", "A:queued"]);
    hoisted.runs[1].resolve(done);
    await flush();
    await flush();
    expect(status()).toEqual(["B:completed", "A:running"]);
  });

  it("runs a job again once when the encoder fails transiently, and only then shows a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    useExportQueueStore.getState().start();
    await flush();
    expect(hoisted.runs).toHaveLength(1);
    hoisted.runs[0].reject(new DOMException("Encoding error.", "EncodingError"));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(status()).toEqual(["A:running"]);
    expect(hoisted.runs).toHaveLength(2);
    hoisted.runs[1].resolve(done);
    await flush();
    expect(status()).toEqual(["A:completed"]);
  });

  it("re-runs on the software encoder with progress and ETA reset, in the same single job row", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useExportQueueStore.getState().enqueue({ settings, presetLabel: "A" });
    useExportQueueStore.getState().start();
    await flush();
    expect(hoisted.runs[0].encoder).toBe("prefer-hardware");
    hoisted.runs[0].onProgress(0.9, "Encoding");
    expect(useExportQueueStore.getState().queue.jobs[0].progress).toBe(0.9);
    hoisted.runs[0].reject(new DOMException("Encoding error.", "EncodingError"));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(hoisted.runs).toHaveLength(2);
    expect(hoisted.runs[1].encoder).toBe("prefer-software");
    expect(useExportQueueStore.getState().queue.jobs).toHaveLength(1);
    expect(useExportQueueStore.getState().queue.jobs[0]).toMatchObject({ progress: 0, status: "running", phase: "Preparing" });
    hoisted.runs[1].onProgress(0.2, "Rendering");
    expect(useExportQueueStore.getState().queue.jobs[0].progress).toBe(0.2);
    hoisted.runs[1].resolve(done);
    await flush();
    expect(status()).toEqual(["A:completed"]);
  });

  it("does not retry an explicit Hardware choice and fails right away with a clear message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useExportQueueStore.getState().enqueue({ settings: { ...settings, encoderChoice: "hardware" }, presetLabel: "A" });
    useExportQueueStore.getState().start();
    await flush();
    hoisted.runs[0].reject(new DOMException("Encoding error.", "EncodingError"));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(hoisted.runs).toHaveLength(1);
    expect(status()).toEqual(["A:failed"]);
    expect(useExportQueueStore.getState().queue.jobs[0].error).toMatch(/hardware encoder failed.*not retried in software/i);
  });

  it("cancels a running job (the runner sees it and the engine is told) and moves on", async () => {
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    store.enqueue({ settings, presetLabel: "B" });
    store.start();
    await flush();
    const id = useExportQueueStore.getState().queue.jobs[0].id;
    useExportQueueStore.getState().cancel(id);
    expect(hoisted.cancelEngine).toHaveBeenCalled();
    expect(hoisted.runs[0].isCancelled()).toBe(true);
    const { ExportJobCancelled } = await import("../services/export-queue/export-queue-runner");
    hoisted.runs[0].reject(new ExportJobCancelled());
    await flush();
    await flush();
    expect(status()).toEqual(["A:cancelled", "B:running"]);
  });

  it("a cancelled run that unwinds after Retry does not cancel the retried job", async () => {
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    store.start();
    await flush();
    const id = useExportQueueStore.getState().queue.jobs[0].id;
    useExportQueueStore.getState().cancel(id);
    useExportQueueStore.getState().retry(id); // before the old run has unwound
    expect(status()).toEqual(["A:queued"]);
    const { ExportJobCancelled } = await import("../services/export-queue/export-queue-runner");
    hoisted.runs[0].reject(new ExportJobCancelled());
    await flush();
    await flush();
    expect(hoisted.runs).toHaveLength(2); // the retried attempt starts fresh ...
    expect(hoisted.runs[1].isCancelled()).toBe(false); // ... and is not flagged as cancelled
    expect(status()).toEqual(["A:running"]);
    hoisted.runs[1].resolve(done);
    await flush();
    await flush();
    expect(status()).toEqual(["A:completed"]);
  });

  it("ignores a late success of a run that was cancelled", async () => {
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    store.start();
    await flush();
    const id = useExportQueueStore.getState().queue.jobs[0].id;
    useExportQueueStore.getState().cancel(id);
    hoisted.runs[0].resolve(done);
    await flush();
    await flush();
    expect(status()).toEqual(["A:cancelled"]);
  });

  it("pausing stops the queue after the running job; removing and reordering only touch queued jobs", async () => {
    const store = useExportQueueStore.getState();
    store.enqueue({ settings, presetLabel: "A" });
    store.enqueue({ settings, presetLabel: "B" });
    store.enqueue({ settings, presetLabel: "C" });
    store.start();
    await flush();
    useExportQueueStore.getState().pause();
    const [a, , c] = useExportQueueStore.getState().queue.jobs;
    useExportQueueStore.getState().move(c.id, 0);
    expect(status()).toEqual(["A:running", "C:queued", "B:queued"]);
    useExportQueueStore.getState().remove(a.id); // running: refused
    expect(status()).toHaveLength(3);
    hoisted.runs[0].resolve(done);
    await flush();
    await flush();
    expect(hoisted.runs).toHaveLength(1); // paused: nothing new starts
    expect(status()).toEqual(["A:completed", "C:queued", "B:queued"]);
  });

  it("restores a persisted queue with the running job interrupted and the queue paused", async () => {
    hoisted.persisted.current = {
      paused: false,
      jobs: [
        { id: "j1", status: "running", progress: 0.4, presetLabel: "A", outputName: "a.mp4", settings, usePreviews: true, elapsedMs: 5, attempts: 1, createdAt: 1, sequenceName: "s", phase: "x" },
        { id: "j2", status: "queued", progress: 0, presetLabel: "B", outputName: "b.mp4", settings, usePreviews: true, elapsedMs: 0, attempts: 0, createdAt: 2, sequenceName: "s", phase: "Queued" },
      ],
    };
    await useExportQueueStore.getState().hydrate();
    expect(status()).toEqual(["A:interrupted", "B:queued"]);
    expect(useExportQueueStore.getState().queue.paused).toBe(true);
    useExportQueueStore.getState().retry("j1");
    expect(status()).toEqual(["B:queued", "A:queued"]);
  });

  it("refuses to queue an empty timeline and gives unique output names", () => {
    hoisted.project.current = { ...makeProject(), timeline: { duration: 0, tracks: [] } };
    expect(useExportQueueStore.getState().enqueue({ settings })).toBeNull();
    hoisted.project.current = makeProject();
    const first = addDialogExportToQueue({ ...settings, audioSettings: undefined } as never, { presetLabel: "1080p", usePreviews: true });
    const second = addDialogExportToQueue({ ...settings } as never, { presetLabel: "1080p", usePreviews: true });
    expect(first?.outputName).toBe("My Film - 1080p.mp4");
    expect(second?.outputName).toBe("My Film - 1080p (2).mp4");
    expect(useExportQueueStore.getState().panelOpen).toBe(true);
  });

  it("renders the chosen sequence, not the active one, when a sequence id is given", async () => {
    const seq = (id: string, name: string, duration: number, clipId: string) => ({
      id, name, settings: { width: 640, height: 360, frameRate: 30 },
      timeline: { duration, tracks: [{ id: `t-${id}`, clips: [{ id: clipId, volume: 1 }] }] },
      createdAt: 0, modifiedAt: 0,
    });
    const a = seq("seqA", "Main", 6, "ca");
    const b = seq("seqB", "Alt cut", 4, "cb");
    hoisted.project.current = {
      ...makeProject(), timeline: a.timeline, activeSequenceId: "seqA", openSequenceIds: ["seqA"], sequences: [a, b],
    };
    const job = useExportQueueStore.getState().enqueue({ settings, presetLabel: "A", sequenceId: "seqB" });
    expect(job?.sequenceName).toBe("Alt cut");
    expect(job?.outputName).toBe("My Film - Alt cut - A.mp4");
    useExportQueueStore.getState().start();
    await flush();
    const seen = hoisted.runs[0].project as { timeline: { tracks: Array<{ clips: Array<{ id: string }> }> }; activeSequenceId: string };
    expect(seen.activeSequenceId).toBe("seqB");
    expect(seen.timeline.tracks[0].clips[0].id).toBe("cb");
    expect(useExportQueueStore.getState().enqueue({ settings, sequenceId: "gone" })).toBeNull();
  });
});
