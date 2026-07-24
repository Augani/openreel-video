import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type React from "react";
import { Button } from "@astryxdesign/core/Button";

import { DesktopApp } from "./DesktopApp";
import { useProjectStore } from "../stores/project-store";
import type { ProjectState } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useSettingsStore } from "../stores/settings-store";

vi.mock("../stores/project-store", () => ({
  useProjectStore: vi.fn(),
}));

vi.mock("./editor/EditorBootstrapGate", () => ({
  EditorBootstrapGate: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./pages/EditPage", () => ({
  EditPage: () => null,
}));

vi.mock("./pages/MotionPage", () => ({
  MotionPage: () => null,
}));

vi.mock("./editor/DesktopExportButton", () => ({
  DesktopExportButton: () => <Button label="Video Export" />,
}));

vi.mock("../components/editor/settings/SettingsDialog", () => ({
  SettingsDialog: () => <div data-testid="desktop-settings-dialog" />,
}));

const mockedUseProjectStore = vi.mocked(useProjectStore);

function mockHasProject(value: boolean): void {
  mockedUseProjectStore.mockImplementation((selector) =>
    selector({ hasOpenProject: value } as unknown as ProjectState),
  );
}

beforeEach(() => {
  useUIStore.setState({ desktopPage: "edit" });
  useSettingsStore.setState({ settingsOpen: false, settingsTab: "general" });
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    win: { minimize: () => {}, toggleMaximize: () => {}, close: () => {}, isMaximized: async () => false },
  };
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
  vi.clearAllMocks();
});

describe("DesktopApp", () => {
  it("applies the desktop theme class to its root", () => {
    mockHasProject(false);
    const { container } = render(<DesktopApp />);
    expect(container.querySelector(".openreel-desktop")).not.toBeNull();
  });

  it("shows the start screen and hides the workspace when no project is open", () => {
    mockHasProject(false);
    const { getByText, queryByTestId } = render(<DesktopApp />);
    expect(getByText("New Project")).toBeTruthy();
    expect(queryByTestId("desktop-workspace")).toBeNull();
  });

  it("renders the title bar and workspace when a project is open", () => {
    mockHasProject(true);
    const { getByText, getByTestId } = render(<DesktopApp />);
    expect(getByText("OpenReel")).toBeTruthy();
    expect(getByTestId("desktop-workspace")).toBeTruthy();
  });

  it("shows the video export only while the Video Editing workspace is active", () => {
    mockHasProject(true);
    const editView = render(<DesktopApp />);
    expect(editView.getByRole("button", { name: "Video Export" })).toBeTruthy();
    editView.unmount();

    useUIStore.setState({ desktopPage: "motion" });
    const motionView = render(<DesktopApp />);
    expect(
      motionView.queryByRole("button", { name: "Video Export" }),
    ).toBeNull();
  });

  it("keeps settings reachable from the desktop title bar", () => {
    mockHasProject(false);
    const view = render(<DesktopApp />);

    fireEvent.click(view.getByRole("button", { name: "Settings" }));

    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(view.getByTestId("desktop-settings-dialog")).toBeTruthy();
  });
});
