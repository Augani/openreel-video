import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MasterPasswordDialog } from "./MasterPasswordDialog";
afterEach(cleanup);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });

describe("master-password form preservation", () => {
  it("validates setup length and matching confirmation before submitting", async () => {
    const submit = vi.fn().mockResolvedValue(true); render(<MasterPasswordDialog isOpen mode="setup" onClose={vi.fn()} onSubmit={submit} />);
    fill("Password", "short"); fill("Confirm Password", "short"); fireEvent.click(screen.getByRole("button", { name: "Set Password" })); expect(screen.getByRole("alert")).toHaveTextContent("at least 8");
    fill("Password", "fixture-password"); fireEvent.click(screen.getByRole("button", { name: "Set Password" })); expect(screen.getByRole("alert")).toHaveTextContent("do not match"); expect(submit).not.toHaveBeenCalled();
    fill("Confirm Password", "fixture-password"); fireEvent.click(screen.getByRole("button", { name: "Set Password" })); await waitFor(() => expect(submit).toHaveBeenCalledWith("fixture-password", undefined));
    await waitFor(() => expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(""));
  });
  it("retains change-password arguments and separately masks current/new passwords", async () => {
    const submit = vi.fn().mockResolvedValue(false); render(<MasterPasswordDialog isOpen mode="change" onClose={vi.fn()} onSubmit={submit} />);
    fill("Current Password", "current-fixture"); fill("New Password", "replacement-fixture"); fill("Confirm New Password", "replacement-fixture");
    fireEvent.click(screen.getByRole("button", { name: "Show current password" })); expect(screen.getByLabelText("Current Password")).toHaveAttribute("type", "text"); expect(screen.getByLabelText("New Password", { exact: true })).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Change Password" })); await waitFor(() => expect(submit).toHaveBeenCalledWith("current-fixture", "replacement-fixture")); expect(await screen.findByRole("alert")).toHaveTextContent("Operation failed");
  });
  it("prevents duplicate submissions and dismissal while a request is pending", async () => {
    let finish!: (success: boolean) => void; const submit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })), close = vi.fn();
    render(<MasterPasswordDialog isOpen mode="unlock" onClose={close} onSubmit={submit} />); fill("Master Password", "fixture-password"); const form = screen.getByLabelText("Master Password").closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form); expect(submit).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Close" })).toBeDisabled(); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(close).not.toHaveBeenCalled();
    await act(async () => finish(false)); expect(screen.getByRole("alert")).toHaveTextContent("Incorrect password"); expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
  it("clears credentials across close/reopen and ignores a stale response from the previous mode", async () => {
    let finish!: (success: boolean) => void; const submit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const view = render(<MasterPasswordDialog isOpen mode="unlock" onClose={vi.fn()} onSubmit={submit} />); fill("Master Password", "fixture-password"); fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    view.rerender(<MasterPasswordDialog isOpen mode="setup" onClose={vi.fn()} onSubmit={submit} />); expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(""); await act(async () => finish(false)); expect(screen.queryByRole("alert")).toBeNull();
    fill("Password", "new-draft"); view.rerender(<MasterPasswordDialog isOpen={false} mode="setup" onClose={vi.fn()} onSubmit={submit} />); view.rerender(<MasterPasswordDialog isOpen mode="setup" onClose={vi.fn()} onSubmit={submit} />); expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
  });
});
