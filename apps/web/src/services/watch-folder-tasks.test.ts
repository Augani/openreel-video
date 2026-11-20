import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import type { OpenReelWatchFolderConfig, OpenReelWatchFoldersSnapshot, OpenReelWatchItem } from "../types/global";
import { MAX_FINISHED_WATCH_TASKS, startWatchFolderTasks, syncWatchFolderTasks } from "./watch-folder-tasks";

const ingest: OpenReelWatchFolderConfig = { id: "f1", kind: "ingest", path: "/Volumes/Card/DCIM", paused: false, bin: "Cards", createProxies: false, presetId: "1080p-high", outputDir: "", includeProjects: false, baselined: true, processExisting: false };
const exportFolder: OpenReelWatchFolderConfig = { ...ingest, id: "f2", kind: "export", path: "/Users/me/Hot", outputDir: "/Users/me/Hot/output" };
const status = { state: "watching" as const, detecting: 0, queued: 0, running: 0, done: 0, failed: 0, duplicates: 0 };
const item = (extra: Partial<OpenReelWatchItem>): OpenReelWatchItem => ({ id: "i1", folderId: "f1", name: "a.mp4", path: "/Volumes/Card/DCIM/a.mp4", state: "queued", progress: null, createdAt: 1, ...extra });
const snapshot = (items: OpenReelWatchItem[], folders = [ingest, exportFolder]): OpenReelWatchFoldersSnapshot => ({ folders: folders.map((config) => ({ config, status })), items });
const tasks = () => backgroundTasks.getSnapshot().filter((task) => task.source === "watch-folders");

afterEach(() => {
  backgroundTasks.syncSource("watch-folders", []);
  Reflect.deleteProperty(window, "openreel");
});

describe("watch folder tasks", () => {
  it("shows ingest items as imports and export items as exports, with their state", () => {
    syncWatchFolderTasks(snapshot([item({ id: "a", state: "running", progress: 0.4 }), item({ id: "b", folderId: "f2", name: "b.mov", state: "done", outputPath: "/o/b.mp4", detail: "Rendered to b.mp4" })]), vi.fn());
    const [running, done] = tasks();
    expect(running).toMatchObject({ kind: "import", status: "running", progress: 0.4, title: "Watch folder · Import a.mp4" });
    expect(done).toMatchObject({ kind: "export", status: "completed", progress: 1, title: "Watch folder · Render b.mov", detail: "Rendered to b.mp4" });
  });

  it("explains a file that is still copying and a paused folder", () => {
    syncWatchFolderTasks(snapshot([item({ id: "a", state: "detecting" })]), vi.fn());
    expect(tasks()[0].detail).toBe("Waiting for the file to finish copying");
    syncWatchFolderTasks(snapshot([item({ id: "a", state: "queued" })], [{ ...ingest, paused: true }]), vi.fn());
    expect(tasks()[0].detail).toBe('Folder "DCIM" is paused');
  });

  it("offers Retry on a failed item and forwards it", () => {
    const retry = vi.fn();
    syncWatchFolderTasks(snapshot([item({ id: "bad", state: "failed", error: "Could not decode" })]), retry);
    const [failed] = tasks();
    expect(failed).toMatchObject({ status: "failed", error: "Could not decode" });
    expect(failed.can.retry).toBe(true);
    backgroundTasks.retry(failed.id);
    expect(retry).toHaveBeenCalledWith("bad");
  });

  it("keeps every active item but only the newest finished ones, and drops items that left the list", () => {
    const finished = Array.from({ length: MAX_FINISHED_WATCH_TASKS + 5 }, (_, n) => item({ id: `d${n}`, state: "done" }));
    syncWatchFolderTasks(snapshot([item({ id: "run", state: "running" }), ...finished]), vi.fn());
    expect(tasks()).toHaveLength(1 + MAX_FINISHED_WATCH_TASKS);
    syncWatchFolderTasks(snapshot([]), vi.fn());
    expect(tasks()).toHaveLength(0);
  });

  it("mirrors the bridge, and clears its tasks when stopped", async () => {
    let push: (s: OpenReelWatchFoldersSnapshot) => void = () => undefined;
    const off = vi.fn();
    Object.defineProperty(window, "openreel", {
      configurable: true,
      value: { platform: "desktop", watchFolders: { list: vi.fn().mockResolvedValue(snapshot([item({ id: "x", state: "running" })])), onChange: (cb: typeof push) => ((push = cb), off), retry: vi.fn() } },
    });
    const stop = startWatchFolderTasks();
    await vi.waitFor(() => expect(tasks()).toHaveLength(1));
    push(snapshot([item({ id: "x", state: "done" }), item({ id: "y", state: "running" })]));
    expect(tasks().map((t) => t.status).sort()).toEqual(["completed", "running"]);
    stop();
    expect(off).toHaveBeenCalled();
    expect(tasks()).toHaveLength(0);
  });
});
