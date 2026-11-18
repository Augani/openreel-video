import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MobileProjectHome } from "./MobileProjectHome";

const mocks = vi.hoisted(() => ({
  check: vi.fn(), on: vi.fn(), off: vi.fn(), navigate: vi.fn(), error: vi.fn(),
  forceSave: vi.fn(), createNewProject: vi.fn(), recoverFromAutoSave: vi.fn(), importMedia: vi.fn(),
  openModal: vi.fn(), panel: vi.fn(), section: vi.fn(), settings: vi.fn(),
  state: { hasOpenProject: true, project: { id: "current" } },
}));
vi.mock("../../services/auto-save", () => ({ checkForRecovery: mocks.check, autoSaveManager: {on: mocks.on, off: mocks.off} }));
vi.mock("../../services/project-preview-cache", () => ({ getProjectPreview: vi.fn() }));
vi.mock("../../stores/project-store", () => ({ useProjectStore: { getState: () => ({...mocks.state, forceSave: mocks.forceSave, createNewProject: mocks.createNewProject, recoverFromAutoSave: mocks.recoverFromAutoSave, importMedia: mocks.importMedia}) } }));
vi.mock("../../stores/ui-store", () => ({ useUIStore: {getState: () => ({openModal: mocks.openModal, setPanelVisible: mocks.panel, exportState: {isExporting:false}})} }));
vi.mock("../../stores/editor-workspace-store", () => ({ useEditorWorkspaceStore: {getState: () => ({setSection: mocks.section})} }));
vi.mock("../../stores/settings-store", () => ({ useSettingsStore: Object.assign((select: (state: {settingsOpen: boolean}) => unknown) => select({settingsOpen: false}), {getState: () => ({openSettings: mocks.settings})}) }));
vi.mock("../../hooks/use-router", () => ({ useRouter: () => ({navigate: mocks.navigate}) }));
vi.mock("../../stores/notification-store", () => ({ toast: {error: mocks.error} }));
vi.mock("./TemplateGallery", () => ({ TemplateGallery: () => <p>Existing template gallery</p> }));

const draft = (id: string, timestamp = 1, name = id) => ({id: `${id}-slot-0`, projectId: id, projectName: name, timestamp, slot: 0, isRecovery: true});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {hasOpenProject: true, project: {id: "current"}};
  mocks.check.mockResolvedValue([]);
  mocks.forceSave.mockResolvedValue(undefined);
  mocks.recoverFromAutoSave.mockResolvedValue(true);
  mocks.importMedia.mockResolvedValue({success: true});
});

describe("mobile Projects", () => {
  it("shows the newest snapshot per project even when recovery records are unsorted, with real preview metadata", async () => {
    mocks.check.mockResolvedValue([draft("a", 1, "Old title"), {...draft("a", 3, "Newest title"), preview: {duration: 72, thumbnailUrl: "data:image/jpeg;base64,frame", modifiedAt: 3}}, draft("b", 2)]);
    render(<MobileProjectHome/>);
    const card = await screen.findByRole("button", {name: "Open Newest title"});
    expect(screen.queryByText("Old title")).not.toBeInTheDocument();
    expect(within(card).getByText("1:12")).toBeInTheDocument();
    expect(card.querySelector("img")?.getAttribute("src")).toContain("base64,frame");
    fireEvent.click(screen.getByRole("button", {name: "Search projects"}));
    fireEvent.change(screen.getByRole("textbox", {name: "Search drafts"}), {target: {value: "newest"}});
    expect(screen.queryByRole("button", {name: "Open b"})).not.toBeInTheDocument();
    const escaped = vi.fn();
    window.addEventListener("keydown", escaped);
    fireEvent.keyDown(screen.getByRole("textbox", {name: "Search drafts"}), {key: "Escape"});
    window.removeEventListener("keydown", escaped);
    expect(escaped).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", {name: "Search drafts"})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Open b"})).toBeInTheDocument();
  });

  it("preserves current work before recovering another project and waits for the save", async () => {
    mocks.check.mockResolvedValue([draft("other")]);
    let finish!: () => void;
    mocks.forceSave.mockReturnValueOnce(new Promise<void>(resolve => {finish = resolve;}));
    render(<MobileProjectHome/>);
    fireEvent.click(await screen.findByRole("button", {name: "Open other"}));
    expect(mocks.forceSave).toHaveBeenCalledOnce();
    expect(mocks.recoverFromAutoSave).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.recoverFromAutoSave).toHaveBeenCalledWith("other-slot-0");
    expect(mocks.navigate).toHaveBeenCalledWith("editor");
  });

  it("resumes the current live project without replacing unsaved edits with an older snapshot", async () => {
    mocks.check.mockResolvedValue([draft("current")]);
    render(<MobileProjectHome/>);
    fireEvent.click(await screen.findByRole("button", {name: "Open current"}));
    expect(mocks.forceSave).not.toHaveBeenCalled();
    expect(mocks.recoverFromAutoSave).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("editor");
  });

  it("does not replace a project after a failed save", async () => {
    mocks.check.mockResolvedValue([draft("other")]);
    mocks.forceSave.mockRejectedValueOnce(new Error("Storage full"));
    render(<MobileProjectHome/>);
    fireEvent.click(await screen.findByRole("button", {name: "Open other"}));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.recoverFromAutoSave).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("retains all three empty formats and saves current work before creating one", async () => {
    render(<MobileProjectHome/>);
    fireEvent.keyDown(screen.getByRole("button", {name: /New project Pick/}), {key: "ArrowDown", code: "ArrowDown"});
    const vertical = await screen.findByRole("menuitem", {name: "Start empty · Vertical · 9:16"});
    expect(screen.getByRole("menuitem", {name: "Start empty · Horizontal · 16:9"})).toBeInTheDocument();
    expect(screen.getByRole("menuitem", {name: "Start empty · Square · 1:1"})).toBeInTheDocument();
    fireEvent.click(vertical);
    await waitFor(() => expect(mocks.createNewProject).toHaveBeenCalledWith("New Project", {width: 1080, height: 1920, frameRate: 30}));
    expect(mocks.forceSave.mock.invocationCallOrder[0]).toBeLessThan(mocks.createNewProject.mock.invocationCallOrder[0]);
    expect(mocks.section).toHaveBeenCalledWith("media");
  });

  it("keeps picker cancellation harmless and stops queued imports after a project switch", async () => {
    render(<MobileProjectHome/>);
    const input = screen.getByLabelText("Media for a new project");
    fireEvent.change(input, {target: {files: []}});
    expect(mocks.forceSave).not.toHaveBeenCalled();
    mocks.importMedia.mockImplementationOnce(async () => { mocks.state.project.id = "switched"; return {success: true}; });
    fireEvent.change(input, {target: {files: [new File(["a"], "a.mp4"), new File(["b"], "b.mp4")]}});
    await waitFor(() => expect(mocks.importMedia).toHaveBeenCalledOnce());
    expect(mocks.importMedia.mock.calls[0][0].name).toBe("a.mp4");
  });


});
