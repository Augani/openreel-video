import { describe, expect, it, vi } from "vitest";
import {
  ProxyQueue,
  clampConcurrency,
  jobIdFor,
  type ProxyJob,
  type ProxyJobInput,
  type ProxyJobResult,
  type ProxyQueueEvent,
  type ProxyQueueStore,
} from "../src/main/ingest/proxy-queue";

const input = (mediaId: string, projectKey = "p1"): ProxyJobInput => ({
  projectKey,
  mediaId,
  srcPath: `/src/${mediaId}.mov`,
  outDir: "/proj/Proxies",
  fileName: `${mediaId}_half_proxy.mov`,
  profile: { codec: "prores-proxy", size: "half" },
  previewTwin: false,
});
const result = (job: ProxyJob): ProxyJobResult => ({ outPath: `${job.outDir}/${job.fileName}`, width: 1920, height: 1080, duration: 5, frameRate: 30, codec: "prores", fileSize: 10 });

function memoryStore(initial: ProxyJob[] = []): ProxyQueueStore & { saved: ProxyJob[] } {
  const store = {
    saved: initial,
    load: () => store.saved.map((job) => ({ ...job })),
    save: (jobs: readonly ProxyJob[]) => {
      store.saved = jobs.map((job) => ({ ...job }));
    },
  };
  return store;
}

