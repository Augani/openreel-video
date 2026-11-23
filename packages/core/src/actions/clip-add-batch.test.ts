import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import { createTimelinePlacementPlanner, resolveTimelinePlacement } from "../timeline/timeline-placement";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";

const clip = (id: string, trackId: string, startTime: number, duration = 1) => ({
  id, mediaId: "m", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
  volume: 1, keyframes: [], metadata: { nested: { deep: [1, 2, 3] } },
});
function project(locked = false): Project {
  return {
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 10,
      tracks: [
        { id: "v", name: "V", type: "video", clips: [clip("a", "v", 0), clip("b", "v", 1)], transitions: [], locked: false, muted: false, solo: false, hidden: false },
        { id: "au", name: "A", type: "audio", clips: [], transitions: [], locked, muted: false, solo: false, hidden: false },
        { id: "other", name: "O", type: "video", clips: [], transitions: [], locked: false, muted: false, solo: false, hidden: false },
      ],
    },
    mediaLibrary: { items: [{ id: "m", name: "m", type: "video", metadata: { duration: 5 } }] },
  } as unknown as Project;
}
const batch = (clips: Array<{ clipId: string; trackId: string; startTime: number }>): Action =>
  ({ type: "clip/addBatch", id: "ab1", timestamp: 1, params: { clips: clips.map((c) => ({ ...c, sourceClip: clip("src", "v", 0) })) } }) as Action;
const ids = (p: Project, trackId: string) => p.timeline.tracks.find((t) => t.id === trackId)!.clips.map((c) => `${c.id}@${c.startTime}`);

describe("clip/addBatch", () => {
  it("adds many clips in one history entry, leaves untouched tracks alone, and undoes/redoes the whole batch", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const untouched = p.timeline.tracks[1];
    const result = await executor.execute(batch([{ clipId: "n1", trackId: "v", startTime: 5 }, { clipId: "n2", trackId: "other", startTime: 6 }, { clipId: "n3", trackId: "v", startTime: 7 }]), p);
    expect(result.success).toBe(true);
    expect(ids(p, "v")).toEqual(["a@0", "b@1", "n1@5", "n3@7"]);
    expect(ids(p, "other")).toEqual(["n2@6"]);
    expect(p.timeline.tracks[1]).toBe(untouched);
    expect(executor.getHistory().getUndoStackSize()).toBe(1);
    // Each added clip is its own copy (nothing shared with the source or with another added clip).
    const [n1, n3] = p.timeline.tracks[0].clips.slice(2);
    expect(n1.metadata).not.toBe(n3.metadata);

    await executor.undo(p);
    expect(ids(p, "v")).toEqual(["a@0", "b@1"]);
    expect(ids(p, "other")).toEqual([]);
    await executor.redo(p);
    expect(ids(p, "v")).toEqual(["a@0", "b@1", "n1@5", "n3@7"]);
    expect(ids(p, "other")).toEqual(["n2@6"]);
  });

  it("rejects a locked or unknown track, a taken or repeated id, a bad start or missing media without changing anything", async () => {
    const executor = new ActionExecutor();
    const p = project(true);
    expect((await executor.execute(batch([{ clipId: "n1", trackId: "v", startTime: 5 }, { clipId: "n2", trackId: "au", startTime: 5 }]), p)).success).toBe(false);
    expect((await executor.execute(batch([{ clipId: "n1", trackId: "nope", startTime: 5 }]), p)).success).toBe(false);
    expect((await executor.execute(batch([{ clipId: "a", trackId: "v", startTime: 5 }]), p)).success).toBe(false);
    expect((await executor.execute(batch([{ clipId: "n1", trackId: "v", startTime: 5 }, { clipId: "n1", trackId: "v", startTime: 6 }]), p)).success).toBe(false);
    expect((await executor.execute(batch([{ clipId: "n1", trackId: "v", startTime: -1 }]), p)).success).toBe(false);
    (p.mediaLibrary as { items: unknown[] }).items = [];
    expect((await executor.execute(batch([{ clipId: "n1", trackId: "v", startTime: 5 }]), p)).success).toBe(false);
    expect(ids(p, "v")).toEqual(["a@0", "b@1"]);
    expect(executor.getHistory().getUndoStackSize()).toBe(0);
  });
});

describe("createTimelinePlacementPlanner", () => {
  it("resolves exactly what resolveTimelinePlacement resolves against the live project, applied item by item", () => {
    const live = project();
    const planner = createTimelinePlacementPlanner(live);
    const requests = [0, 0.5, 1, 1.5, 2, 2, 2.5].map((startTime, i) => ({ targetTrackId: "v", startTime, duration: 1, policy: "stack-above" as const, newTrackId: `new-${i}` }));
    for (const request of requests) {
      const expected = resolveTimelinePlacement(live, request);
      const actual = planner.place(request);
      expect(actual).toEqual(expected);
      if (!expected.ok) continue;
      // Apply to the live project the way the one-at-a-time paste does, and reserve it in the planner.
      if (expected.createdTrack) live.timeline.tracks.splice(expected.createdTrack.position, 0, { id: expected.createdTrack.id, name: "N", type: "video", clips: [], transitions: [], locked: false, muted: false, solo: false, hidden: false } as never);
      live.timeline.tracks.find((t) => t.id === expected.trackId)!.clips.push(clip(`x${request.newTrackId}`, expected.trackId, expected.startTime, request.duration) as never);
      planner.reserve(expected, request.duration);
    }
    expect(planner.tracks.map((t) => t.id)).toEqual(live.timeline.tracks.map((t) => t.id));
  });
});
