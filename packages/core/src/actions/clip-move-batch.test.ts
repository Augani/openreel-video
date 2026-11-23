import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";

const clip = (id: string, trackId: string, startTime: number) => ({
  id, mediaId: "m", trackId, startTime, duration: 1, inPoint: 0, outPoint: 1, effects: [], audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
  volume: 1, keyframes: [],
});
function project(locked = false): Project {
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 10,
      tracks: [
        { id: "v", name: "V", type: "video", clips: [clip("a", "v", 0), clip("b", "v", 1), clip("c", "v", 2)], transitions: [], locked: false, muted: false, solo: false, hidden: false },
        { id: "au", name: "A", type: "audio", clips: [clip("d", "au", 0)], transitions: [], locked, muted: false, solo: false, hidden: false },
        { id: "other", name: "O", type: "video", clips: [], transitions: [], locked: false, muted: false, solo: false, hidden: false },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}
const batch = (moves: Array<{ clipId: string; startTime: number; trackId?: string }>): Action =>
  ({ type: "clip/moveBatch", id: "b1", timestamp: 1, params: { moves } }) as Action;
const starts = (p: Project) => Object.fromEntries(p.timeline.tracks.flatMap((t) => t.clips.map((c) => [c.id, `${t.id}@${c.startTime}`])));

describe("clip/moveBatch", () => {
  it("moves many clips in one history entry and undoes/redoes them", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const untouched = p.timeline.tracks[2];
    const result = await executor.execute(batch([{ clipId: "a", startTime: 5 }, { clipId: "b", startTime: 6 }, { clipId: "d", startTime: 5 }]), p);
    expect(result.success).toBe(true);
    expect(starts(p)).toEqual({ a: "v@5", b: "v@6", c: "v@2", d: "au@5" });
    // Slots keep their order; tracks without a moved clip keep their identity.
    expect(p.timeline.tracks[0].clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(p.timeline.tracks[2]).toBe(untouched);
    expect(executor.getHistory().getUndoStackSize()).toBe(1);

    await executor.undo(p);
    expect(starts(p)).toEqual({ a: "v@0", b: "v@1", c: "v@2", d: "au@0" });
    await executor.redo(p);
    expect(starts(p)).toEqual({ a: "v@5", b: "v@6", c: "v@2", d: "au@5" });
  });

  it("moves a clip to another track and back on undo", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const result = await executor.execute(batch([{ clipId: "a", startTime: 3, trackId: "other" }, { clipId: "b", startTime: 4 }]), p);
    expect(result.success).toBe(true);
    expect(starts(p)).toEqual({ a: "other@3", b: "v@4", c: "v@2", d: "au@0" });
    await executor.undo(p);
    expect(starts(p)).toEqual({ a: "v@0", b: "v@1", c: "v@2", d: "au@0" });
  });

  it("rejects a batch touching a locked track, an unknown clip, a duplicate or a negative start without changing anything", async () => {
    const executor = new ActionExecutor();
    const locked = project(true);
    expect((await executor.execute(batch([{ clipId: "a", startTime: 5 }, { clipId: "d", startTime: 5 }]), locked)).success).toBe(false);
    const p = project();
    expect((await executor.execute(batch([{ clipId: "a", startTime: 5 }, { clipId: "nope", startTime: 5 }]), p)).success).toBe(false);
    expect((await executor.execute(batch([{ clipId: "a", startTime: 5 }, { clipId: "a", startTime: 6 }]), p)).success).toBe(false);
    expect((await executor.execute(batch([{ clipId: "a", startTime: -1 }]), p)).success).toBe(false);
    expect(starts(p)).toEqual({ a: "v@0", b: "v@1", c: "v@2", d: "au@0" });
    expect(executor.getHistory().getUndoStackSize()).toBe(0);
  });
});

describe("clip/removeBatch", () => {
  it("removes many clips in one entry and restores them at their original positions on undo", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const untouched = p.timeline.tracks[2];
    const result = await executor.execute(
      { type: "clip/removeBatch", id: "r1", timestamp: 1, params: { clipIds: ["a", "c", "d"] } } as Action,
      p,
    );
    expect(result.success).toBe(true);
    expect(starts(p)).toEqual({ b: "v@1" });
    expect(p.timeline.tracks[2]).toBe(untouched);
    expect(executor.getHistory().getUndoStackSize()).toBe(1);
    await executor.undo(p);
    expect(p.timeline.tracks[0].clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(p.timeline.tracks[1].clips.map((c) => c.id)).toEqual(["d"]);
    await executor.redo(p);
    expect(starts(p)).toEqual({ b: "v@1" });
  });

  it("rejects locked tracks and unknown clips", async () => {
    const executor = new ActionExecutor();
    const lockedProject = project(true);
    const remove = (ids: string[]) => ({ type: "clip/removeBatch", id: "r", timestamp: 1, params: { clipIds: ids } }) as Action;
    expect((await executor.execute(remove(["a", "d"]), lockedProject)).success).toBe(false);
    expect((await executor.execute(remove(["a", "zzz"]), project())).success).toBe(false);
    expect(executor.getHistory().getUndoStackSize()).toBe(0);
  });
});
