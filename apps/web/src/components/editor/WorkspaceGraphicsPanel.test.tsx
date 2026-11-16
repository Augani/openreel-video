import "../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphicsEngine, TitleEngine } from "@openreel/core";
import type { BackgroundPreset } from "../../services/background-generator";
import { useEngineStore } from "../../stores/engine-store";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { WorkspaceGraphicsPanel } from "./WorkspaceGraphicsPanel";

const state = () => useProjectStore.getState();
const presets: BackgroundPreset[] = (["solid", "gradient", "mesh", "pattern"] as const).map(category => ({
  id: category, name: `${category} background`, category, thumbnail: "#123456",
  generate: () => document.createElement("canvas"),
}));

beforeEach(() => {
  useEngineStore.setState({ graphicsEngine: new GraphicsEngine(), titleEngine: new TitleEngine() });
  state().createNewProject("Graphics catalog preservation");
  state().actionHistory.clear();
  useTimelineStore.setState({ playheadPosition: 2.25 });
  useUIStore.getState().clearSelection();
});
afterEach(() => { cleanup(); useUIStore.getState().clearSelection(); vi.restoreAllMocks(); });

function renderPanel(generatingBackground: string | null = null) {
  const onImportBackground = vi.fn();
  const result = render(<WorkspaceGraphicsPanel backgrounds={presets} onImportBackground={onImportBackground} generatingBackground={generatingBackground} />);
  return { ...result, onImportBackground };
}

function expand() {
  fireEvent.click(screen.getByRole("button", { name: /3D.*backgrounds/ }));
}

describe("complete graphics catalog", () => {
  it("places an oriented 3D object and removes the complete insertion with one Undo/Redo", async () => {
    const track = state().project.timeline.tracks[0];
    const title = state().createTextClip(track.id, 2, "Existing title", 6)!;
    const tracksBefore = structuredClone(state().project.timeline.tracks);
    state().actionHistory.clear();
    renderPanel();
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Cube" }));
    await waitFor(() => expect(state().project.shapeClips?.[0]?.transform.rotate3d).toEqual({ x: -18, y: 28, z: 0 }));
    const created = structuredClone(state().project.shapeClips![0]);
    expect(created).toMatchObject({ shapeType: "mesh-cube", startTime: 2.25 });
    expect(useUIStore.getState().getSelectedClipIds()).toEqual([created.id]);
    await act(async () => { expect((await state().undo()).success).toBe(true); });
    expect(state().project.shapeClips ?? []).toHaveLength(0);
    expect(useEngineStore.getState().graphicsEngine?.getAllShapeClips()).toHaveLength(0);
    expect(state().project.timeline.tracks).toEqual(tracksBefore);
    expect(state().getTextClip(title.id)).toEqual(title);
    expect(state().canUndo()).toBe(false);
    await act(async () => { expect((await state().redo()).success).toBe(true); });
    expect(state().project.shapeClips).toEqual([created]);
    act(() => state().loadProject(JSON.parse(JSON.stringify(state().project))));
    expect(useEngineStore.getState().graphicsEngine?.getShapeClip(created.id)?.transform.rotate3d).toEqual({ x: -18, y: 28, z: 0 });
  });

});
