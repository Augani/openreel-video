import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSwitcher } from "./ProjectSwitcher";

const mocks = vi.hoisted(() => ({state: {project: {id: "project", name: "Project A"}, hasOpenProject: true, forceSave: vi.fn(), createNewProject: vi.fn(), recoverFromAutoSave: vi.fn(), renameProject: vi.fn()}, check: vi.fn(), error: vi.fn()}));
vi.mock("../../stores/project-store", () => ({ useProjectStore: Object.assign(() => mocks.state, {getState: () => mocks.state}) }));
vi.mock("../../stores/notification-store", () => ({toast: {error: mocks.error}}));
vi.mock("../../services/auto-save", () => ({ autoSaveManager: { initialize: vi.fn(async () => {}), checkForRecovery: mocks.check } }));
vi.mock("./ProjectPackageDialog", () => ({ ProjectPackageDialog: () => { throw new Error("Failed to fetch dynamically imported module"); } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.clearAllMocks(); mocks.check.mockResolvedValue([]); mocks.state.forceSave.mockResolvedValue(undefined); mocks.state.recoverFromAutoSave.mockResolvedValue(true); });

describe("project menu loading", () => {
  it("saves current work before creating a new project", async () => {
    let finish!: () => void;
    mocks.state.forceSave.mockReturnValueOnce(new Promise<void>(resolve => {finish = resolve;}));
    render(<ProjectSwitcher/>);
    fireEvent.click(screen.getByRole("button", {name: "Project A"}));
    fireEvent.click(await screen.findByRole("button", {name: "New Project"}));
    expect(mocks.state.forceSave).toHaveBeenCalledOnce();
    expect(mocks.state.createNewProject).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.state.createNewProject).toHaveBeenCalledOnce();
  });
  it("keeps the current project when saving before a switch fails", async () => {
    mocks.check.mockResolvedValue([{id: "other-slot-0", projectId: "other", projectName: "Other draft", timestamp: Date.now(), slot: 0, isRecovery: true}]);
    mocks.state.forceSave.mockRejectedValueOnce(new Error("Storage full"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ProjectSwitcher/>);
    fireEvent.click(screen.getByRole("button", {name: "Project A"}));
    fireEvent.click(await screen.findByRole("button", {name: "Open Other draft"}));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.state.recoverFromAutoSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", {name: "Project A"})).toBeInTheDocument();
  });
  it("contains a failed backup dialog without unmounting the editor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<><div>Editor still available</div><ProjectSwitcher /></>);
    fireEvent.click(screen.getByRole("button", { name: "Project A" }));
    fireEvent.click(await screen.findByRole("button", { name: "Project backups" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Project backups couldn’t open");
    expect(screen.getByText("Editor still available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
