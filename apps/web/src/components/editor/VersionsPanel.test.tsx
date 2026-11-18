import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, type Project, type ProjectVersionRecord } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { projectManager } from "../../services/project-manager";
import { setVersionBackendsForTests, type VersionBackend } from "../../services/project-versions";
import { VersionsPanel } from "./VersionsPanel";

function memoryBackend(): VersionBackend {
  const records = new Map<string, ProjectVersionRecord>();
  return {
    list: async (projectId) => [...records.values()].filter((r) => r.projectId === projectId),
    put: async (record) => void records.set(record.id, record),
    remove: async (ids) => ids.forEach((id) => records.delete(id)),
  };
}

beforeEach(() => {
  setVersionBackendsForTests([memoryBackend()]);
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: createEmptyProject("Panel"),
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    hasOpenProject: true,
  });
  vi.spyOn(projectManager, "parseProjectContent").mockImplementation(async (content: string) => JSON.parse(content) as Project);
});
afterEach(() => {
  cleanup();
  setVersionBackendsForTests(null);
  vi.restoreAllMocks();
});

describe("VersionsPanel", () => {
  it("starts empty, saves a named version and previews its metadata", async () => {
    render(<VersionsPanel />);
    expect(await screen.findByTestId("versions-empty")).toBeTruthy();
    fireEvent.change(screen.getByTestId("version-name-input"), { target: { value: "Rough cut" } });
    fireEvent.click(screen.getByTestId("version-save"));
    const row = await screen.findByTestId("version-row");
    expect(row.getAttribute("data-kind")).toBe("manual");
    expect(screen.getByTestId("version-name").textContent).toBe("Rough cut");
    expect(screen.getByTestId("versions-count").textContent).toBe("1");

    fireEvent.click(row.querySelector("button")!);
    expect(screen.getByTestId("version-detail").textContent).toContain("Frame size");
    expect(screen.getByTestId("version-restore")).toBeTruthy();
    expect(screen.getByTestId("version-restore-copy")).toBeTruthy();
  });

  it("asks before deleting a version", async () => {
    render(<VersionsPanel />);
    fireEvent.click(await screen.findByTestId("version-save"));
    const row = await screen.findByTestId("version-row");
    fireEvent.click(row.querySelector("button")!);
    fireEvent.click(screen.getByTestId("version-delete"));
    expect(screen.getByTestId("version-row")).toBeTruthy();
    fireEvent.click(screen.getByTestId("version-delete-confirm"));
    await waitFor(() => expect(screen.getByTestId("versions-empty")).toBeTruthy());
  });
});
