import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProxyQueue, jobIdFor, kindOfJob, type CopyJobResult, type ProxyJob, type ProxyJobInput, type ProxyJobResult, type ProxyQueueStore } from "../src/main/ingest/proxy-queue";
import { copyJobFollowUpInput } from "../src/main/ingest/follow-up";

const proxyInput = (mediaId: string): ProxyJobInput => ({ projectKey: "p1", mediaId, name: `${mediaId}.mov`, srcPath: `/src/${mediaId}.mov`, outDir: "/proj/Proxies", fileName: `${mediaId}_half_proxy.mov`, profile: { codec: "prores-proxy", size: "half" }, previewTwin: false });
const copyInput = (mediaId: string, followUp = false): ProxyJobInput => ({
  kind: "copy",
  projectKey: "p1",
  mediaId,
  name: `${mediaId}.mov`,
  srcPath: `/src/${mediaId}.mov`,
  outDir: "/proj/Media",
  fileName: `${mediaId}.mov`,
  profile: { codec: "h264", size: "half" },
  previewTwin: false,
  copy: { algorithm: "md5", ...(followUp ? { followUp: { profile: { codec: "prores-lt", size: "half", destination: { mode: "media" } }, previewTwin: true, proxyDir: "/proj/Proxies" } } : {}) },
});
const proxyResult = (job: ProxyJob): ProxyJobResult => ({ outPath: `${job.outDir}/${job.fileName}`, width: 1920, height: 1080, duration: 5, frameRate: 30, codec: "prores", fileSize: 10 });
const copyResult = (job: ProxyJob): CopyJobResult => ({ destPath: `${job.outDir}/${job.fileName}`, size: 10, checksum: { algorithm: "md5", value: "abc" }, reused: false });

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

