import "../../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useUIStore } from "../../stores/ui-store";

const actionMocks = vi.hoisted(() => ({
  listRecentProjects: vi.fn(),
  openRecentProject: vi.fn(),
  startNewProject: vi.fn(),
  startNewMotionProject: vi.fn(),
}));

vi.mock("./desktop-project-actions", async () => {
  const actual = await vi.importActual<typeof import("./desktop-project-actions")>(
    "./desktop-project-actions",
  );
  return {
    ...actual,
    listRecentProjects: actionMocks.listRecentProjects,
    openRecentProject: actionMocks.openRecentProject,
    startNewProject: actionMocks.startNewProject,
    startNewMotionProject: actionMocks.startNewMotionProject,
  };
});

import { DESKTOP_FORMATS } from "./desktop-project-actions";
import { DesktopStartScreen } from "./DesktopStartScreen";

describe("DesktopStartScreen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    actionMocks.listRecentProjects.mockResolvedValue([]);
    actionMocks.openRecentProject.mockResolvedValue(true);
    actionMocks.startNewProject.mockReset();
    actionMocks.startNewMotionProject.mockReset();
    useUIStore.setState({ desktopPage: "edit" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("starts a Video Editor project from the default mode", async () => {
    render(<DesktopStartScreen />);
    await screen.findByText("No recent projects yet. Start a new project above.");

    fireEvent.click(screen.getByRole("button", { name: /Horizontal/ }));

    expect(actionMocks.startNewProject).toHaveBeenCalledWith(DESKTOP_FORMATS[1]);
    expect(actionMocks.startNewMotionProject).not.toHaveBeenCalled();
    expect(useUIStore.getState().desktopPage).toBe("edit");
  });

  it("starts a Motion Creator project after selecting the motion mode", async () => {
    render(<DesktopStartScreen />);
    await screen.findByText("No recent projects yet. Start a new project above.");

    fireEvent.click(screen.getByRole("checkbox", { name: /Motion Creator/ }));
    fireEvent.click(screen.getByRole("button", { name: /Square/ }));

    expect(actionMocks.startNewMotionProject).toHaveBeenCalledWith(DESKTOP_FORMATS[2]);
    expect(actionMocks.startNewProject).not.toHaveBeenCalled();
    expect(useUIStore.getState().desktopPage).toBe("motion");
  });
});