/** A runner whose jobs finish only when the test says so. */
function controlledRunner() {
  const running = new Map<string, { resolve: () => void; reject: (e: Error) => void; progress: (n: number) => void; signal: AbortSignal; job: ProxyJob }>();
  const order: string[] = [];
  const run = (job: ProxyJob, onProgress: (n: number) => void, signal: AbortSignal) =>
    new Promise<ProxyJobResult>((resolve, reject) => {
      order.push(job.mediaId);
      const entry = { resolve: () => resolve(result(job)), reject, progress: onProgress, signal, job };
      running.set(job.mediaId, entry);
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }).finally(() => running.delete(job.mediaId));
  return { run, running, order };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ProxyQueue", () => {
  it("clamps concurrency to 1..2", () => {
    expect([clampConcurrency(0), clampConcurrency(1), clampConcurrency(2), clampConcurrency(9)]).toEqual([1, 1, 2, 2]);
  });

  it("runs one job at a time by default and the next starts when the first finishes", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.enqueue([input("a"), input("b"), input("c")]);
    await tick();
    expect([...r.running.keys()]).toEqual(["a"]);
    r.running.get("a")!.resolve();
    await tick();
    expect([...r.running.keys()]).toEqual(["b"]);
    r.running.get("b")!.resolve();
    await tick();
    r.running.get("c")!.resolve();
    await q.whenIdle();
    expect(q.list().map((j) => j.status)).toEqual(["done", "done", "done"]);
    expect(r.order).toEqual(["a", "b", "c"]);
  });

  it("runs two at once with concurrency 2 and never more", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore(), concurrency: 2 });
    q.enqueue([input("a"), input("b"), input("c")]);
    await tick();
    expect([...r.running.keys()].sort()).toEqual(["a", "b"]);
    q.setConcurrency(1);
    r.running.get("a")!.resolve();
    await tick();
    // b still runs; c waits because the limit dropped to 1.
    expect([...r.running.keys()]).toEqual(["b"]);
  });

  it("reports progress, throttled, and clamps it to 0..1", async () => {
    const r = controlledRunner();
    const events: ProxyQueueEvent[] = [];
    let clock = 0;
    const q = new ProxyQueue({ run: r.run, store: memoryStore(), emit: (e) => events.push(e), now: () => clock, progressIntervalMs: 250 });
    q.enqueue([input("a")]);
    await tick();
    const progressOf = () => events.filter((e) => e.type === "update").map((e) => (e as { job: ProxyJob }).job.progress);
    clock = 1000;
    r.running.get("a")!.progress(0.2);
    clock = 1100;
    r.running.get("a")!.progress(0.3); // inside the throttle window: not emitted
    clock = 1400;
    r.running.get("a")!.progress(0.5);
    r.running.get("a")!.progress(7);
    expect(progressOf()).toContain(0.2);
    expect(progressOf()).not.toContain(0.3);
    expect(progressOf()).toContain(0.5);
    expect(progressOf().at(-1)).toBe(1);
    expect(q.list()[0].progress).toBe(1);
  });

  it("cancels a running job (it vanishes, ffmpeg is aborted) and starts the next", async () => {
    const r = controlledRunner();
    const events: ProxyQueueEvent[] = [];
    const store = memoryStore();
    const q = new ProxyQueue({ run: r.run, store, emit: (e) => events.push(e) });
    q.enqueue([input("a"), input("b")]);
    await tick();
    const signal = r.running.get("a")!.signal;
    q.cancel([jobIdFor("p1", "a")]);
    await tick();
    expect(signal.aborted).toBe(true);
    expect(q.list().map((j) => j.mediaId)).toEqual(["b"]);
    expect(events.some((e) => e.type === "removed" && e.id === "p1:a")).toBe(true);
    expect([...r.running.keys()]).toEqual(["b"]);
    expect(store.saved.map((j) => j.mediaId)).toEqual(["b"]);
  });

  it("cancels a queued job without ever running it", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.enqueue([input("a"), input("b")]);
    await tick();
    q.cancel(["p1:b"]);
    r.running.get("a")!.resolve();
    await q.whenIdle();
    expect(r.order).toEqual(["a"]);
  });

  it("marks a failed job, retries only failed jobs of that project, and keeps others", async () => {
    let fail = true;
    const run = vi.fn(async (job: ProxyJob) => {
      if (fail) throw new Error("boom");
      return result(job);
    });
    const q = new ProxyQueue({ run, store: memoryStore() });
    q.enqueue([input("a"), input("b"), input("x", "other")]);
    await q.whenIdle();
    expect(q.list().every((j) => j.status === "failed" && j.error === "boom")).toBe(true);
    fail = false;
    const retried = q.retryFailed("p1");
    expect(retried.map((j) => j.mediaId)).toEqual(["a", "b"]);
    await q.whenIdle();
    expect(q.list("p1").map((j) => j.status)).toEqual(["done", "done"]);
    expect(q.list("other")[0].status).toBe("failed");
    expect(q.list("p1")[0].attempts).toBe(2);
  });

  it("does not duplicate a queued or running job unless forced, and force restarts it", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.enqueue([input("a")]);
    await tick();
    q.enqueue([input("a")]);
    expect(q.list()).toHaveLength(1);
    const firstSignal = r.running.get("a")!.signal;
    q.enqueue([{ ...input("a"), profile: { codec: "h264", size: "quarter" } }], { force: true });
    await tick();
    expect(firstSignal.aborted).toBe(true);
    expect(r.running.get("a")!.job.profile).toEqual({ codec: "h264", size: "quarter" });
    expect(q.list()).toHaveLength(1);
  });

  it("keeps a finished job until it is acknowledged", async () => {
    const q = new ProxyQueue({ run: async (job) => result(job), store: memoryStore() });
    q.enqueue([input("a")]);
    await q.whenIdle();
    expect(q.list("p1")[0].status).toBe("done");
    expect(q.list("p1")[0].result?.width).toBe(1920);
    q.acknowledge(["p1:a"]);
    expect(q.list("p1")).toEqual([]);
  });

  it("resumes after a restart: running jobs go back to queued, finished ones stay, all run again", async () => {
    const r1 = controlledRunner();
    const store = memoryStore();
    const first = new ProxyQueue({ run: r1.run, store });
    first.enqueue([input("a"), input("b"), input("c")]);
    await tick();
    r1.running.get("a")!.progress(0.4);
    r1.running.get("a")!.resolve();
    await tick();
    // "b" is now running; the app quits.
    first.shutdown();
    await tick();
    expect(store.saved.map((j) => [j.mediaId, j.status])).toEqual([["a", "done"], ["b", "queued"], ["c", "queued"]]);

    const r2 = controlledRunner();
    const second = new ProxyQueue({ run: r2.run, store });
    second.restore();
    await tick();
    expect(r2.order).toEqual(["b"]);
    r2.running.get("b")!.resolve();
    await tick();
    r2.running.get("c")!.resolve();
    await second.whenIdle();
    expect(second.list().map((j) => [j.mediaId, j.status])).toEqual([["a", "done"], ["b", "done"], ["c", "done"]]);
  });

  it("never starts work after shutdown", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.shutdown();
    q.enqueue([input("a")]);
    await tick();
    expect(r.order).toEqual([]);
  });
});
