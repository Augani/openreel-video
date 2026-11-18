import "../test/install-local-storage-mock";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { TitleEngine, type Action } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEngineStore } from "../stores/engine-store";
import { EditingSession } from "./agent/editing-session";
import { addLowerThird } from "./lower-third-presets";

beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  useProjectStore.getState().createNewProject("Lower thirds QA");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("lower-third presets", () => {
  it("places both editable lines above occupied rows and restores the whole insertion with one Undo/Redo", async () => {
    const store = useProjectStore.getState();
    const titleTrack = store.project.timeline.tracks.find(
      (track) => track.type === "text",
    )!;
    const existing = store.createTextClip(
      titleTrack.id,
      0,
      "Existing title",
      10,
    )!;
    const before = useProjectStore.getState().getFullProject();
    const historySize = store.actionHistory.getUndoStackSize();
    const inserted = await addLowerThird("simple", 2);
    const result = useProjectStore.getState().getFullProject();
    const lines = inserted.map(
      ({ id }) => result.textClips!.find((clip) => clip.id === id)!,
    );
    expect(lines.map((clip) => clip.text)).toEqual([
      "Your Name",
      "Title, Company",
    ]);
    expect(
      new Set([existing.trackId, ...lines.map((clip) => clip.trackId)]).size,
    ).toBe(3);
    expect(lines.map((clip) => [clip.startTime, clip.duration])).toEqual([
      [2, 5],
      [2, 5],
    ]);
    expect(lines[0].transform.position).toEqual({ x: 0.08, y: 0.84 });
    expect(lines[1].transform.position).toEqual({ x: 0.08, y: 0.89 });
    expect(lines[0].style.fontWeight).toBe(700);
    expect(lines[1].style.fontWeight).toBe(400);
    expect(lines.map(clip => clip.style.strokeWidth)).toEqual([0, 0]);
    expect(store.actionHistory.getUndoStackSize()).toBe(historySize + 1);
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.textClips).toEqual(
      before.textClips,
    );
    expect(useProjectStore.getState().project.timeline.tracks).toEqual(
      before.timeline.tracks,
    );
    await useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.textClips).toEqual(
      result.textClips,
    );
    expect(useProjectStore.getState().project.timeline.tracks).toEqual(
      result.timeline.tracks,
    );
  });

  it("keeps the name and role label styles separate without writing to locked tracks", async () => {
    const initial = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...initial,
        timeline: {
          ...initial.timeline,
          tracks: initial.timeline.tracks.map((track) => ({
            ...track,
            locked: true,
          })),
        },
      },
    });
    const inserted = await addLowerThird("label", 4);
    const project = useProjectStore.getState().getFullProject();
    const lines = inserted.map(
      ({ id }) => project.textClips!.find((clip) => clip.id === id)!,
    );
    expect(lines.map((clip) => clip.text)).toEqual([
      "YOUR NAME",
      "Title, Company",
    ]);
    expect(lines[0].style.backgroundColor).toBe("#2bd49a");
    expect(lines[1].style.backgroundColor).toBe("#ffffff");
    expect(lines.map(clip => clip.style.strokeWidth)).toEqual([0, 0]);
    expect(
      lines.every(
        (clip) =>
          !initial.timeline.tracks.some((track) => track.id === clip.trackId),
      ),
    ).toBe(true);
    expect(
      project.timeline.tracks.filter((track) =>
        initial.timeline.tracks.some((old) => old.id === track.id),
      ),
    ).toEqual(
      initial.timeline.tracks.map((track) => ({ ...track, locked: true })),
    );
    expect(lines.every((clip) => clip.style.strokeWidth === 0)).toBe(true);
  });

  it("leaves no partial line, track or history entry when the second line fails", async () => {
    const before = useProjectStore.getState().getFullProject();
    const count = useProjectStore.getState().actionHistory.getUndoStackSize();
    const apply = EditingSession.prototype.applyAction;
    let textCreates = 0;
    vi.spyOn(EditingSession.prototype, "applyAction").mockImplementation(
      async function (this: EditingSession, action: Action) {
        if (action.type === "text/create" && ++textCreates === 2)
          throw new Error("Second line failed");
        return apply.call(this, action);
      },
    );
    await expect(addLowerThird("simple", 0)).rejects.toThrow(
      "Second line failed",
    );
    expect(useProjectStore.getState().getFullProject()).toEqual(before);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(
      count,
    );
  });

  it("cannot publish its prepared lines into a different project", async () => {
    const commit = EditingSession.prototype.commitTransaction;
    vi.spyOn(EditingSession.prototype, "commitTransaction").mockImplementation(
      async function (
        this: EditingSession,
        ...args: Parameters<EditingSession["commitTransaction"]>
      ) {
        useProjectStore.getState().createNewProject("New active project");
        return commit.apply(this, args);
      },
    );
    await expect(addLowerThird("simple", 0)).rejects.toThrow("project changed");
    expect(useProjectStore.getState().project.name).toBe("New active project");
    expect(useProjectStore.getState().project.textClips ?? []).toEqual([]);
    expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(5);
  });
});
