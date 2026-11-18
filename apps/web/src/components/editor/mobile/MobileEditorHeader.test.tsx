import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MobileEditorHeader } from "./MobileEditorHeader";

const mocks = vi.hoisted(() => ({save: vi.fn(), navigate: vi.fn(), error: vi.fn()}));
vi.mock("../../../stores/project-store", () => ({useProjectStore: Object.assign((select: (state: unknown) => unknown) => select({project: {name: "Golden Hour", settings: {width: 1920, height: 1080, frameRate: 30}}}), {getState: () => ({forceSave: mocks.save})})}));
vi.mock("../../../hooks/use-router", () => ({useRouter: () => ({navigate: mocks.navigate})}));
vi.mock("../../../stores/notification-store", () => ({toast: {error: mocks.error}}));
vi.mock("../WorkspaceSaveStatus", () => ({WorkspaceSaveStatus: () => <span>Saved</span>}));
vi.mock("../ProjectSwitcher", () => ({ProjectSwitcher: ({trigger, menuContent}: {trigger: React.ReactNode; menuContent: React.ReactNode}) => <>{trigger}{menuContent}</>}));
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(undefined); });
describe("mobile editor header", () => {
  it("waits for a successful save before returning to Projects", async () => {
    let finish!: () => void;
    mocks.save.mockReturnValueOnce(new Promise<void>(resolve => {finish = resolve;}));
    render(<MobileEditorHeader onAI={() => {}} onExport={() => {}} menu={<span>Editing menu retained</span>}/>);
    fireEvent.click(screen.getByRole("button", {name: "Back to projects"}));
    expect(screen.getByRole("button", {name: "Back to projects"})).toBeDisabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.navigate).toHaveBeenCalledWith("recent");
  });
  it("keeps the editor open after a failed save and retains the AI/export/menu entry points", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Storage full"));
    const ai = vi.fn(), exported = vi.fn();
    render(<MobileEditorHeader onAI={ai} onExport={exported} menu={<span>Editing menu retained</span>}/>);
    fireEvent.click(screen.getByRole("button", {name: "Back to projects"}));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "AI assist"}));
    fireEvent.click(screen.getByRole("button", {name: "Export"}));
    expect(ai).toHaveBeenCalledOnce(); expect(exported).toHaveBeenCalledOnce();
    expect(screen.getByText("Editing menu retained")).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Project menu"})).toHaveTextContent("Golden Hour1080p · 30 fps · Saved");
  });
});
