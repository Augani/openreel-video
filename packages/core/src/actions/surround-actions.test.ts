import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory } from "./action-history";
import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import { layoutSettingsPatch } from "../audio/surround";

const clip = (id: string): Clip =>
  ({
    id,
    mediaId: "m",
    trackId: "t1",
    startTime: 0,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    effects: [],
    audioEffects: [],
    transform: {} as Clip["transform"],
    volume: 1,
    keyframes: [],
  }) as Clip;

const makeProject = (): Project => ({
  id: "p",
  name: "Surround",
  createdAt: 1,
  modifiedAt: 1,
  settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: {
    tracks: [
      { id: "t1", type: "audio", name: "A1", clips: [clip("c1")], transitions: [], locked: false, hidden: false, muted: false, solo: false } as Track,
    ],
    subtitles: [],
    markers: [],
    duration: 2,
  },
});

describe("5.1 sequence layout is an undoable project setting", () => {
  it("switches to 5.1 (six channels) and back, one undo step each", async () => {
    const project = makeProject();
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    const result = await executor.execute({ type: "project/updateSettings", id: "l1", timestamp: 2, params: layoutSettingsPatch("5.1") }, project);
    expect(result.success).toBe(true);
    expect(project.settings.channelLayout).toBe("5.1");
    expect(project.settings.channels).toBe(6);
    expect(history.getUndoStackSize()).toBe(1);
    await executor.undo(project);
    expect(project.settings.channelLayout).toBeUndefined();
    expect(project.settings.channels).toBe(2);
    await executor.redo(project);
    expect(project.settings.channelLayout).toBe("5.1");
    expect(project.settings.channels).toBe(6);
  });
});

describe("audio/setSurroundPan", () => {
  const pan = { x: -0.5, y: 0.25, divergence: 0.4, lfeSend: 0.2 };

  it("sets a clip position, undoes and redoes it", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    const result = await executor.execute({ type: "audio/setSurroundPan", id: "s1", timestamp: 2, params: { clipId: "c1", pan } }, project);
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(project.timeline.tracks[0].clips[0].surroundPan).toEqual(pan);
    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].surroundPan).toBeUndefined();
    await executor.redo(project);
    expect(project.timeline.tracks[0].clips[0].surroundPan).toEqual(pan);
  });

  it("sets a track position and restores the previous one on undo", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    await executor.execute({ type: "audio/setSurroundPan", id: "s1", timestamp: 2, params: { trackId: "t1", pan } }, project);
    const other = { x: 1, y: -1, divergence: 0, lfeSend: 0 };
    await new Promise((resolve) => setTimeout(resolve, 130)); // a separate edit, not part of one drag
    await executor.execute({ type: "audio/setSurroundPan", id: "s2", timestamp: 3, params: { trackId: "t1", pan: other } }, project);
    expect(project.timeline.tracks[0].surroundPan).toEqual(other);
    await executor.undo(project);
    expect(project.timeline.tracks[0].surroundPan).toEqual(pan);
    await executor.undo(project);
    expect(project.timeline.tracks[0].surroundPan).toBeUndefined();
  });

  it("clamps out-of-range positions and clears with null", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    await executor.execute({ type: "audio/setSurroundPan", id: "s1", timestamp: 2, params: { clipId: "c1", pan: { x: 9, y: -9, divergence: 3, lfeSend: -1 } } }, project);
    expect(project.timeline.tracks[0].clips[0].surroundPan).toEqual({ x: 1, y: -1, divergence: 1, lfeSend: 0 });
    await executor.execute({ type: "audio/setSurroundPan", id: "s2", timestamp: 3, params: { clipId: "c1", pan: null } }, project);
    expect(project.timeline.tracks[0].clips[0].surroundPan).toBeUndefined();
  });

  it("rejects an unknown target and an ambiguous one", async () => {
    const project = makeProject();
    const executor = new ActionExecutor(new ActionHistory());
    const missing = await executor.execute({ type: "audio/setSurroundPan", id: "s1", timestamp: 2, params: { clipId: "nope", pan } }, project);
    expect(missing.success).toBe(false);
    const both = await executor.execute({ type: "audio/setSurroundPan", id: "s2", timestamp: 3, params: { clipId: "c1", trackId: "t1", pan } }, project);
    expect(both.success).toBe(false);
  });

  it("coalesces the rapid calls of one puck drag into a single undo step", async () => {
    const project = makeProject();
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    for (let i = 0; i < 5; i++) {
      await executor.execute({ type: "audio/setSurroundPan", id: `d${i}`, timestamp: 10 + i, params: { clipId: "c1", pan: { ...pan, x: i / 10 } } }, project);
    }
    // Five history entries share one group: a single undo takes the whole drag back.
    const groups = new Set(history.getHistoryEntries().map((entry) => entry.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeDefined();
    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].surroundPan).toBeUndefined();
  });
});