function controlledRunner() {
  const running = new Map<string, { finish: () => void; signal: AbortSignal; job: ProxyJob }>();
  const started: string[] = [];
  const run = (job: ProxyJob, _p: (n: number) => void, signal: AbortSignal) =>
    new Promise<ProxyJobResult | CopyJobResult>((resolve, reject) => {
      started.push(job.id);
      running.set(job.id, { finish: () => resolve(kindOfJob(job) === "copy" ? copyResult(job) : proxyResult(job)), signal, job });
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }).finally(() => running.delete(job.id));
  return { run, running, started };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("copy jobs in the ingest queue", () => {
  it("gives copy and proxy jobs for the same media different ids", () => {
    expect(jobIdFor("p1", "m1")).toBe("p1:m1");
    expect(jobIdFor("p1", "m1", "copy")).toBe("p1:copy:m1");
    const q = new ProxyQueue({ run: controlledRunner().run, store: memoryStore() });
    q.enqueue([proxyInput("m1"), copyInput("m1")]);
    expect(q.list().map((job) => job.id).sort()).toEqual(["p1:copy:m1", "p1:m1"]);
  });
  it("runs one copy at a time, beside the proxy slot, so a long copy never blocks proxy builds", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.enqueue([copyInput("a"), copyInput("b"), proxyInput("c"), proxyInput("d")]);
    await tick();
    expect([...r.running.keys()].sort()).toEqual(["p1:c", "p1:copy:a"]);
    r.running.get("p1:copy:a")!.finish();
    await tick();
    expect([...r.running.keys()].sort()).toEqual(["p1:c", "p1:copy:b"]);
  });
  it("stores the copy result on the finished job and keeps it until acknowledged", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.enqueue([copyInput("a")]);
    await tick();
    r.running.get("p1:copy:a")!.finish();
    await tick();
    const [job] = q.list("p1");
    expect(job.status).toBe("done");
    expect(job.copyResult?.checksum).toEqual({ algorithm: "md5", value: "abc" });
    expect(job.result).toBeUndefined();
    q.acknowledge(["p1:copy:a"]);
    expect(q.list()).toEqual([]);
  });
  it("is cancellable while running or queued, and aborts the copy", async () => {
    const r = controlledRunner();
    const q = new ProxyQueue({ run: r.run, store: memoryStore() });
    q.enqueue([copyInput("a"), copyInput("b")]);
    await tick();
    const signal = r.running.get("p1:copy:a")!.signal;
    q.cancel(["p1:copy:a", "p1:copy:b"]);
    await tick();
    expect(signal.aborted).toBe(true);
    expect(q.list()).toEqual([]);
    expect(r.started).toEqual(["p1:copy:a"]);
  });
  it("resumes after a restart: a copy that was running is queued again and runs from the start; the follow-up is kept", async () => {
    const first = controlledRunner();
    const store = memoryStore();
    const q1 = new ProxyQueue({ run: first.run, store });
    q1.enqueue([copyInput("a", true), copyInput("b"), proxyInput("c")]);
    await tick();
    expect(first.running.has("p1:copy:a")).toBe(true);
    // The app quits: nothing is lost, running jobs go back to queued on disk.
    q1.shutdown();
    expect(store.saved.map((job) => [job.id, job.status])).toEqual([["p1:copy:a", "queued"], ["p1:copy:b", "queued"], ["p1:c", "queued"]]);
    const second = controlledRunner();
    const q2 = new ProxyQueue({ run: second.run, store });
    q2.restore();
    await tick();
    expect(second.started).toEqual(["p1:copy:a", "p1:c"]);
    expect(q2.list().find((job) => job.id === "p1:copy:a")?.copy?.followUp?.profile.codec).toBe("prores-lt");
    second.running.get("p1:copy:a")!.finish();
    await tick();
    expect(second.started).toContain("p1:copy:b");
  });
  it("loads jobs saved before copy jobs existed as proxy jobs", () => {
    const legacy = { ...proxyInput("old"), id: "p1:old", status: "queued", progress: 0, attempts: 0, enqueuedAt: 1 } as ProxyJob;
    const q = new ProxyQueue({ run: controlledRunner().run, store: memoryStore([legacy]) });
    q.restore();
    expect(kindOfJob(q.list()[0])).toBe("proxy");
  });
  it("tells the owner when a job is done, so a follow-up proxy can be queued", async () => {
    const r = controlledRunner();
    const done: string[] = [];
    const q: ProxyQueue = new ProxyQueue({
      run: r.run,
      store: memoryStore(),
      onDone: (job) => {
        done.push(job.id);
        const next = copyJobFollowUpInput(job);
        if (next) q.enqueue([next], { force: true });
      },
    });
    q.enqueue([copyInput("a", true)]);
    await tick();
    r.running.get("p1:copy:a")!.finish();
    await tick();
    expect(done).toEqual(["p1:copy:a"]);
    // The proxy is built from the verified copy and written beside the media, as the preset says.
    const proxy = q.list().find((job) => job.id === "p1:a");
    expect(proxy?.srcPath).toBe("/proj/Media/a.mov");
    expect(proxy?.outDir).toBe(path.resolve("/proj/Media/Proxies"));
    expect(proxy?.profile.codec).toBe("prores-lt");
    expect(proxy?.previewTwin).toBe(true);
    expect(proxy?.fileName).toMatch(/_half-lt_proxy\.mov$/);
  });
  it("has no follow-up for a plain copy, a failed copy or a proxy job", () => {
    const base = { projectKey: "p1", mediaId: "a", name: "a.mov" };
    expect(copyJobFollowUpInput({ ...base, kind: "copy", status: "done", copy: { algorithm: "md5" }, copyResult: copyResult({ outDir: "/m", fileName: "a.mov" } as ProxyJob) })).toBeNull();
    expect(copyJobFollowUpInput({ ...base, kind: "copy", status: "failed", copy: { algorithm: "md5", followUp: { profile: { codec: "h264", size: "half" }, previewTwin: false, proxyDir: "/p" } } })).toBeNull();
    expect(copyJobFollowUpInput({ ...base, kind: "proxy", status: "done" })).toBeNull();
  });
});
