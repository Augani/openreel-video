import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createEditorProject = vi.hoisted(() => vi.fn());
vi.mock("../../../services/project-creation", () => ({ createEditorProject }));

import { useOnboardingStore } from "../../../stores/onboarding-store";
import { CustomSequenceDialog, SEQUENCE_PRESETS } from "./CustomSequenceDialog";

beforeEach(() => {
  localStorage.clear();
  useOnboardingStore.getState().reset();
  createEditorProject.mockReset();
  createEditorProject.mockResolvedValue({ id: "proj-1" });
});
afterEach(() => cleanup());

describe("CustomSequenceDialog", () => {
  it("creates the project with the chosen width, height and fps and marks the format chosen", async () => {
    const onCreated = vi.fn();
    render(<CustomSequenceDialog onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Doc cut" } });
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "2048" } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "858" } });
    fireEvent.change(screen.getByLabelText("Frame rate"), { target: { value: "23.976" } });
    fireEvent.click(screen.getByRole("button", { name: "Create sequence" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "proj-1" }));
    expect(createEditorProject).toHaveBeenCalledTimes(1);
    expect(createEditorProject.mock.calls[0][0]).toMatchObject({
      name: "Doc cut",
      settings: { width: 2048, height: 858, frameRate: 23.976 },
    });
    expect(useOnboardingStore.getState().formatChosenProjectId).toBe("proj-1");
    expect(useOnboardingStore.getState().status).toBe("done");
  });

  it("a common preset fills width, height and frame rate", async () => {
    render(<CustomSequenceDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "4K 60" }));
    expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("3840");
    expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("2160");
    expect((screen.getByLabelText("Frame rate") as HTMLSelectElement).value).toBe("60");
    fireEvent.click(screen.getByRole("button", { name: "Create sequence" }));
    await waitFor(() => expect(createEditorProject).toHaveBeenCalled());
    expect(createEditorProject.mock.calls[0][0].settings).toEqual({ width: 3840, height: 2160, frameRate: 60 });
  });

  it("offers the planned presets", () => {
    expect(SEQUENCE_PRESETS.map((p) => p.label)).toEqual([
      "1080p 23.976", "1080p 24", "1080p 25", "1080p 30", "1080p 60", "4K 24", "4K 30", "4K 60", "2.7K 30",
    ]);
  });

  it("blocks invalid sizes", () => {
    render(<CustomSequenceDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "12" } });
    expect((screen.getByRole("button", { name: "Create sequence" }) as HTMLButtonElement).disabled).toBe(true);
    expect(createEditorProject).not.toHaveBeenCalled();
  });

  it("shows the error and leaves onboarding untouched when creation fails", async () => {
    createEditorProject.mockRejectedValue(new Error("Wait for the current operation to finish before creating a project."));
    const onCreated = vi.fn();
    render(<CustomSequenceDialog onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "Create sequence" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Wait for the current operation/);
    expect(onCreated).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().status).toBe("unseen");
  });

  it("Cancel closes without creating", () => {
    const onClose = vi.fn();
    render(<CustomSequenceDialog onClose={onClose} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(createEditorProject).not.toHaveBeenCalled();
  });
});
