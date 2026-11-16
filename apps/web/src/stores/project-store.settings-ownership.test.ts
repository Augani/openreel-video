import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./project-store";

beforeEach(() => useProjectStore.getState().createNewProject("Original"));

describe("project settings publication", () => {
  it("cannot restore a previous project after a new project replaces it during completion", async () => {
    const old = useProjectStore
      .getState()
      .updateSettings({ width: 1080, height: 1920 });
    useProjectStore
      .getState()
      .createNewProject("Replacement", { width: 1080, height: 1080 });
    const replacement = useProjectStore.getState().project;
    await old;
    expect(useProjectStore.getState().project).toBe(replacement);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(0);
  });

  it("cannot replace a reloaded project that has the same id", async () => {
    const original = useProjectStore.getState().project;
    const old = useProjectStore.getState().updateSettings({ frameRate: 60 });
    useProjectStore
      .getState()
      .loadProject({
        ...original,
        name: "Reloaded",
        settings: { ...original.settings, frameRate: 24 },
      });
    const reloaded = useProjectStore.getState().project;
    await old;
    expect(useProjectStore.getState().project).toBe(reloaded);
    expect(useProjectStore.getState().project.settings.frameRate).toBe(24);
  });

  it("retains a name edit made while settings finish and preserves exact settings Undo", async () => {
    const old = useProjectStore
      .getState()
      .updateSettings({ width: 1080, height: 1920, frameRate: 60 });
    const current = useProjectStore.getState().project;
    useProjectStore.setState({
      project: { ...current, name: "Current title" },
    });
    await old;
    expect(useProjectStore.getState().project.name).toBe("Current title");
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1080,
      height: 1920,
      frameRate: 60,
    });
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.name).toBe("Current title");
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
  });

  it("retains two overlapping settings writes and their intermediate Undo values", async () => {
    const first = useProjectStore
      .getState()
      .updateSettings({ width: 1080, frameRate: 60 });
    const second = useProjectStore
      .getState()
      .updateSettings({ width: 720, height: 1280 });
    await Promise.all([first, second]);
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 720,
      height: 1280,
      frameRate: 60,
    });
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1080,
      height: 1080,
      frameRate: 60,
    });
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.settings).toMatchObject({
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
  });
});
