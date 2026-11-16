import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Marker } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { MarkersPanel } from "./MarkersPanel";

const marker = (id: string, time: number, label: string, extra: Partial<Marker> = {}): Marker => ({
  id,
  time,
  label,
  color: "#3b82f6",
  ...extra,
});

const setMarkers = (markers: Marker[]) => {
  const project = createEmptyProject("Markers");
  useProjectStore.setState({
    hasOpenProject: true,
    project: { ...project, settings: { ...project.settings, frameRate: 30 }, timeline: { ...project.timeline, markers } },
  });
};

const names = () => screen.getAllByTestId("marker-name").map((cell) => cell.textContent);

describe("MarkersPanel", () => {
  beforeEach(() => {
    useTimelineStore.setState({ playheadPosition: 0 });
    useEditorWorkspaceStore.setState({ editingMarkerId: null, selectedMarkerId: null });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setMarkers([]);
  });

  it("says when there are no markers and disables export", () => {
    setMarkers([]);
    render(<MarkersPanel />);
    expect(screen.getByTestId("markers-empty")).toBeTruthy();
    expect((screen.getByTestId("markers-export-chapters") as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists markers sorted by time with in, duration and comment", () => {
    setMarkers([
      marker("c", 9, "Outro"),
      marker("a", 1, "Intro", { comment: "Fade up music" }),
      marker("b", 4, "Range", { duration: 2 }),
    ]);
    render(<MarkersPanel />);
    expect(names()).toEqual(["Intro", "Range", "Outro"]);
    expect(screen.getAllByTestId("marker-in").map((c) => c.textContent)).toEqual(["00:00:01:00", "00:00:04:00", "00:00:09:00"]);
    expect(screen.getAllByTestId("marker-duration").map((c) => c.textContent)).toEqual(["—", "00:00:02:00", "—"]);
    expect(screen.getAllByTestId("marker-comment").map((c) => c.textContent)).toEqual(["Fade up music", "", ""]);
    expect(screen.getByTestId("markers-count").textContent).toBe("3");
  });

  it("clicking a row selects it and seeks the playhead", () => {
    setMarkers([marker("a", 1, "Intro"), marker("b", 4, "Mid")]);
    render(<MarkersPanel />);
    fireEvent.click(screen.getAllByTestId("marker-row")[1]);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(4, 6);
    expect(useEditorWorkspaceStore.getState().selectedMarkerId).toBe("b");
  });

  it("editing a name dispatches marker/update", async () => {
    setMarkers([marker("a", 1, "Intro")]);
    const execute = vi.spyOn(useProjectStore.getState().actionExecutor, "execute");
    render(<MarkersPanel />);
    fireEvent.doubleClick(screen.getByTestId("marker-row"));
    const input = screen.getByRole("textbox", { name: "Marker name" });
    fireEvent.change(input, { target: { value: "  Opening  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(execute).toHaveBeenCalled());
    const action = execute.mock.calls[0][0];
    expect(action.type).toBe("marker/update");
    expect(action.params).toEqual({ markerId: "a", updates: { label: "Opening" } });
  });

  it("saves a comment and a range length together, and rejects a bad timecode", async () => {
    setMarkers([marker("a", 1, "Intro")]);
    const execute = vi.spyOn(useProjectStore.getState().actionExecutor, "execute");
    render(<MarkersPanel />);
    fireEvent.doubleClick(screen.getByTestId("marker-row"));
    fireEvent.change(screen.getByRole("textbox", { name: "Marker comment" }), { target: { value: "Check audio" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Marker duration" }), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toMatch(/duration/);
    expect(execute).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Marker duration" }), { target: { value: "00:00:02:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].params).toEqual({ markerId: "a", updates: { comment: "Check audio", duration: 2 } });
  });

  it("Escape cancels an edit without dispatching", () => {
    setMarkers([marker("a", 1, "Intro")]);
    const execute = vi.spyOn(useProjectStore.getState().actionExecutor, "execute");
    render(<MarkersPanel />);
    fireEvent.doubleClick(screen.getByTestId("marker-row"));
    const input = screen.getByRole("textbox", { name: "Marker name" });
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Marker name" })).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(names()).toEqual(["Intro"]);
  });

  it("opens the row requested by Edit Marker", async () => {
    setMarkers([marker("a", 1, "Intro"), marker("b", 4, "Mid")]);
    render(<MarkersPanel />);
    act(() => useEditorWorkspaceStore.getState().setEditingMarkerId("b"));
    const input = await screen.findByRole("textbox", { name: "Marker name" });
    expect((input as HTMLInputElement).value).toBe("Mid");
    expect(useEditorWorkspaceStore.getState().editingMarkerId).toBeNull();
  });

  it("filters by search text, type and colour", () => {
    setMarkers([
      marker("a", 1, "Intro", { kind: "chapter" }),
      marker("b", 4, "Fix levels", { comment: "dialogue too quiet", color: "#ef4444" }),
      marker("c", 9, "Outro", { kind: "chapter", color: "#ef4444" }),
    ]);
    render(<MarkersPanel />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search markers" }), { target: { value: "QUIET" } });
    expect(names()).toEqual(["Fix levels"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Search markers" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by type" }), { target: { value: "chapter" } });
    expect(names()).toEqual(["Intro", "Outro"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by colour" }), { target: { value: "#ef4444" } });
    expect(names()).toEqual(["Outro"]);
  });

  it("deletes a row through marker/remove", async () => {
    setMarkers([marker("a", 1, "Intro")]);
    const execute = vi.spyOn(useProjectStore.getState().actionExecutor, "execute");
    render(<MarkersPanel />);
    fireEvent.click(within(screen.getByTestId("marker-row")).getByRole("button", { name: /Delete marker Intro/ }));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0]).toMatchObject({ type: "marker/remove", params: { markerId: "a" } });
  });
});
