import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DESKTOP_FORMATS,
  startNewProject,
  startNewMotionProject,
  listRecentProjects,
  openRecentProject,
} from "./desktop-project-actions";
import { useProjectStore } from "../../stores/project-store";
import { checkForRecovery } from "../../services/auto-save";

vi.mock("../../stores/project-store", () => ({
  useProjectStore: { getState: vi.fn() },
}));

vi.mock("../../services/auto-save", () => ({
  checkForRecovery: vi.fn(),
}));

const mockedGetState = vi.mocked(useProjectStore.getState);
const mockedCheckForRecovery = vi.mocked(checkForRecovery);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DESKTOP_FORMATS", () => {
  it("contains vertical, horizontal, and square at 30fps with correct dimensions", () => {
    expect(DESKTOP_FORMATS).toHaveLength(3);
    expect(DESKTOP_FORMATS.find((f) => f.id === "vertical")).toMatchObject({
      label: "Vertical",
      width: 1080,
      height: 1920,
      frameRate: 30,
    });
    expect(DESKTOP_FORMATS.find((f) => f.id === "horizontal")).toMatchObject({
      label: "Horizontal",
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
    expect(DESKTOP_FORMATS.find((f) => f.id === "square")).toMatchObject({
      label: "Square",
      width: 1080,
      height: 1080,
      frameRate: 30,
    });
  });
});

describe("startNewProject", () => {
  it("calls createNewProject with the format label and dimensions", () => {
    const createNewProject = vi.fn();
    mockedGetState.mockReturnValue({
      createNewProject,
    } as unknown as ReturnType<typeof useProjectStore.getState>);

    const format = DESKTOP_FORMATS[1];
    startNewProject(format);

    expect(createNewProject).toHaveBeenCalledTimes(1);
    expect(createNewProject).toHaveBeenCalledWith("Horizontal", {
      width: 1920,
      height: 1080,
      frameRate: 30,
    });
  });
});

describe("startNewMotionProject", () => {
  it("creates a Motion Creator project with the selected format dimensions", () => {
    const createNewProject = vi.fn();
    mockedGetState.mockReturnValue({
      createNewProject,
    } as unknown as ReturnType<typeof useProjectStore.getState>);

    const format = DESKTOP_FORMATS[0];
    startNewMotionProject(format);

    expect(createNewProject).toHaveBeenCalledTimes(1);
    expect(createNewProject).toHaveBeenCalledWith("Vertical Motion Creator", {
      width: 1080,
      height: 1920,
      frameRate: 30,
    });
  });
});

describe("openRecentProject", () => {
  it("delegates to recoverFromAutoSave with the save id", async () => {
    const recoverFromAutoSave = vi.fn().mockResolvedValue(true);
    mockedGetState.mockReturnValue({
      recoverFromAutoSave,
    } as unknown as ReturnType<typeof useProjectStore.getState>);

    const result = await openRecentProject("save-123");

    expect(recoverFromAutoSave).toHaveBeenCalledWith("save-123");
    expect(result).toBe(true);
  });
});

describe("listRecentProjects", () => {
  it("dedupes by project, sorts by recency, and maps to RecentEntry", async () => {
    mockedCheckForRecovery.mockResolvedValue([
      {
        id: "save-a2",
        projectId: "proj-a",
        projectName: "Alpha",
        timestamp: 2000,
        slot: 1,
        isRecovery: true,
      },
      {
        id: "save-a1",
        projectId: "proj-a",
        projectName: "Alpha",
        timestamp: 1000,
        slot: 0,
        isRecovery: true,
      },
      {
        id: "save-b1",
        projectId: "proj-b",
        projectName: "Beta",
        timestamp: 3000,
        slot: 0,
        isRecovery: true,
      },
    ]);

    const entries = await listRecentProjects();

    expect(entries).toEqual([
      { id: "save-b1", name: "Beta", savedAt: 3000 },
      { id: "save-a2", name: "Alpha", savedAt: 2000 },
    ]);
  });

  it("returns an empty array when there are no saves", async () => {
    mockedCheckForRecovery.mockResolvedValue([]);
    const entries = await listRecentProjects();
    expect(entries).toEqual([]);
  });
});
