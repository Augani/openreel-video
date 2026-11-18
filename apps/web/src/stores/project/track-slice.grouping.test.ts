import "../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../project-store";
import { createEmptyProject } from "./project-helpers";
const state = () => useProjectStore.getState();
const groups = () => state().project.timeline.tracks.map(track => track.groupId);
beforeEach(() => {
  const project = createEmptyProject("Grouping");
  const track = { type: "video" as const, clips: [], transitions: [], hidden: false, locked: false, muted: false, solo: false };
  useProjectStore.setState({ project: { ...project, textClips: [], shapeClips: [], svgClips: [], stickerClips: [], timeline: { ...project.timeline,
    tracks: ["a", "b", "c", "d", "untouched"].map(id => ({ ...track, id, name: id })),
  } } });
  state().actionHistory.clear();
});
describe("track grouping history", () => {
  it("merges two groups and restores both with one Undo and Redo", async () => {
    state().groupTracks("a", "b");
    state().groupTracks("c", "d");
    const before = structuredClone(state().project);
    const beforeGroups = groups();
    state().actionHistory.clear();
    state().groupTracks("a", "c");
    expect(groups().slice(0, 4).every(id => id === groups()[0])).toBe(true);
    expect(groups()[4]).toBeUndefined();
    await state().undo();
    expect(groups()).toEqual(beforeGroups);
    expect({ ...state().project, modifiedAt: before.modifiedAt }).toEqual(before);
    expect(state().canUndo()).toBe(false);
    await state().redo();
    expect(groups().slice(0, 4).every(id => id === groups()[0])).toBe(true);
  });
  it("ungroups both members of a pair and preserves the rest of a larger group", async () => {
    state().groupTracks("a", "b");
    const group = groups()[0];
    state().actionHistory.clear();
    state().groupTracks("a");
    expect(groups().slice(0, 2)).toEqual([undefined, undefined]);
    await state().undo();
    expect(groups().slice(0, 2)).toEqual([group, group]);
    state().groupTracks("a", "c");
    state().actionHistory.clear();
    state().groupTracks("a");
    expect(groups().slice(0, 3)).toEqual([undefined, group, group]);
    await state().undo();
    expect(groups().slice(0, 3)).toEqual([group, group, group]);
  });
  it("does not create history for nonexistent tracks or unchanged grouping", () => {
    expect(state().groupTracks("missing", "a")).toBe(false);
    expect(state().groupTracks("a", "missing")).toBe(false);
    expect(state().groupTracks("a", "a")).toBe(false);
    expect(state().groupTracks("a")).toBe(true);
    expect(state().canUndo()).toBe(false);
    state().groupTracks("a", "b");
    state().actionHistory.clear();
    state().groupTracks("a", "b");
    expect(state().canUndo()).toBe(false);
  });
});
