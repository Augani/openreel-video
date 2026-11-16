import "../test/install-local-storage-mock";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useProcessingStore } from "./processing-manager";
import { templateProjectFixture } from "../test/template-fixture";
import { trackEditorDraftWrite } from "./editor-field-drafts";
import { createEditorProject } from "./project-creation";
beforeEach(() => {
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore
    .getState()
    .loadProject(templateProjectFixture("Unsaved shaded work"));
  useUIStore.setState({
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  useTimelineStore.setState({ playbackLockedReason: null });
  useProcessingStore.setState({
    tasks: new Map(),
    isProcessing: false,
    currentTaskId: null,
  });
  vi.spyOn(useProjectStore.getState(), "forceSave").mockResolvedValue();
  vi.spyOn(useProjectStore.getState(), "createNewProject");
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("owned atomic project creation", () => {
  it("captures the requested name and settings independently before the asynchronous save", async () => {
    let finish!: () => void;
    const options = {
      name: "Requested",
      settings: { width: 1080, height: 1920 },
    };
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createEditorProject(options);
    await vi.waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    options.name = "Changed later";
    options.settings.width = 99;
    finish();
    await expect(pending).resolves.toMatchObject({
      name: "Requested",
      settings: { width: 1080, height: 1920 },
    });
  });
  it("waits for the existing shaded work to save before publishing all new settings at once", async () => {
    const before = useProjectStore.getState().project;
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createEditorProject({
      name: "Named project",
      settings: { width: 1080, height: 1920, frameRate: 24 },
    });
    await vi.waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().getFullProject().textClips).toEqual(
      before.textClips,
    );
    expect(useProjectStore.getState().createNewProject).not.toHaveBeenCalled();
    finish();
    const created = await pending;
    expect(created.settings).toMatchObject({
      width: 1080,
      height: 1920,
      frameRate: 24,
    });
    expect(created.name).toBe("Named project");
    expect(created.id).not.toBe(before.id);
    expect(useProjectStore.getState().createNewProject).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().actionHistory.canUndo()).toBe(false);
  });
  it("flushes registered editor writes before saving and creating", async () => {
    let finish!: () => void;
    const state = useProjectStore.getState();
    trackEditorDraftWrite(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
      { projectId: state.project.id, history: state.actionHistory },
    );
    const pending = createEditorProject({ name: "Next" });
    await Promise.resolve();
    expect(state.forceSave).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(state.forceSave).toHaveBeenCalledOnce();
  });
  it("keeps existing work when saving fails", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    await expect(createEditorProject({ name: "Next" })).rejects.toThrow(
      "Storage full",
    );
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().createNewProject).not.toHaveBeenCalled();
  });
  it("rejects a reloaded history even if the project ID stayed the same", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      async () => {
        useProjectStore.getState().loadProject({ ...before, name: "Reopened" });
      },
    );
    await expect(createEditorProject({ name: "Next" })).rejects.toThrow(
      "open project changed",
    );
    expect(useProjectStore.getState().project.name).toBe("Reopened");
  });
  it("cancels a pending request without publishing a new project", async () => {
    const controller = new AbortController(),
      before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      async () => {
        controller.abort();
      },
    );
    await expect(
      createEditorProject({ name: "Next", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(useProjectStore.getState().project).toBe(before);
  });
  it("lets a newer route supersede an old pending request without a stale publication", async () => {
    let oldCurrent = true,
      finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const old = createEditorProject({
      name: "Old request",
      isCurrent: () => oldCurrent,
    });
    const oldResult = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    oldCurrent = false;
    const latest = await createEditorProject({
      name: "Latest request",
      settings: { frameRate: 60 },
    });
    finish();
    await oldResult;
    expect(useProjectStore.getState().project.id).toBe(latest.id);
    expect(latest.name).toBe("Latest request");
    expect(latest.settings.frameRate).toBe(60);
  });
  it("blocks overlapping live requests and permits a later independent request", async () => {
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = createEditorProject({ name: "First" });
    await vi.waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    await expect(createEditorProject({ name: "Overlapping" })).rejects.toThrow(
      "already being created",
    );
    finish();
    await first;
    await expect(createEditorProject({ name: "Later" })).resolves.toMatchObject(
      { name: "Later" },
    );
  });
  it.each(["export", "playback", "processing"])(
    "blocks creation during %s",
    async (kind) => {
      if (kind === "export")
        useUIStore.setState({
          exportState: {
            ...useUIStore.getState().exportState,
            isExporting: true,
          },
        });
      if (kind === "playback")
        useTimelineStore.setState({ playbackLockedReason: "Test operation" });
      if (kind === "processing")
        useProcessingStore.getState().addTask("clip", "effects");
      await expect(createEditorProject({ name: "Next" })).rejects.toThrow(
        "current operation",
      );
      expect(
        useProjectStore.getState().createNewProject,
      ).not.toHaveBeenCalled();
    },
  );
});
