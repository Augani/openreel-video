import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { RecoveryDialog } from "./RecoveryDialog";
import type { AutoSaveMetadata } from "../../services/auto-save";

afterEach(cleanup);

describe("RecoveryDialog", () => {
  const mockOnRecover = vi.fn();
  const mockOnDismiss = vi.fn();

  const createSave = (
    overrides: Partial<AutoSaveMetadata> = {},
  ): AutoSaveMetadata => ({
    id: "save-1",
    projectId: "project-1",
    projectName: "Test Project",
    timestamp: Date.now(),
    slot: 0,
    isRecovery: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });


  it("calls onRecover when recover button is clicked", () => {
    const saves = [createSave({ id: "save-abc" })];
    render(
      <RecoveryDialog
        saves={saves}
        onRecover={mockOnRecover}
        onDismiss={mockOnDismiss}
      />,
    );

    fireEvent.click(screen.getByText("Recover Project"));
    expect(mockOnRecover).toHaveBeenCalledWith("save-abc");
  });









  it("allows recovering older save", () => {
    const saves = [
      createSave({ id: "save-1", projectName: "Most Recent" }),
      createSave({
        id: "save-2",
        projectName: "Older Save",
        timestamp: Date.now() - 3600000,
      }),
    ];
    render(
      <RecoveryDialog
        saves={saves}
        onRecover={mockOnRecover}
        onDismiss={mockOnDismiss}
      />,
    );

    fireEvent.click(screen.getByText("1 older save available"));
    fireEvent.click(screen.getByText("Older Save"));

    expect(mockOnRecover).toHaveBeenCalledWith("save-2");
  });
});

const saves = [
  {
    id: "draft",
    projectId: "project",
    projectName: "Saved project",
    timestamp: Date.now(),
    slot: 0,
    isRecovery: true,
  },
];
describe("recovery failures", () => {
  it("reports clear failures and permits retry without dismissing existing saves", async () => {
    const clear = vi
        .fn()
        .mockRejectedValueOnce(new Error("Storage unavailable"))
        .mockResolvedValue(undefined),
      dismiss = vi.fn();
    render(
      <RecoveryDialog
        saves={[...saves, { ...saves[0], id: "older" }]}
        onRecover={vi.fn()}
        onDismiss={dismiss}
        onClearAll={clear}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all saved projects" }),
    );
    await screen.findByText("Could not clear saved projects. Try again.");
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all saved projects" }),
    );
    await waitFor(() => expect(dismiss).toHaveBeenCalledOnce());
    expect(clear).toHaveBeenCalledTimes(2);
  });
  it("blocks clear, dismiss and duplicate actions during recovery", async () => {
    let finish!: (value: boolean) => void;
    const recover = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      ),
      dismiss = vi.fn(),
      clear = vi.fn();
    render(
      <RecoveryDialog
        saves={[...saves, { ...saves[0], id: "older" }]}
        onRecover={recover}
        onDismiss={dismiss}
        onClearAll={clear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover Project" }));
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start Fresh" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Clear all saved projects" }),
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dismiss).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    await act(async () => finish(false));
    expect(
      screen.getByRole("button", { name: "Recover Project" }),
    ).toBeEnabled();
  });
  it("blocks recovery and dismissal while an actual clear callback is pending", async () => {
    let finish!: () => void;
    const clear = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
      recover = vi.fn(),
      dismiss = vi.fn();
    render(
      <RecoveryDialog
        saves={[...saves, { ...saves[0], id: "older" }]}
        onRecover={recover}
        onDismiss={dismiss}
        onClearAll={clear}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all saved projects" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear all saved projects" }),
    );
    expect(
      screen.getByRole("button", { name: "Recover Project" }),
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dismiss).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it("keeps every older save reachable while rendering at most fifty older rows", () => {
    const older = Array.from({ length: 55 }, (_, index) => ({
        ...saves[0],
        id: `older-${index}`,
        projectName: `Older ${index}`,
      })),
      recover = vi.fn();
    render(
      <RecoveryDialog
        saves={[saves[0], ...older]}
        onRecover={recover}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "55 older saves available" }),
    );
    expect(
      screen.getAllByRole("button", { name: /^Recover Older / }),
    ).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Next saves" }));
    expect(
      screen.getAllByRole("button", { name: /^Recover Older / }),
    ).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Recover Older 54" }));
    expect(recover).toHaveBeenCalledWith("older-54");
  });
  it("blocks overlapping requests and lets the user retry a failed recovery", async () => {
    let finish!: (result: boolean) => void;
    const recover = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <RecoveryDialog saves={saves} onRecover={recover} onDismiss={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Recover Saved project" }),
    );
    expect(
      screen.getByRole("button", { name: "Recovering..." }),
    ).toBeDisabled();
    expect(recover).toHaveBeenCalledOnce();
    await act(async () => finish(false));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not recover");
    fireEvent.click(screen.getByRole("button", { name: "Recover Project" }));
    expect(recover).toHaveBeenCalledTimes(2);
    await act(async () => finish(true));
  });
  it("settles thrown failures and re-enables the recovery action", async () => {
    render(
      <RecoveryDialog
        saves={saves}
        onRecover={vi.fn().mockRejectedValue(new Error("Unavailable"))}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover Project" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Try again"),
    );
    expect(
      screen.getByRole("button", { name: "Recover Project" }),
    ).toBeEnabled();
  });
});
