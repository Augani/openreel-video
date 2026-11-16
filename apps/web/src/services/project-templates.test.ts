import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import { templateProjectFixture } from "../test/template-fixture";
import {
  openTemplateProject,
  resolveTemplateMedia,
  templateEditorOwner,
} from "./project-templates";
import { autoSaveManager } from "./auto-save";
import { saveMediaBlob, deleteMediaBlob, loadMediaBlob } from "./media-storage";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useProcessingStore } from "./processing-manager";

vi.mock("./media-storage", () => ({
  saveMediaBlob: vi.fn(async () => {}),
  deleteMediaBlob: vi.fn(async () => {}),
  loadMediaBlob: vi.fn(),
}));
vi.mock("../utils/media-recovery", () => ({
  restoreMediaItem: vi.fn(async (item: unknown) => item),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore
    .getState()
    .loadProject(templateProjectFixture("Current edit"));
  useTimelineStore.setState({
    playbackLockedReason: null,
    playheadPosition: 1,
  });
  useUIStore.setState({
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
  useProcessingStore.setState({
    tasks: new Map(),
    isProcessing: false,
    currentTaskId: null,
  });
  vi.spyOn(useProjectStore.getState(), "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "forceSave").mockResolvedValue();
  vi.spyOn(autoSaveManager, "clearProjectSaves").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("durable template project application", () => {
  it("stages new media IDs and commits recovery before publishing and hydrating the complete shaded title", async () => {
    const before = useProjectStore.getState().project,
      incoming = templateProjectFixture("Incoming");
    let finish!: () => void;
    vi.mocked(autoSaveManager.forceSave).mockImplementationOnce(
      async (copy) => {
        expect(copy.id).not.toBe(incoming.id);
        expect(copy.mediaLibrary.items[0].id).not.toBe("original-media");
        expect(saveMediaBlob).toHaveBeenCalledWith(
          copy.id,
          copy.mediaLibrary.items[0].id,
          incoming.mediaLibrary.items[0].blob,
          incoming.mediaLibrary.items[0].metadata,
        );
        expect(useProjectStore.getState().project).toBe(before);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    );
    const pending = openTemplateProject(incoming, templateEditorOwner());
    await vi.waitFor(() =>
      expect(autoSaveManager.forceSave).toHaveBeenCalledOnce(),
    );
    expect(
      useEngineStore.getState().titleEngine!.getAllTextClips()[0].text,
    ).toBe("Measured motion");
    finish();
    const copy = await pending;
    expect(useProjectStore.getState().project.id).toBe(copy.id);
    expect(useProjectStore.getState().project.textClips).toEqual(
      incoming.textClips,
    );
    expect(useEngineStore.getState().titleEngine!.getAllTextClips()).toEqual(
      incoming.textClips,
    );
    expect(copy.timeline.tracks[1].clips[0].mediaId).toBe(
      copy.mediaLibrary.items[0].id,
    );
    expect(incoming.timeline.tracks[1].clips[0].mediaId).toBe("original-media");
    expect(useProjectStore.getState().forceSave).toHaveBeenCalledTimes(2);
    expect(useTimelineStore.getState().playheadPosition).toBe(0);
    expect(deleteMediaBlob).not.toHaveBeenCalled();
  });

  it("keeps the source intact when its initial save fails", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    await expect(
      openTemplateProject(templateProjectFixture(), templateEditorOwner()),
    ).rejects.toThrow("Storage full");
    expect(useProjectStore.getState().project).toBe(before);
    expect(saveMediaBlob).not.toHaveBeenCalled();
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
  });

  it.each(["media", "project"] as const)(
    "rolls back staged data when the %s write fails and permits retry",
    async (stage) => {
      const before = useProjectStore.getState().project;
      if (stage === "media")
        vi.mocked(saveMediaBlob).mockRejectedValueOnce(
          new Error("Storage full"),
        );
      else
        vi.mocked(autoSaveManager.forceSave).mockRejectedValueOnce(
          new Error("Storage full"),
        );
      await expect(
        openTemplateProject(templateProjectFixture(), templateEditorOwner()),
      ).rejects.toThrow("Storage full");
      expect(useProjectStore.getState().project).toBe(before);
      const mediaId = vi.mocked(saveMediaBlob).mock.calls[0][1];
      expect(deleteMediaBlob).toHaveBeenCalledWith(mediaId);
      expect(mediaId).not.toBe("original-media");
      expect(autoSaveManager.clearProjectSaves).toHaveBeenCalledOnce();
      await expect(
        openTemplateProject(templateProjectFixture(), templateEditorOwner()),
      ).resolves.toBeDefined();
    },
  );

  it("saves an edit that arrives while template originals are being staged", async () => {
    const save = vi.mocked(useProjectStore.getState().forceSave);
    vi.mocked(saveMediaBlob).mockImplementationOnce(async () => {
      useProjectStore.setState((state) => ({
        project: { ...state.project, name: "Edited during media write" },
      }));
    });
    save.mockImplementationOnce(async () => {});
    save.mockImplementationOnce(async () => {
      expect(useProjectStore.getState().project.name).toBe(
        "Edited during media write",
      );
    });
    await openTemplateProject(templateProjectFixture(), templateEditorOwner());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("rejects a changed history even when the new owner has the same project ID", async () => {
    const current = useProjectStore.getState().project,
      owner = templateEditorOwner();
    vi.mocked(saveMediaBlob).mockImplementationOnce(async () => {
      useProjectStore.getState().loadProject({ ...current, name: "Reopened" });
    });
    await expect(
      openTemplateProject(templateProjectFixture(), owner),
    ).rejects.toThrow("open project changed");
    expect(useProjectStore.getState().project.name).toBe("Reopened");
    expect(autoSaveManager.forceSave).not.toHaveBeenCalled();
    expect(deleteMediaBlob).toHaveBeenCalledOnce();
  });

  it("rejects cancellation after recovery commit and cleans only the new copy", async () => {
    const controller = new AbortController(),
      before = useProjectStore.getState().project;
    vi.mocked(autoSaveManager.forceSave).mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      openTemplateProject(
        templateProjectFixture(),
        templateEditorOwner(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(useProjectStore.getState().project).toBe(before);
    expect(autoSaveManager.clearProjectSaves).toHaveBeenCalledOnce();
  });

  it.each(["export", "processing", "playback"])(
    "blocks application during %s",
    async (kind) => {
      if (kind === "export")
        useUIStore.setState({
          exportState: {
            ...useUIStore.getState().exportState,
            isExporting: true,
          },
        });
      if (kind === "processing")
        useProcessingStore.getState().addTask("clip", "effects");
      if (kind === "playback")
        useTimelineStore.setState({ playbackLockedReason: "test" });
      await expect(
        openTemplateProject(templateProjectFixture(), templateEditorOwner()),
      ).rejects.toThrow("current operation");
      expect(saveMediaBlob).not.toHaveBeenCalled();
    },
  );

  it("rejects concurrent application without interrupting the first copy", async () => {
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = openTemplateProject(
      templateProjectFixture(),
      templateEditorOwner(),
    );
    await vi.waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    await expect(
      openTemplateProject(templateProjectFixture(), templateEditorOwner()),
    ).rejects.toThrow("already being applied");
    finish();
    await expect(pending).resolves.toBeDefined();
  });
});

describe("selected template media", () => {
  it.each(["isPending", "kieaiError"] as const)(
    "does not copy a generated placeholder when its %s state is active",
    async (flag) => {
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            items: state.project.mediaLibrary.items.map((item) => ({
              ...item,
              [flag]: true,
            })),
          },
        },
      }));
      await expect(
        resolveTemplateMedia(
          { footage: { type: "media", value: "original-media" } },
          templateEditorOwner(),
        ),
      ).rejects.toThrow("finish generating");
    },
  );
  it("resolves a library ID to real footage with its metadata without modifying form values", async () => {
    const values = { footage: { type: "media", value: "original-media" } };
    const result = await resolveTemplateMedia(values, templateEditorOwner());
    expect(result.footage).toMatchObject({
      ...values.footage,
      mediaBlob: useProjectStore.getState().project.mediaLibrary.items[0].blob,
      media: {
        name: "Original.mp4",
        type: "video",
        metadata: { duration: 2, frameRate: 24 },
      },
    });
    expect(values.footage).not.toHaveProperty("mediaBlob");
    expect(loadMediaBlob).not.toHaveBeenCalled();
  });

  it("rejects missing library originals instead of claiming an empty replacement succeeded", async () => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          items: state.project.mediaLibrary.items.map((item) => ({
            ...item,
            blob: null,
          })),
        },
      },
    }));
    vi.mocked(loadMediaBlob).mockResolvedValueOnce(null);
    await expect(
      resolveTemplateMedia(
        { footage: { type: "media", value: "original-media" } },
        templateEditorOwner(),
      ),
    ).rejects.toThrow("Relink");
  });
});
