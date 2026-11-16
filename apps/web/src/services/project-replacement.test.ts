import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openEditorProject } from "./project-replacement";
import { projectManager, type PickedProjectFile } from "./project-manager";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { createEmptyProject } from "../stores/project/project-helpers";

const original = createEmptyProject("Current edit");
const incoming = createEmptyProject("Chosen file");
const originalFile = { kind: "native" as const, path: "/current.oreel" };
const picked: PickedProjectFile = { project: incoming, fileHandle: { kind: "native", path: "/chosen.oreel" } };

beforeEach(() => {
  useProjectStore.setState({ hasOpenProject: true, project: original });
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 5 });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  projectManager.activatePickedProject({ project: original, fileHandle: originalFile });
  vi.spyOn(useProjectStore.getState(), "forceSave").mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); projectManager.releaseCurrentFileHandle(); });

describe("shared web/native project replacement", () => {
  it("starts the picker in the click stack, saves before replacing, then commits the chosen handle", async () => {
    let inClick = true;
    const picker = vi.spyOn(projectManager, "pickProjectFile").mockImplementation(() => {
      expect(inClick).toBe(true);
      return Promise.resolve(picked);
    });
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const result = openEditorProject();
    inClick = false;
    expect(picker).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project).toBe(original);
    expect(projectManager.getCurrentFileHandle()).toBe(originalFile);
    finish();
    await expect(result).resolves.toBe(true);
    expect(useProjectStore.getState().project.id).toBe(incoming.id);
    expect(projectManager.getCurrentFileHandle()).toBe(picked.fileHandle);
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
    expect(useUIStore.getState().selectedItems).toEqual([]);
  });

  it("saves edits made while the previous revision is being written before replacing", async () => {
    vi.spyOn(projectManager, "pickProjectFile").mockResolvedValue(picked);
    let finish!: () => void;
    const save = vi.mocked(useProjectStore.getState().forceSave);
    save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = openEditorProject();
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const edited = { ...original, name: "Edited while saving" };
    useProjectStore.setState({ project: edited });
    save.mockImplementationOnce(async () => { expect(useProjectStore.getState().project).toBe(edited); });
    finish();
    await expect(pending).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("retains the current project and save target when saving fails", async () => {
    vi.spyOn(projectManager, "pickProjectFile").mockResolvedValue(picked);
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(new Error("Storage full"));
    await expect(openEditorProject()).rejects.toThrow("Storage full");
    expect(useProjectStore.getState().project).toBe(original);
    expect(projectManager.getCurrentFileHandle()).toBe(originalFile);
  });

  it("does not save or replace anything after picker cancellation", async () => {
    vi.spyOn(projectManager, "pickProjectFile").mockResolvedValue(null);
    await expect(openEditorProject()).resolves.toBe(false);
    expect(useProjectStore.getState().forceSave).not.toHaveBeenCalled();
    expect(projectManager.getCurrentFileHandle()).toBe(originalFile);
  });

  it("rejects a stale file choice if another project opens while the picker is visible", async () => {
    let choose!: (file: PickedProjectFile) => void;
    vi.spyOn(projectManager, "pickProjectFile").mockImplementation(() => new Promise(resolve => { choose = resolve; }));
    const result = openEditorProject();
    const other = createEmptyProject("Other project");
    useProjectStore.setState({ project: other });
    choose(picked);
    await expect(result).rejects.toThrow("open project changed");
    expect(useProjectStore.getState().project).toBe(other);
    expect(useProjectStore.getState().forceSave).not.toHaveBeenCalled();
    expect(projectManager.getCurrentFileHandle()).toBe(originalFile);
  });

  it("prevents a second picker and rechecks export state before committing", async () => {
    let choose!: (file: PickedProjectFile) => void;
    const picker = vi.spyOn(projectManager, "pickProjectFile").mockImplementation(() => new Promise(resolve => { choose = resolve; }));
    const first = openEditorProject();
    await expect(openEditorProject()).resolves.toBe(false);
    expect(picker).toHaveBeenCalledOnce();
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    choose(picked);
    await expect(first).rejects.toThrow("export to finish");
    expect(useProjectStore.getState().project).toBe(original);
    expect(projectManager.getCurrentFileHandle()).toBe(originalFile);
  });

  it("clears old file targets for New and independent imports, while retaining one for edits to the same project", () => {
    useProjectStore.getState().loadProject({ ...original, name: "Updated current project" });
    expect(projectManager.getCurrentFileHandle()).toBe(originalFile);
    useProjectStore.getState().loadProject(incoming);
    expect(projectManager.getCurrentFileHandle()).toBeNull();
    projectManager.activatePickedProject(picked);
    useProjectStore.getState().createNewProject("New edit");
    expect(projectManager.getCurrentFileHandle()).toBeNull();
  });
});
