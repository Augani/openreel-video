import "../../test/install-local-storage-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  GraphicsEngine,
  TitleEngine,
} from "@openreel/core";
import { WelcomeScreen } from "./WelcomeScreen";
import { useProjectStore } from "../../stores/project-store";
import { useEngineStore } from "../../stores/engine-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useProcessingStore } from "../../services/processing-manager";
import { templateProjectFixture } from "../../test/template-fixture";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), track: vi.fn() }));
vi.mock("../../hooks/use-router", () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock("../../hooks/useEditorPreload", () => ({ useEditorPreload: () => {} }));
vi.mock("../../hooks/usePhoneEditor", () => ({ usePhoneEditor: () => false }));
vi.mock("../../hooks/useAnalytics", () => ({
  useAnalytics: () => ({ track: mocks.track }),
  AnalyticsEvents: { PROJECT_CREATED: "project_created" },
}));
beforeEach(() => {
  vi.clearAllMocks();
  useEngineStore.setState({
    titleEngine: new TitleEngine(),
    graphicsEngine: new GraphicsEngine(),
  });
  useProjectStore
    .getState()
    .loadProject(templateProjectFixture("Work to preserve"));
  useUIStore.setState({
    skipWelcomeScreen: false,
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
  cleanup();
  vi.restoreAllMocks();
});
describe("preserved welcome project creation", () => {
  it.each([
    ["Vertical", 1080, 1920],
    ["Horizontal", 1920, 1080],
    ["Square", 1080, 1080],
  ] as const)(
    "saves existing work before creating the %s preset",
    async (label, width, height) => {
      let finish!: () => void;
      const before = useProjectStore.getState().project;
      vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      render(<WelcomeScreen />);
      fireEvent.click(
        screen.getByRole("button", { name: `Create ${label} project` }),
      );
      await waitFor(() =>
        expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
      );
      expect(useProjectStore.getState().project).toBe(before);
      expect(useProjectStore.getState().getFullProject().textClips).toEqual(
        before.textClips,
      );
      expect(
        useProjectStore.getState().createNewProject,
      ).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Browse templates" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("switch", { name: "Skip on startup" }),
      ).toBeDisabled();
      await act(async () => finish());
      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith("editor"),
      );
      expect(useProjectStore.getState().project).toMatchObject({
        name: `New ${label} Video`,
        settings: { width, height, frameRate: 30 },
      });
      expect(
        useProjectStore.getState().createNewProject,
      ).toHaveBeenCalledOnce();
    },
  );
  it("reports a failed Quick Start save, retaining current work and allowing retry", async () => {
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(
      new Error("Storage full"),
    );
    render(<WelcomeScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create Square project" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage full");
    expect(useProjectStore.getState().project).toBe(before);
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Create Square project" }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("editor"));
  });
  it("does not create a stale project after leaving welcome during the save", async () => {
    let finish!: () => void;
    const before = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<WelcomeScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create Vertical project" }),
    );
    await waitFor(() =>
      expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce(),
    );
    view.unmount();
    await act(async () => finish());
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().createNewProject).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
