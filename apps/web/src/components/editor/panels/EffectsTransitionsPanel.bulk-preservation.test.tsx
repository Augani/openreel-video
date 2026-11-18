import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Transition } from "@openreel/core";
import { TransitionsPanel } from "./EffectsTransitionsPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";

function seedCuts() {
  const state = useProjectStore.getState();
  const track = state.project.timeline.tracks.find(t => t.name === "Main")!;
  const clips: Clip[] = Array.from({ length: 4 }, (_, i) => ({
    id: `shot-${i}`, trackId: track.id, mediaId: "source", startTime: i * 2,
    duration: 2, inPoint: 0, outPoint: 2, volume: 1, effects: [], audioEffects: [], keyframes: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: .5, y: .5 }, rotation: 0, opacity: 1 },
  }));
  useProjectStore.setState({ project: { ...state.project, timeline: { ...state.project.timeline, duration: 8,
    tracks: state.project.timeline.tracks.map(t => t.id === track.id ? { ...t, clips } : t),
  } } });
  return track.id;
}
const transitions = () => useProjectStore.getState().project.timeline.tracks.flatMap(t => t.transitions);
const applyButton = () => screen.getByRole("button", { name: "Apply Cross dissolve to all 3 cuts" });

beforeEach(() => {
  useProjectStore.getState().createNewProject("Transition workflow QA");
  useUIStore.getState().clearSelection();
  useEditorWorkspaceStore.getState().setTransitionDuration(.5);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("transition library preservation", () => {
  it("restores every cut with one Undo and Redo after bulk application", async () => {
    seedCuts();
    render(<TransitionsPanel />);
    fireEvent.click(applyButton());
    await waitFor(() => expect(transitions()).toHaveLength(3));
    await waitFor(() => expect(applyButton()).toBeEnabled());
    const saved = structuredClone(transitions());
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(transitions()).toEqual([]);
    await act(async () => { await useProjectStore.getState().redo(); });
    expect(transitions()).toEqual(saved);
  });

  it("cannot publish an old in-flight bulk edit over a same-id project reload", async () => {
    seedCuts();
    const previous = useProjectStore.getState();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const execute = previous.actionExecutor.execute.bind(previous.actionExecutor);
    const spy = vi.spyOn(previous.actionExecutor, "execute").mockImplementationOnce(async (...args) => {
      await pending;
      return execute(...args);
    });
    render(<TransitionsPanel />);
    fireEvent.click(applyButton());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const replacement = { ...previous.project, name: "Reloaded owner", timeline: { ...previous.project.timeline,
      tracks: previous.project.timeline.tracks.map(t => ({ ...t, clips: [], transitions: [] })),
    } };
    act(() => useProjectStore.getState().loadProject(replacement));
    await act(async () => { release(); await pending; });
    expect(useProjectStore.getState().project.name).toBe("Reloaded owner");
    await waitFor(() => expect(screen.getByRole("button", { name: /Apply Cross dissolve to all cuts/ })).toBeEnabled());
    expect(useProjectStore.getState().actionExecutor).not.toBe(previous.actionExecutor);
    expect(transitions()).toEqual([]);
  });

  it("restores an existing directional transition exactly when the bulk edit is undone", async () => {
    seedCuts();
    const previous: Transition = { id: "previous-wipe", type: "wipe", clipAId: "shot-0", clipBId: "shot-1",
      duration: .75, params: { direction: "right", softness: .42 } };
    await useProjectStore.getState().addClipTransition(previous);
    const before = structuredClone(transitions());
    render(<TransitionsPanel />);
    fireEvent.click(applyButton());
    await waitFor(() => expect(transitions()).toHaveLength(3));
    await waitFor(() => expect(applyButton()).toBeEnabled());
    await act(async () => { await useProjectStore.getState().undo(); });
    expect(transitions()).toEqual(before);
  });

  it("keeps cut counts and preset badges live when a published version reuses its containers", () => {
    const trackId = seedCuts();
    const original = useProjectStore.getState().project;
    const track = original.timeline.tracks.find(t => t.id === trackId)!;
    act(() => {
      (track.transitions as Transition[]).push({ id: "used", type: "wipe", clipAId: "shot-0", clipBId: "shot-1", duration: .5, params: { direction: "left", softness: 0 } });
      useProjectStore.setState({ project: { ...original } });
    });
    render(<TransitionsPanel />);
    const card = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}\\.`) });
    expect(card("Wipe left").querySelector('[aria-label="Used in timeline"]')).not.toBeNull();
    act(() => {
      const current = useProjectStore.getState().project;
      (track.transitions[0].params as { direction: string }).direction = "diagonal";
      (track.clips as Clip[]).splice(1, 1);
      useProjectStore.setState({ project: { ...current } });
    });
    expect(card("Wipe left").querySelector('[aria-label="Used in timeline"]')).toBeNull();
    expect(card("Diagonal wipe").querySelector('[aria-label="Used in timeline"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Apply Cross dissolve to the cut" })).toBeInTheDocument();
  });

  it("prevents bulk and keyboard application while an export owns the project", () => {
    const trackId = seedCuts();
    useUIStore.getState().select({ type: "clip", id: "shot-0", trackId });
    const before = useUIStore.getState().exportState;
    act(() => useUIStore.setState({ exportState: { ...before, isExporting: true } }));
    try {
      render(<TransitionsPanel />);
      expect(applyButton()).toBeDisabled();
      fireEvent.keyDown(screen.getByRole("button", { name: /^Cross dissolve\./ }), { key: "Enter" });
      expect(transitions()).toEqual([]);
    } finally {
      act(() => useUIStore.setState({ exportState: before }));
    }
  });

});
