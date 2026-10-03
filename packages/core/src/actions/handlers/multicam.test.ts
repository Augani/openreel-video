import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";
import type { Track } from "../../types/timeline";

const track = (id: string, updates: Partial<Track> = {}): Track => ({
  id,
  type: "video",
  name: id,
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...updates,
});

const project = (): Project => ({
  id: "p",
  name: "p",
  createdAt: 0,
  modifiedAt: 0,
  settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48_000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: { tracks: [track("a"), track("b")], subtitles: [], markers: [], duration: 0 },
});

describe("multicam/applyEdit", () => {
  it("atomically replaces output, hides sources, persists metadata, and undoes", async () => {
    const value = project();
    const executor = new ActionExecutor();
    const action: Action = {
      type: "multicam/applyEdit",
      id: "apply",
      timestamp: 1,
      params: {
        outputTrack: track("output"),
        outputTrackPosition: 1,
        sourceTrackIds: ["a", "b"],
        groups: [{ id: "group", angles: [] }],
      },
    };

    expect((await executor.execute(action, value)).success).toBe(true);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["a", "output", "b"]);
    expect(value.timeline.tracks.filter((entry) => entry.id !== "output").every(
      (entry) => entry.hidden && entry.muted,
    )).toBe(true);
    expect(value.multicamGroups?.[0]?.id).toBe("group");

    expect((await executor.undo(value)).success).toBe(true);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(value.timeline.tracks.every((entry) => !entry.hidden && !entry.muted)).toBe(true);
    expect(value.multicamGroups).toEqual([]);

    expect((await executor.redo(value)).success).toBe(true);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["a", "output", "b"]);
  });

  it("rejects clips assigned to a different track", async () => {
    const value = project();
    const executor = new ActionExecutor();
    const result = await executor.execute({
      type: "multicam/applyEdit",
      id: "invalid",
      timestamp: 1,
      params: {
        outputTrack: track("output", { clips: [{ trackId: "other" }] as Track["clips"] }),
        sourceTrackIds: ["a", "b"],
        groups: [],
      },
    }, value);

    expect(result.success).toBe(false);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("owns every generated panel track in the same undo step", async () => {
    const value = project();
    const executor = new ActionExecutor();
    const result = await executor.execute({
      type: "multicam/applyEdit",
      id: "panels",
      timestamp: 1,
      params: {
        outputTracks: [track("panel-1"), track("panel-2")],
        sourceTrackIds: ["a", "b"],
        groups: [],
      },
    }, value);

    expect(result.success).toBe(true);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual([
      "panel-1", "panel-2", "a", "b",
    ]);
    await executor.undo(value);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
  it("removes obsolete panel tracks when regenerating a smaller layout and restores them on undo", async () => {
    const value = project();
    Object.assign(value.timeline, { tracks: [track("old-main"), track("old-panel"), ...value.timeline.tracks] });
    const executor = new ActionExecutor();
    expect((await executor.execute({ type: "multicam/applyEdit", id: "replace", timestamp: 1,
      params: { outputTracks: [track("old-main")], replacedOutputTrackIds: ["old-main", "old-panel"],
        sourceTrackIds: ["a", "b"], groups: [] },
    }, value)).success).toBe(true);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["old-main", "a", "b"]);
    await executor.undo(value);
    expect(value.timeline.tracks.map((entry) => entry.id)).toEqual(["old-main", "old-panel", "a", "b"]);
  });

  it("rejects locked sources and leaves the project untouched", async () => {
    const value = project();
    Object.assign(value.timeline, { tracks: [track("a", { locked: true }), track("b")] });
    const before = JSON.stringify(value);
    const result = await new ActionExecutor().execute({ type: "multicam/applyEdit", id: "locked", timestamp: 1,
      params: { outputTracks: [track("output")], sourceTrackIds: ["a", "b"], groups: [] },
    }, value);
    expect(result.success).toBe(false);
    expect(JSON.stringify(value)).toBe(before);
  });

  it("clears source solo so the output can play, and restores it on undo", async () => {
    const value = project();
    Object.assign(value.timeline, { tracks: [track("a", { solo: true }), track("b")] });
    const executor = new ActionExecutor();
    await executor.execute({ type: "multicam/applyEdit", id: "solo", timestamp: 1,
      params: { outputTracks: [track("output")], sourceTrackIds: ["a", "b"], groups: [] },
    }, value);
    expect(value.timeline.tracks.some((entry) => entry.solo)).toBe(false);
    await executor.undo(value);
    expect(value.timeline.tracks.find((entry) => entry.id === "a")?.solo).toBe(true);
  });

});
