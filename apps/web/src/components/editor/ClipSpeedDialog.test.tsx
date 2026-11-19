// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const clip = (id: string, inPoint: number, outPoint: number, duration: number, extra: Record<string, unknown> = {}) => ({
  id,
  inPoint,
  outPoint,
  duration,
  speed: 1,
  ...extra,
});
let selected: ReturnType<typeof clip>[] = [];
const applyClipSpeedEdit = vi.fn((_edit: unknown, _ripple: boolean) => ({ success: true }) as { success: boolean; message?: string });
vi.mock("../../services/clip-speed-multi", () => ({
  selectedSpeedClips: () => selected,
  applyClipSpeedEdit: (edit: unknown, ripple: boolean) => applyClipSpeedEdit(edit, ripple),
}));
const warning = vi.fn();
vi.mock("../../stores/notification-store", () => ({ toast: { warning: (...args: unknown[]) => warning(...args) } }));

const { ClipSpeedDialog } = await import("./ClipSpeedDialog");
const { useClipSpeedDialogStore } = await import("../../stores/clip-speed-dialog-store");

const openDialog = () => {
  render(<ClipSpeedDialog />);
  act(() => useClipSpeedDialogStore.getState().setOpen(true));
};
const ok = () => screen.getByRole("button", { name: "OK" });

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useClipSpeedDialogStore.setState({ open: false });
  selected = [clip("a", 0, 4, 4)];
});

describe("Clip Speed/Duration dialog", () => {
  it("keeps OK disabled until a field changes", () => {
    openDialog();
    expect(ok()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Speed percent"), { target: { value: "200" } });
    expect(ok()).toBeEnabled();
  });

  it("applies a speed edit with ripple on by default and closes", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Speed percent"), { target: { value: "200" } });
    fireEvent.click(ok());
    expect(applyClipSpeedEdit).toHaveBeenCalledWith({ speed: 2 }, true);
    expect(useClipSpeedDialogStore.getState().open).toBe(false);
  });

  it("links duration to speed for a single clip", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "2" } });
    expect((screen.getByLabelText("Speed percent") as HTMLInputElement).value).toBe("200");
    fireEvent.click(ok());
    expect(applyClipSpeedEdit).toHaveBeenCalledWith({ duration: 2 }, true);
  });

  it("scales the combined length across a multi-selection and can turn ripple off", () => {
    selected = [clip("a", 0, 4, 4), clip("b", 0, 4, 4, { speed: 2 })];
    openDialog();
    expect(screen.getByText("Total duration")).toBeInTheDocument();
    expect((screen.getByLabelText("Speed percent") as HTMLInputElement).placeholder).toBe("Mixed");
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText(/ripple edit/i));
    fireEvent.click(ok());
    expect(applyClipSpeedEdit).toHaveBeenCalledWith({ durationScale: 4 / 8 }, false);
  });

  it("rejects an out-of-range speed", () => {
    openDialog();
    fireEvent.change(screen.getByLabelText("Speed percent"), { target: { value: "5000" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/between/i);
    expect(ok()).toBeDisabled();
  });

  it("sends reverse and pitch only when touched", () => {
    openDialog();
    fireEvent.click(screen.getByLabelText("Reverse speed"));
    fireEvent.click(screen.getByLabelText("Maintain audio pitch"));
    fireEvent.click(ok());
    expect(applyClipSpeedEdit).toHaveBeenCalledWith({ reversed: true, maintainPitch: false }, true);
  });

  it("stays open and explains a blocked edit", () => {
    applyClipSpeedEdit.mockReturnValueOnce({ success: false, message: "Unlock the target track before editing." });
    openDialog();
    fireEvent.change(screen.getByLabelText("Speed percent"), { target: { value: "50" } });
    fireEvent.click(ok());
    expect(warning).toHaveBeenCalledWith("Speed/Duration blocked", "Unlock the target track before editing.");
    expect(useClipSpeedDialogStore.getState().open).toBe(true);
  });
});
