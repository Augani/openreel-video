import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditPointStore } from "../../../stores/edit-point-store";
import { EditPointTrimEntry } from "./EditPointTrimEntry";

const mocks = vi.hoisted(() => ({
  trim: vi.fn(() => ({ success: true })),
  toggle: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("../../../services/edit-point-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/edit-point-commands")>()),
  trimSelectedEditPoint: mocks.trim,
  toggleSelectedEditPointKind: mocks.toggle,
}));
vi.mock("../../../stores/notification-store", () => ({ toast: { warning: mocks.warning } }));

beforeEach(() => {
  vi.clearAllMocks();
  useEditPointStore.getState().clear();
});

describe("EditPointTrimEntry", () => {
  it("renders nothing until an edit point is selected", () => {
    const { container } = render(<EditPointTrimEntry />);
    expect(container.firstChild).toBeNull();
    act(() => useEditPointStore.getState().set({ type: "gap", trackId: "t", start: 1, end: 2 }));
    expect(container.firstChild).toBeNull();
  });

  it("applies +N and -N frames as their own undo step and shows the edit kind", () => {
    render(<EditPointTrimEntry />);
    act(() => useEditPointStore.getState().set({ type: "edit", clipId: "a", edge: "right", kind: "roll", neighborId: "b" }));
    expect(screen.getByRole("button", { name: "Roll" })).toBeTruthy();
    const input = screen.getByLabelText("Trim selected edit point by frames");
    fireEvent.change(input, { target: { value: "-3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.trim).toHaveBeenCalledWith(-3, false);
    expect((input as HTMLInputElement).value).toBe("");
    fireEvent.change(input, { target: { value: "+5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.trim).toHaveBeenLastCalledWith(5, false);
  });

  it("rejects text that is not whole frames and toggles ripple/roll", () => {
    render(<EditPointTrimEntry />);
    act(() => useEditPointStore.getState().set({ type: "edit", clipId: "a", edge: "right", kind: "ripple", neighborId: null }));
    const input = screen.getByLabelText("Trim selected edit point by frames");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.trim).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ripple" }));
    expect(mocks.toggle).toHaveBeenCalledOnce();
  });
});
