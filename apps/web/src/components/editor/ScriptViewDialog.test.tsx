import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectSerializer, createStorageEngine } from "@openreel/core";
import { ScriptViewDialog } from "./ScriptViewDialog";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";

const incoming = createEmptyProject("Imported JSON");
const serializer = createProjectSerializer(createStorageEngine());
const content = serializer.exportToJsonWithMetadata(incoming);
beforeEach(() => {
  useProjectStore.getState().createNewProject("Current edit");
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  vi.spyOn(useProjectStore.getState(), "forceSave").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function chooseFile() {
  fireEvent.click(screen.getByRole("radio", { name: "Import" }));
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
    target: { files: [new File([content], "project.json", { type: "application/json" })] },
  });
  return screen.findByRole("button", { name: "Import Project" });
}
describe("project JSON import preservation", () => {
  it("saves current edits before importing a validated project", async () => {
    const current = useProjectStore.getState().project;
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const close = vi.fn();
    render(<ScriptViewDialog isOpen onClose={close} />);
    fireEvent.click(await chooseFile());
    await waitFor(() => expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project).toBe(current);
    await act(async () => finish());
    expect(useProjectStore.getState().project.id).toBe(incoming.id);
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the current project when saving fails", async () => {
    const current = useProjectStore.getState().project;
    vi.mocked(useProjectStore.getState().forceSave).mockRejectedValueOnce(new Error("Storage full"));
    const close = vi.fn();
    render(<ScriptViewDialog isOpen onClose={close} />);
    fireEvent.click(await chooseFile());
    expect(await screen.findByText(/Import error: Storage full/)).toBeInTheDocument();
    expect(useProjectStore.getState().project).toBe(current);
    expect(close).not.toHaveBeenCalled();
  });

  it("does not import after the dialog closes while saving", async () => {
    const current = useProjectStore.getState().project;
    let finish!: () => void;
    vi.mocked(useProjectStore.getState().forceSave).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const close = vi.fn();
    const view = render(<ScriptViewDialog isOpen onClose={close} />);
    fireEvent.click(await chooseFile());
    await waitFor(() => expect(useProjectStore.getState().forceSave).toHaveBeenCalledOnce());
    view.rerender(<ScriptViewDialog isOpen={false} onClose={close} />);
    await act(async () => finish());
    expect(useProjectStore.getState().project).toBe(current);
    expect(close).not.toHaveBeenCalled();
  });
});
