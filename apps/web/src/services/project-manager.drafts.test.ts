import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectManager } from "./project-manager";
import { createEmptyProject } from "../stores/project/project-helpers";
import type { Project } from "@openreel/core";
const initial = createEmptyProject("Draft save");
const completed = { ...initial, settings: { ...initial.settings, width: 640 } };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
beforeEach(() => { projectManager.releaseCurrentFileHandle(); vi.spyOn(projectManager, "addToRecent").mockResolvedValue(); });
afterEach(() => { delete window.openreel; delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker; vi.restoreAllMocks(); projectManager.releaseCurrentFileHandle(); });
function browser() {
  const writer = { write: vi.fn(async (_data: string) => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const handle = { createWritable: vi.fn(async () => writer) }, picker = vi.fn(async () => handle);
  Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: picker }); return { writer, handle, picker };
}
describe("pending-edit Save snapshots", () => {
  it("opens the browser picker before resolving the final snapshot and writes completed data", async () => {
    const { writer, handle, picker } = browser(), edit = deferred<Project>(), resolve = vi.fn(() => edit.promise);
    const saving = projectManager.saveProjectAs(initial, resolve);
    expect(picker).toHaveBeenCalledOnce(); expect(resolve).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(handle.createWritable).toHaveBeenCalledOnce());
    expect(writer.write).not.toHaveBeenCalled(); edit.resolve(completed); await saving;
    expect(JSON.parse(writer.write.mock.calls[0][0])).toEqual(completed);
  });
  it("opens an existing browser writable in the initiating event and aborts it on edit failure", async () => {
    const { writer, handle } = browser(); projectManager.activatePickedProject({ project: initial, fileHandle: handle as unknown as FileSystemFileHandle });
    const edit = deferred<Project>(), resolve = vi.fn(() => edit.promise);
    const saving = projectManager.saveProject(initial, resolve); expect(handle.createWritable).toHaveBeenCalledOnce();
    const rejection = expect(saving).rejects.toThrow("Pending edit failed");
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    edit.reject(new Error("Pending edit failed"));
    await rejection; expect(writer.write).not.toHaveBeenCalled(); expect(writer.abort).toHaveBeenCalledOnce(); expect(writer.close).not.toHaveBeenCalled();
  });
  it("does not resolve or write an edit after picker cancellation", async () => {
    const { writer, picker } = browser(); picker.mockRejectedValueOnce(new DOMException("Cancel", "AbortError"));
    const resolve = vi.fn(async () => completed);
    await expect(projectManager.saveProjectAs(initial, resolve)).resolves.toBe(false);
    expect(resolve).not.toHaveBeenCalled(); expect(writer.write).not.toHaveBeenCalled();
  });
  it("writes the final native snapshot and emits that same project", async () => {
    const edit = deferred<Project>(), writeFile = vi.fn(async (_path: string, _data: string) => {}), picker = vi.fn(async () => "/test.oreel");
    window.openreel = { fs: { showSaveDialog: picker, writeFile } } as unknown as NonNullable<Window["openreel"]>;
    const saved = vi.fn(), stop = projectManager.on("projectSaved", saved);
    try {
      const saving = projectManager.saveProjectAs(initial, () => edit.promise); expect(picker).toHaveBeenCalledOnce();
      await Promise.resolve(); expect(writeFile).not.toHaveBeenCalled(); edit.resolve(completed); await saving;
      expect(JSON.parse(writeFile.mock.calls[0][1])).toEqual(completed); expect(saved).toHaveBeenCalledWith({ project: completed });
    } finally { stop(); }
  });
});
