import { describe, expect, it, vi } from "vitest";
import { BackgroundTaskRegistry, formatTaskEta, summarizeTasks } from "./task-registry";

const base = { kind: "export" as const, source: "s", title: "T" };

describe("BackgroundTaskRegistry", () => {
  it("orders running before queued before finished and exposes capabilities", () => {
    const r = new BackgroundTaskRegistry(() => 100);
    r.upsert({ ...base, id: "done", status: "completed", finishedAt: 5 });
    r.upsert({ ...base, id: "q", status: "queued" }, { cancel: vi.fn() });
    r.upsert({ ...base, id: "run", status: "running", progress: 0.5 }, { cancel: vi.fn(), pause: vi.fn() });
    r.upsert({ ...base, id: "bad", status: "failed", error: "x" }, { retry: vi.fn() });
    const list = r.getSnapshot();
    expect(list.map((t) => t.id)).toEqual(["run", "q", "bad", "done"]);
    expect(list[0].can).toMatchObject({ cancel: true, pause: true, retry: false });
    expect(list[2].can).toMatchObject({ retry: true, cancel: false });
    expect(r.getSnapshot()).toBe(list);
  });

  it("clamps progress, keeps indeterminate as null and notifies subscribers", () => {
    const r = new BackgroundTaskRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    r.upsert({ ...base, id: "a", status: "running", progress: 4 });
    r.upsert({ ...base, id: "b", status: "running" });
    expect(r.get("a")?.progress).toBe(1);
    expect(r.get("b")?.progress).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("syncSource replaces only its own tasks and stays quiet when nothing changed", () => {
    const r = new BackgroundTaskRegistry();
    r.upsert({ ...base, id: "other", source: "o", status: "running" });
    const task = { ...base, id: "j1", status: "running" as const, progress: 0.2 };
    r.syncSource("s", [{ task }]);
    const listener = vi.fn();
    r.subscribe(listener);
    r.syncSource("s", [{ task }]);
    expect(listener).not.toHaveBeenCalled();
    r.syncSource("s", []);
    expect(r.get("j1")).toBeUndefined();
    expect(r.get("other")).toBeDefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forwards cancel / pause / resume / retry to the owning system", () => {
    const r = new BackgroundTaskRegistry();
    const c = { cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), retry: vi.fn() };
    r.upsert({ ...base, id: "a", status: "running" }, c);
    r.cancel("a"); r.pause("a"); r.resume("a"); r.retry("a");
    expect(c.cancel).toHaveBeenCalled();
    expect(c.pause).toHaveBeenCalled();
    expect(c.resume).toHaveBeenCalled();
    expect(c.retry).toHaveBeenCalled();
    expect(() => r.cancel("missing")).not.toThrow();
  });

  it("offers pause on queued tasks and resume on paused ones", () => {
    const r = new BackgroundTaskRegistry();
    const c = { pause: vi.fn(), resume: vi.fn() };
    r.upsert({ ...base, id: "q", status: "queued" }, c);
    expect(r.getSnapshot()[0].can).toMatchObject({ pause: true, resume: false });
    r.upsert({ ...base, id: "q", status: "paused" }, c);
    expect(r.getSnapshot()[0].can).toMatchObject({ pause: false, resume: true });
    r.resume("q");
    expect(c.resume).toHaveBeenCalled();
  });

  it("track completes, fails and cancels", async () => {
    const r = new BackgroundTaskRegistry();
    await expect(r.track({ id: "ok", kind: "analysis", title: "A" }, async (ctx) => { ctx.progress(0.5, "half"); expect(r.get("ok")?.progress).toBe(0.5); return 7; })).resolves.toBe(7);
    expect(r.get("ok")).toMatchObject({ status: "completed", progress: 1, detail: "half" });

    await expect(r.track({ id: "bad", kind: "import", title: "I", retry: () => undefined }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(r.get("bad")).toMatchObject({ status: "failed", error: "boom" });
    expect(r.getSnapshot().find((t) => t.id === "bad")?.can.retry).toBe(true);

    const run = r.track({ id: "c", kind: "tracking", title: "K" }, (ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError")))));
    r.cancel("c");
    await expect(run).rejects.toThrow();
    expect(r.get("c")?.status).toBe("cancelled");
  });

  it("ignores late progress after cancel and trims finished history", () => {
    const r = new BackgroundTaskRegistry();
    for (let i = 0; i < 60; i++) r.upsert({ ...base, id: `f${i}`, status: "completed", finishedAt: i });
    expect(r.getSnapshot().length).toBe(40);
    expect(r.get("f59")).toBeDefined();
    expect(r.get("f0")).toBeUndefined();
    r.clearFinished();
    expect(r.getSnapshot()).toHaveLength(0);
  });

  it("summarizes and formats", () => {
    const r = new BackgroundTaskRegistry();
    r.upsert({ ...base, id: "a", status: "running", progress: 0.5 });
    r.upsert({ ...base, id: "b", status: "running", progress: 0.25 });
    r.upsert({ ...base, id: "c", status: "queued" });
    const s = summarizeTasks(r.getSnapshot());
    expect(s).toMatchObject({ active: 3, running: 2, queued: 1, progress: 0.375 });
    expect(s.label).toBe("3 background tasks · 38%");
    expect(summarizeTasks([]).label).toBe("No background tasks");
    expect(formatTaskEta(80000)).toBe("1m 20s");
    expect(formatTaskEta(undefined)).toBe("");
  });

  it("keeps cleared mirrored tasks cleared across later source syncs, until the id runs again", () => {
    const r = new BackgroundTaskRegistry(() => 1);
    const item = (id: string, status: "running" | "completed") => ({ task: { id, kind: "export" as const, source: "q", title: id, status } });
    r.syncSource("q", [item("a", "completed"), item("b", "completed")]);
    expect(r.getSnapshot()).toHaveLength(2);
    r.clearFinished();
    expect(r.getSnapshot()).toHaveLength(0);
    r.syncSource("q", [item("a", "completed"), item("b", "completed"), item("c", "running")]);
    expect(r.getSnapshot().map((t) => t.id)).toEqual(["c"]);
    // A retry runs the same id again: it shows, and finishes visibly.
    r.syncSource("q", [item("a", "running"), item("c", "running")]);
    expect(r.getSnapshot().map((t) => t.id).sort()).toEqual(["a", "c"]);
    r.syncSource("q", [item("a", "completed"), item("c", "running")]);
    expect(r.getSnapshot().find((t) => t.id === "a")?.status).toBe("completed");
  });

  it("does not resurrect mirrored tasks dropped by the finished-history prune", () => {
    const r = new BackgroundTaskRegistry(() => 1);
    let t = 0;
    const done = Array.from({ length: 45 }, (_, i) => ({ task: { id: `j${i}`, kind: "export" as const, source: "q", title: `j${i}`, status: "completed" as const, finishedAt: ++t } }));
    r.syncSource("q", done);
    expect(r.getSnapshot()).toHaveLength(40);
    r.syncSource("q", done);
    expect(r.getSnapshot()).toHaveLength(40);
  });
});
