import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectSerializer, createStorageEngine } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { ScriptViewDialog } from "./ScriptViewDialog";

class ControlledReader {
  static instances: ControlledReader[] = [];
  onload: ((event: ProgressEvent<FileReader>) => unknown) | null = null;
  onerror: (() => unknown) | null = null;
  aborted = false;
  constructor() {
    ControlledReader.instances.push(this);
  }
  readAsText() {}
  abort() {
    this.aborted = true;
  }
  finish(result: string) {
    this.onload?.({
      target: { result },
    } as unknown as ProgressEvent<FileReader>);
  }
}
const snapshot = (name: string) =>
  createProjectSerializer(createStorageEngine()).exportToJsonWithMetadata(
    createEmptyProject(name),
    "Import workflow fixture",
  );
function pick(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Project file picker is not mounted");
  fireEvent.change(input, {
    target: {
      files: [
        new File(["pending"], name, {
          type: name.endsWith(".json") ? "application/json" : "text/plain",
        }),
      ],
    },
  });
  return ControlledReader.instances.at(-1)!;
}
beforeEach(() => {
  ControlledReader.instances = [];
  vi.stubGlobal("FileReader", ControlledReader);
  useProjectStore.setState({
    project: createEmptyProject("Current project"),
    hasOpenProject: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Project JSON file ownership", () => {
  it("blocks an older validated draft while its replacement is pending or unreadable", () => {
    render(<ScriptViewDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Import" }));
    act(() =>
      pick("first.json").finish(snapshot("Previously validated project")),
    );
    expect(
      screen.getByRole("button", { name: "Import Project" }),
    ).not.toBeDisabled();
    const replacement = pick("replacement.json");
    expect(
      screen.queryByRole("button", { name: "Import Project" }),
    ).not.toBeInTheDocument();
    act(() => {
      replacement.onerror?.();
    });
    expect(
      screen.getByText("Could not read this JSON file"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import Project" }),
    ).not.toBeInTheDocument();
    expect(useProjectStore.getState().project.name).toBe("Current project");
  });
  it("keeps the latest selected file when an older read finishes last", () => {
    render(<ScriptViewDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Import" }));
    const older = pick("older.json"),
      latest = pick("latest.json");
    expect(older.aborted).toBe(true);
    const next = snapshot("Latest selected file");
    act(() => latest.finish(next));
    expect(
      screen.getByText(`${next.length.toLocaleString()} characters loaded`),
    ).toBeInTheDocument();
    act(() =>
      older.finish(
        snapshot("Outdated file with a deliberately different name length"),
      ),
    );
    expect(
      screen.getByText(`${next.length.toLocaleString()} characters loaded`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import Project" }),
    ).not.toBeDisabled();
    expect(useProjectStore.getState().project.name).toBe("Current project");
  });
  it("keeps an invalid replacement blocked after an older valid read completes", () => {
    render(<ScriptViewDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Import" }));
    const older = pick("older.json");
    pick("replacement.txt");
    expect(older.aborted).toBe(true);
    act(() => older.finish(snapshot("Earlier valid project")));
    expect(screen.getByText("Please upload a .json file")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import Project" }),
    ).not.toBeInTheDocument();
    expect(useProjectStore.getState().project.name).toBe("Current project");
  });
  it("does not restore a pending file after the dialog closes and reopens", () => {
    const close = vi.fn();
    const view = render(<ScriptViewDialog isOpen onClose={close} />);
    fireEvent.click(screen.getByRole("radio", { name: "Import" }));
    const pending = pick("pending.json");
    view.rerender(<ScriptViewDialog isOpen={false} onClose={close} />);
    expect(pending.aborted).toBe(true);
    view.rerender(<ScriptViewDialog isOpen onClose={close} />);
    act(() => pending.finish(snapshot("Closed reader result")));
    expect(screen.queryByText(/characters loaded/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Import Project" }),
    ).not.toBeInTheDocument();
  });
});
