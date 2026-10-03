import "./test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useProjectStore } from "./stores/project-store";
import { useUIStore } from "./stores/ui-store";
import { createEmptyProject } from "./stores/project/project-helpers";
import type { AutoSaveMetadata } from "./services/auto-save";

const recovery = vi.hoisted(() => ({
  isChecking: false, showDialog: false, availableSaves: [] as AutoSaveMetadata[],
  recover: vi.fn(async (_saveId: string) => false), dismiss: vi.fn(), clearAll: vi.fn(),
}));

vi.mock("./hooks/useProjectRecovery", () => ({
  useProjectRecovery: () => recovery,
}));
vi.mock("./hooks/useKieAIPoller", () => ({ useKieAIPoller: () => undefined }));
vi.mock("./components/MobileBlocker", () => ({ MobileBlocker: () => null }));
vi.mock("./components/Toast", () => ({ ToastContainer: () => null }));
vi.mock("./components/editor/EditorInterface", () => ({ EditorInterface: () => <p>Editor</p> }));
vi.mock("./components/welcome", () => ({ WelcomeScreen: () => <p>Welcome</p> }));
vi.mock("./pages/SharePage", () => ({ SharePage: () => <p>Shared video</p> }));
vi.mock("./components/welcome/RecoveryDialog", () => ({ RecoveryDialog: ({ saves, onRecover, onDismiss }: {
  saves: AutoSaveMetadata[]; onRecover: (id: string) => void; onDismiss: () => void;
}) => <div role="dialog"><button onClick={() => onRecover(saves[0].id)}>Recover Project</button><button onClick={onDismiss}>Start Fresh</button></div> }));

const savedProject: AutoSaveMetadata = {
  id: "saved-1", projectId: "restored-project", projectName: "Vacation edit",
  timestamp: 1, slot: 0, isRecovery: true,
};

describe("new-project links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recovery.isChecking = false; recovery.showDialog = false; recovery.availableSaves = [];
    recovery.recover.mockResolvedValue(false);
    recovery.dismiss.mockImplementation(() => { recovery.showDialog = false; });
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Unopened placeholder") });
    useUIStore.setState({ skipWelcomeScreen: false, activeModal: null });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ""; });

  it.each([
    ["#/new?dimensions=1920x1080&fps=24", 1920, 1080, 24],
    ["#/new?preset=youtube-video&fps=60", 1920, 1080, 60],
    ["#/new?preset=youtube-video", 1920, 1080, 30],
  ])("honors explicit frame rates in %s", async (hash, width, height, frameRate) => {
    window.location.hash = String(hash);
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    render(<App />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.any(String), { width, height, frameRate });
    expect(useProjectStore.getState().hasOpenProject).toBe(true);
  });

  it("opens a real fresh project for a bare editor URL once recovery checking settles", async () => {
    window.location.hash = "#/editor"; recovery.isChecking = true;
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(create).not.toHaveBeenCalled(); expect(view.queryByText("Editor")).toBeNull();
    recovery.isChecking = false; view.rerender(<App />);
    await waitFor(() => expect(useProjectStore.getState().hasOpenProject).toBe(true));
    expect(create).toHaveBeenCalledOnce();
    expect(await view.findByText("Editor")).toBeInTheDocument();
    view.rerender(<App />);
    expect(create).toHaveBeenCalledOnce();
  });

  it("waits for the recovery choice and starts fresh without deleting snapshots", async () => {
    window.location.hash = "#/editor"; recovery.showDialog = true;
    recovery.availableSaves = [savedProject];
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(create).not.toHaveBeenCalled(); expect(view.queryByText("Editor")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Start Fresh" })); view.rerender(<App />);
    await waitFor(() => expect(useProjectStore.getState().hasOpenProject).toBe(true));
    expect(create).toHaveBeenCalledOnce();
    expect(recovery.clearAll).not.toHaveBeenCalled();
    expect(recovery.availableSaves).toEqual([savedProject]);
    expect(await view.findByText("Editor")).toBeInTheDocument();
  });

  it("preserves explicit dimensions and frame rate when starting fresh after a recovery choice", async () => {
    window.location.hash = "#/new?dimensions=1080x1920&fps=24";
    recovery.isChecking = true;
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(create).not.toHaveBeenCalled();
    recovery.isChecking = false; recovery.showDialog = true; recovery.availableSaves = [savedProject];
    view.rerender(<App />);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Start Fresh" })); view.rerender(<App />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1080, height: 1920, frameRate: 24 });
    expect(await view.findByText("Editor")).toBeInTheDocument();
  });

  it("keeps the recovered project instead of replacing it with a pending new-project link", async () => {
    window.location.hash = "#/new?dimensions=1920x1080&fps=24";
    recovery.showDialog = true; recovery.availableSaves = [savedProject];
    const restored = { ...createEmptyProject("Vacation edit", { width: 720, height: 1280, frameRate: 60 }), id: savedProject.projectId };
    recovery.recover.mockImplementation(async () => {
      useProjectStore.setState({ hasOpenProject: true, project: restored });
      recovery.showDialog = false;
      return true;
    });
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Recover Project" })); });
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(useProjectStore.getState().project).toBe(restored);
    expect(create).not.toHaveBeenCalled();
  });

  it("allows the original new-project choice after recovery fails", async () => {
    window.location.hash = "#/new?dimensions=1080x1080&fps=60";
    recovery.showDialog = true; recovery.availableSaves = [savedProject];
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Recover Project" })); });
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Start Fresh" })); view.rerender(<App />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1080, height: 1080, frameRate: 60 });
    expect(recovery.clearAll).not.toHaveBeenCalled();
  });

  it("preserves an already open project at a bare editor URL", async () => {
    window.location.hash = "#/editor";
    const opened = createEmptyProject("Already open");
    useProjectStore.setState({ hasOpenProject: true, project: opened });
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled(); expect(useProjectStore.getState().project).toBe(opened);
  });

  it.each(["#/welcome", "#/templates", "#/recent", "#/share/video-1"])("does not create an editor project for %s", async (hash) => {
    window.location.hash = hash;
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(await view.findByText(hash.startsWith("#/share") ? "Shared video" : "Welcome")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled(); expect(useProjectStore.getState().hasOpenProject).toBe(false);
  });
});
