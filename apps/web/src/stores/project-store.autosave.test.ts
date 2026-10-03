import { describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./project-store";
import { useSettingsStore } from "./settings-store";

const { manager, initialize } = vi.hoisted(() => ({
  manager: {
    isInitialized: vi.fn(() => false),
    on: vi.fn(),
    updateConfig: vi.fn(),
    start: vi.fn(),
    markDirty: vi.fn(),
  },
  initialize: vi.fn(async () => {}),
}));

vi.mock("../services/auto-save", () => ({
  autoSaveManager: manager,
  initializeAutoSave: initialize,
}));

describe("Project-store auto-save initialization", () => {
  it("retries failed initialization and shares successful setup without duplicating subscriptions", async () => {
    const subscribeProject = vi.spyOn(useProjectStore, "subscribe");
    const subscribeSettings = vi.spyOn(useSettingsStore, "subscribe");
    useSettingsStore.setState({ autoSave: true, autoSaveInterval: 5 });

    await useProjectStore.getState().initializeAutoSave();
    expect(manager.start).not.toHaveBeenCalled();
    expect(subscribeProject).not.toHaveBeenCalled();
    expect(subscribeSettings).not.toHaveBeenCalled();
    expect(manager.on).toHaveBeenCalledTimes(2);

    let complete!: () => void;
    initialize.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const firstRetry = useProjectStore.getState().initializeAutoSave();
    const concurrentRetry = useProjectStore.getState().initializeAutoSave();
    expect(initialize).toHaveBeenCalledTimes(2);
    manager.isInitialized.mockReturnValue(true);
    complete();
    await Promise.all([firstRetry, concurrentRetry]);
    await useProjectStore.getState().initializeAutoSave();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(manager.on).toHaveBeenCalledTimes(2);
    expect(manager.start).toHaveBeenCalledOnce();
    expect(subscribeProject).toHaveBeenCalledOnce();
    expect(subscribeSettings).toHaveBeenCalledOnce();
    expect(manager.updateConfig).toHaveBeenCalledWith({ enabled: true, interval: 300_000 });

    useProjectStore.setState({ project: { ...useProjectStore.getState().project, name: "Edit after retry" } });
    expect(manager.markDirty).toHaveBeenCalledOnce();
    useSettingsStore.setState({ autoSave: false });
    expect(manager.updateConfig).toHaveBeenLastCalledWith({ enabled: false, interval: 300_000 });
    vi.restoreAllMocks();
  });
});
