import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Clip, Transition } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { TransitionInspector } from "./TransitionInspector";

afterEach(cleanup);
const clip = (id: string, trackId: string, startTime: number): Clip => ({ id, trackId, startTime, mediaId: `media-${id}`, duration: 4, inPoint: 0, outPoint: 4,
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
  volume: 1, effects: [], audioEffects: [], keyframes: [] });

it("applies to every eligible cut as one real undoable operation, preserving locked tracks and gaps", async () => {
  const project = createEmptyProject("Transition bulk QA", undefined, true);
  const main = project.timeline.tracks.find(track => track.name === "Main")!;
  const locked = project.timeline.tracks.find(track => track.name === "B-roll")!;
  const clips = [clip("a", main.id, 0), clip("b", main.id, 4), clip("c", main.id, 8), clip("d", main.id, 12), clip("after-gap", main.id, 20)];
  const selected: Transition = { id: "selected", clipAId: "a", clipBId: "b", type: "crossfade", duration: 0.8, params: { curve: "ease", audioFade: true } };
  const previous: Transition = { id: "previous", clipAId: "b", clipBId: "c", type: "dipToBlack", duration: 0.4, params: { holdDuration: 0.1 } };
  const lockedClips = [clip("locked-a", locked.id, 0), clip("locked-b", locked.id, 4)];
  const lockedTransition: Transition = { id: "locked-transition", clipAId: "locked-a", clipBId: "locked-b", type: "zoom", duration: 1, params: { scale: 2 } };
  useProjectStore.getState().loadProject({ ...project, timeline: { ...project.timeline, duration: 24, tracks: project.timeline.tracks.map(track => track.id === main.id ? { ...track, clips, transitions: [selected, previous] } : track.id === locked.id ? { ...track, locked: true, clips: lockedClips, transitions: [lockedTransition] } : track) } });
  const history = useProjectStore.getState().actionHistory; history.clear();
  const allTransitions = () => useProjectStore.getState().project.timeline.tracks.flatMap(track => track.transitions);
  const original = structuredClone(allTransitions());
  render(<TransitionInspector clipA={clips[0]} clipB={clips[1]} transition={selected} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply to all cuts" })); });
  await waitFor(() => expect(useProjectStore.getState().project.timeline.tracks.find(track => track.id === main.id)?.transitions).toHaveLength(3));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply to all cuts" })).toBeEnabled());
  const applied = structuredClone(allTransitions());
  for (const transition of applied.filter(t => t.id !== lockedTransition.id))
    expect(transition).toMatchObject({ type: "crossfade", duration: 0.8, params: { curve: "ease", audioFade: true } });
  expect(applied.find(t => t.id === lockedTransition.id)).toEqual(lockedTransition);
  expect(applied.some(t => t.clipBId === "after-gap")).toBe(false);
  expect(history.getUndoStackSize()).toBe(3);
  expect(history.getDisplayHistory()).toHaveLength(1);
  await act(async () => { await useProjectStore.getState().undo(); });
  expect(allTransitions()).toEqual(original);
  await act(async () => { await useProjectStore.getState().redo(); });
  expect(allTransitions()).toEqual(applied);
});
