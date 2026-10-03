import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useProjectRecovery } from "./useProjectRecovery";

const { autoSaveManager, clearAllStorage } = vi.hoisted(() => ({
  autoSaveManager: {
    initialize: vi.fn(async () => {}),
    checkForRecovery: vi.fn(async () => [{
      id: "save-1",
      projectId: "project-1",
      projectName: "My video",
      timestamp: 1,
      slot: 0,
      isRecovery: true,
    }]),
    clearAllSaves: vi.fn(async () => {}),
  },
  clearAllStorage: vi.fn(async () => {}),
}));

vi.mock("../services/auto-save", () => ({ autoSaveManager }));
vi.mock("../services/media-storage", () => ({ clearAllStorage }));
vi.mock("../stores/project-store", () => ({
  useProjectStore: (select: (state: unknown) => unknown) => select({
    recoverFromAutoSave: vi.fn(async () => true),
  }),
}));

describe("Project recovery cleanup", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("clears recovery snapshots without deleting imported media or saved projects", async () => {
    const { result } = renderHook(() => useProjectRecovery());
    await waitFor(() => expect(result.current.showDialog).toBe(true));

    await act(async () => { await result.current.clearAll(); });

    expect(autoSaveManager.clearAllSaves).toHaveBeenCalledOnce();
    expect(clearAllStorage).not.toHaveBeenCalled();
    expect(result.current.availableSaves).toEqual([]);
    expect(result.current.showDialog).toBe(false);
  });
});
