import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import {
  AutoSaveManager,
  serializeProjectForAutoSave,
} from "./auto-save";
import { createEmptyProject } from "../stores/project/project-helpers";
import { cacheProjectPreview } from "./project-preview-cache";

const project = (name: string): Project => ({
  ...createEmptyProject(name),
  id: "project-1",
});

describe("AutoSaveManager", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("saves a real composed thumbnail without changing the authoring snapshot", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager();
    const saveRecord = vi.fn().mockResolvedValue(undefined);
    const internals = manager as unknown as {db: unknown; saveRecord: typeof saveRecord};
    internals.db = {}; internals.saveRecord = saveRecord;
    const latest = {...project("Preview"), id: "preview-project", modifiedAt: 9876};
    const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = 1080;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,composed");
    cacheProjectPreview(latest, 41, canvas);
    vi.runAllTimers();
    await manager.forceSave(latest);
    expect(saveRecord.mock.calls[0][0].preview).toEqual({duration: 41, modifiedAt: 9876, thumbnailUrl: "data:image/jpeg;base64,composed"});
    expect(JSON.parse(saveRecord.mock.calls[0][0].data)).toEqual(JSON.parse(serializeProjectForAutoSave(latest)));
    await manager.forceSave({...latest, modifiedAt: 9877});
    expect(saveRecord.mock.calls[1][0].preview).not.toHaveProperty("thumbnailUrl");
  });

  it("returns optional preview metadata and keeps legacy snapshots readable without parsing project data", async () => {
    const manager = new AutoSaveManager();
    const preview = {duration: 41, modifiedAt: 3, thumbnailUrl: "data:image/jpeg;base64,frame"};
    const internals = manager as unknown as {db: unknown; getAllSaves: () => Promise<unknown[]>};
    internals.db = {};
    internals.getAllSaves = async () => [
      {id: "old", projectId: "legacy", projectName: "Legacy", timestamp: 1, slot: 0, data: "not parsed for the list"},
      {id: "new", projectId: "current", projectName: "Current", timestamp: 2, slot: 0, data: "not parsed for the list", preview},
    ];
    const records = await manager.checkForRecovery();
    expect(records[0]).toEqual({id: "new", projectId: "current", projectName: "Current", timestamp: 2, slot: 0, isRecovery: true, preview});
    expect(records[1]).not.toHaveProperty("preview");
  });

  it("reopens a closing database before starting the next transaction", async () => {
    const manager = new AutoSaveManager();
    const tx = {} as IDBTransaction;
    const closed = { transaction: vi.fn(() => { throw new DOMException("The database connection is closing", "InvalidStateError"); }) };
    const reopened = { transaction: vi.fn(() => tx) };
    const internals = manager as unknown as { db: unknown; createTransaction(mode: "readonly" | "readwrite"): Promise<IDBTransaction> };
    internals.db = closed;
    const initialize = vi.spyOn(manager, "initialize").mockImplementation(async () => { if (!internals.db) internals.db = reopened; });
    expect(await internals.createTransaction("readwrite")).toBe(tx);
    expect(closed.transaction).toHaveBeenCalledOnce();
    expect(reopened.transaction).toHaveBeenCalledOnce();
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("clears a project's saves from a keys-only index scan without reading records", async () => {
    const manager = new AutoSaveManager();
    const deleted: string[] = [];
    const getAll = vi.fn();
    const keysRequest: { result: string[]; onsuccess?: () => void } = { result: ["p-slot-0", "p-slot-1"] };
    const tx: { oncomplete?: () => void } = {};
    const store = {
      getAll,
      delete: (id: string) => { deleted.push(id); },
      index: vi.fn(() => ({ getAllKeys: vi.fn(() => { queueMicrotask(() => { keysRequest.onsuccess?.(); tx.oncomplete?.(); }); return keysRequest; }) })),
    };
    Object.assign(tx, { objectStore: () => store });
    const internals = manager as unknown as { db: unknown; createTransaction: () => Promise<unknown> };
    internals.db = {};
    internals.createTransaction = async () => tx;
    await manager.clearProjectSaves("p");
    expect(deleted).toEqual(["p-slot-0", "p-slot-1"]);
    expect(store.index).toHaveBeenCalledWith("projectId");
    expect(getAll).not.toHaveBeenCalled();
  });

  it("does not reconnect or retry quota errors", async () => {
    const manager = new AutoSaveManager();
    const internals = manager as unknown as { db: unknown; createTransaction(mode: "readonly" | "readwrite"): Promise<IDBTransaction> };
    internals.db = { transaction: vi.fn(() => { throw new DOMException("Storage full", "QuotaExceededError"); }) };
    const initialize = vi.spyOn(manager, "initialize").mockResolvedValue();
    await expect(internals.createTransaction("readwrite")).rejects.toThrow("Storage full");
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("saves the snapshot supplied with the dirty notification", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ debounceTime: 10, interval: 30_000 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;

    manager.start(() => project("Initial"));
    manager.markDirty(project("Latest text edit"));
    await vi.advanceTimersByTimeAsync(10);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Latest text edit" }),
      expect.any(String),
    );
    manager.stop();
  });

  it("saves content changes even when timestamps and item counts are identical", async () => {
    const manager = new AutoSaveManager();
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const initial = project("Initial");

    await manager.forceSave(initial);
    await manager.forceSave({ ...initial, name: "Renamed" });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].name).toBe("Renamed");
  });

  it("settles the save indicator when a dirty notification contains already persisted content", async () => {
    const manager = new AutoSaveManager();
    const saveRecord = vi.fn().mockResolvedValue(undefined);
    const internals = manager as unknown as { db: unknown; saveRecord: typeof saveRecord };
    internals.db = {}; internals.saveRecord = saveRecord;
    const latest = project("Persisted project");
    await manager.forceSave(latest);
    const saved = vi.fn();
    manager.on("saved", saved);
    manager.markDirty({ ...latest });
    await manager.forceSave({ ...latest });
    expect(saveRecord).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith({ projectId: latest.id, unchanged: true });
    expect(manager.hasUnsavedChanges(latest)).toBe(false);
  });

  it("serializes concurrent saves and retains edits arriving during a write", async () => {
    const manager = new AutoSaveManager();
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const first = project("First edit");
    const latest = { ...first, name: "Edit made during save" };

    const savingFirst = manager.forceSave(first);
    const savingLatest = manager.forceSave(latest);
    expect(save).toHaveBeenCalledTimes(1);
    expect(manager.hasUnsavedChanges(latest)).toBe(true);
    finishFirst();
    await Promise.all([savingFirst, savingLatest]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(latest);
    expect(manager.hasUnsavedChanges(latest)).toBe(false);
  });

  it("keeps failed saves dirty and rejects explicit save attempts", async () => {
    const manager = new AutoSaveManager();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("Storage full"))
      .mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const latest = project("Unsaved edit");
    const errorListener = vi.fn();
    manager.on("error", errorListener);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(manager.forceSave(latest)).rejects.toThrow("Storage full");
    expect(manager.hasUnsavedChanges(latest)).toBe(true);
    expect(errorListener).toHaveBeenCalledOnce();
    await manager.forceSave(latest);
    expect(manager.hasUnsavedChanges(latest)).toBe(false);
    consoleError.mockRestore();
  });

  it("honors disabled auto-save while allowing explicit saves", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ enabled: false, debounceTime: 10 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const latest = project("Manual save");
    manager.start(() => latest);
    manager.markDirty(latest);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();

    await manager.forceSave(latest);
    expect(save).toHaveBeenCalledOnce();
    manager.stop();
  });

  it("flushes pending edits when the page is hidden before the debounce", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ debounceTime: 2_000 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    let latest = project("Initial");
    manager.start(() => latest);
    await Promise.resolve();
    latest = { ...latest, name: "Last edit before switching tabs" };
    manager.markDirty();

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toBe(latest);
    manager.stop();

    manager.markDirty({ ...latest, name: "Stopped session" });
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledOnce();
    manager.stop();
  });

  it("does not report a successful save until its transaction commits", async () => {
    const manager = new AutoSaveManager();
    const request = { result: "project-1-slot-0", error: null, onerror: null };
    const keys = { result: [], error: null, onsuccess: null, onerror: null };
    const tx = {
      error: null as DOMException | null,
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
      objectStore: () => ({
        put: () => request,
        index: () => ({ getAllKeys: () => keys }),
      }),
    };
    (manager as unknown as { db: unknown }).db = { transaction: () => tx };
    const saved = vi.fn();
    manager.on("saved", saved);
    const latest = project("Pending commit");
    const saving = manager.forceSave(latest);
    await vi.waitFor(() => expect(tx.oncomplete).toBeTypeOf("function"));
    expect(saved).not.toHaveBeenCalled();
    expect(manager.hasUnsavedChanges(latest)).toBe(true);

    tx.oncomplete!();
    await saving;
    expect(saved).toHaveBeenCalledOnce();
    expect(manager.hasUnsavedChanges(latest)).toBe(false);
  });

  it("treats a transaction abort as a failed save even after a successful request", async () => {
    const manager = new AutoSaveManager();
    const tx = {
      error: new DOMException("Storage full", "QuotaExceededError"),
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
      objectStore: () => ({
        put: () => ({ result: "project-1-slot-0", error: null }),
        index: () => ({ getAllKeys: () => ({ result: [], error: null }) }),
      }),
    };
    (manager as unknown as { db: unknown }).db = { transaction: () => tx };
    const saved = vi.fn();
    manager.on("saved", saved);
    const latest = project("Failed commit");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const saving = manager.forceSave(latest);
    await vi.waitFor(() => expect(tx.onabort).toBeTypeOf("function"));
    tx.onabort!();

    await expect(saving).rejects.toThrow("Storage full");
    expect(saved).not.toHaveBeenCalled();
    expect(manager.hasUnsavedChanges(latest)).toBe(true);
    consoleError.mockRestore();
  });

  it("strips runtime-only media payloads from serialized snapshots", () => {
    const source = project("Media project");
    const snapshot: Project = {
      ...source,
      mediaLibrary: {
        items: [
          {
            id: "media-1",
            name: "clip.mp4",
            type: "video",
            fileHandle: {} as FileSystemFileHandle,
            blob: new Blob(["video"], { type: "video/mp4" }),
            metadata: {
              duration: 5,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "h264",
              sampleRate: 48000,
              channels: 2,
              fileSize: 5,
            },
            thumbnailUrl: "blob:stale-thumbnail",
            waveformData: new Float32Array([0.1, 0.2]),
            filmstripThumbnails: [
              { timestamp: 0, url: "blob:stale-filmstrip" },
            ],
            sourceFile: {
              name: "clip.mp4",
              size: 5,
              lastModified: 123,
            },
          },
        ],
      },
    };

    const serialized = JSON.parse(serializeProjectForAutoSave(snapshot)) as {
      mediaLibrary: { items: Array<Record<string, unknown>> };
    };

    expect(serialized.mediaLibrary.items[0]).toMatchObject({
      blob: null,
      fileHandle: null,
      waveformData: null,
      thumbnailUrl: null,
      sourceFile: {
        name: "clip.mp4",
        size: 5,
        lastModified: 123,
      },
    });
    expect(serialized.mediaLibrary.items[0]).not.toHaveProperty(
      "filmstripThumbnails",
    );
  });
});
