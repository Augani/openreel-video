import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";

vi.mock("../../services/background-task-sources", () => ({ startBackgroundTaskSources: () => () => undefined }));

import { BackgroundTasksIndicator } from "./BackgroundTasksPanel";

afterEach(() => {
  act(() => backgroundTasks.clearFinished());
  for (const t of backgroundTasks.getSnapshot()) backgroundTasks.remove(t.id);
});

describe("BackgroundTasksIndicator", () => {
  it("counts active tasks in the status bar and loads the list on first open", async () => {
    render(<BackgroundTasksIndicator />);
    expect(screen.getByTestId("background-tasks-badge")).toHaveTextContent("Idle");
    expect(screen.queryByTestId("background-task-row")).toBeNull();

    const cancel = vi.fn();
    act(() => {
      backgroundTasks.upsert({ id: "t:1", kind: "render", source: "t", title: "Audio plugin render", status: "running", progress: 0.5, etaMs: 65_000 }, { cancel });
      backgroundTasks.upsert({ id: "t:2", kind: "analysis", source: "t", title: "Speaker detection", status: "failed", error: "No speech" }, { retry: vi.fn() });
    });
    expect(screen.getByTestId("background-tasks-badge")).toHaveAttribute("data-count", "1");

    fireEvent.click(screen.getByTestId("background-tasks-button"));
    const rows = await screen.findAllByTestId("background-task-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("50%");
    expect(rows[0]).toHaveTextContent("1m 05s left");
    expect(screen.getByRole("progressbar", { name: /Audio plugin render progress/ })).toHaveAttribute("aria-valuenow", "50");
    expect(rows[1]).toHaveTextContent("No speech");

    fireEvent.click(screen.getByRole("button", { name: "Cancel Audio plugin render" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry Speaker detection" })).toBeEnabled();
  });
});
