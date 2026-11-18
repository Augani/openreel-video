import { describe, it, expect } from "vitest";
import { ActionExecutor } from "./action-executor";
import { ActionHistory, type AppliedActionEvent } from "./action-history";
import type { Project } from "../types/project";
import type { Action } from "../types/actions";

function makeProject(): Project {
  const clip = {
    id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
    effects: [], audioEffects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    volume: 1, keyframes: [],
  };
  return {
    id: "p1", name: "Remote", createdAt: 0, modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 5, subtitles: [], markers: [], tracks: [{ id: "t1", type: "video", name: "V1", clips: [clip], transitions: [], locked: false, hidden: false, muted: false, solo: false }] },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const act = (type: string, id: string, params: Record<string, unknown>): Action => ({ type, id, timestamp: 1, params });

describe("remote action application", () => {
  it("applyRemote edits the project without touching the undo history or emitting local events", async () => {
    const history = new ActionHistory();
    const events: AppliedActionEvent[] = [];
    history.subscribeApplied((e) => events.push(e));
    const executor = new ActionExecutor(history);
    const project = makeProject();

    const result = await executor.applyRemote(act("clip/move", "r1", { clipId: "c1", startTime: 3 }), project);

    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].startTime).toBe(3);
    expect(history.canUndo()).toBe(false);
    expect(events).toEqual([]);
  });

  it("reports a remote action whose target no longer exists as a failure, leaving the project alone", async () => {
    const executor = new ActionExecutor(new ActionHistory());
    const project = makeProject();
    const result = await executor.applyRemote(act("clip/move", "r1", { clipId: "gone", startTime: 3 }), project);
    expect(result.success).toBe(false);
    expect(project.timeline.tracks[0].clips[0].startTime).toBe(0);
  });

  it("emits edit, undo and redo events carrying the concrete actions", async () => {
    const history = new ActionHistory();
    const events: AppliedActionEvent[] = [];
    history.subscribeApplied((e) => events.push(e));
    const executor = new ActionExecutor(history);
    const project = makeProject();

    await executor.execute(act("clip/move", "e1", { clipId: "c1", startTime: 2 }), project);
    await executor.undo(project);
    await executor.redo(project);

    expect(events.map((e) => e.kind)).toEqual(["edit", "undo", "redo"]);
    expect(events[0].actions[0].id).toBe("e1");
    expect(events[1].actions[0].params).toMatchObject({ clipId: "c1", startTime: 0 });
    expect(events[2].actions[0].id).toBe("e1");
  });

  it("derives generated ids from the action id so every machine creates the same entities", async () => {
    const a = makeProject();
    const b = makeProject();
    const action = act("track/add", "same-action", { trackType: "audio" });
    await new ActionExecutor(new ActionHistory()).execute(action, a);
    await new ActionExecutor(new ActionHistory()).applyRemote(action, b);
    expect(a.timeline.tracks[1].id).toBe(b.timeline.tracks[1].id);
    expect(a.timeline.tracks[1].id).toContain("same-action");
  });

  it("discard removes a rolled-back action from both stacks", async () => {
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    const project = makeProject();
    await executor.execute(act("clip/move", "d1", { clipId: "c1", startTime: 2 }), project);
    expect(history.discard("d1")).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(history.discard("d1")).toBe(false);
  });
  it("undoing a split after a collaborator split the right half merges what is there and replicates", async () => {
    const mine = makeProject();
    const peer = makeProject();
    for (const p of [mine, peer]) (p.mediaLibrary.items as unknown[]).push({ id: "m1", type: "video", metadata: { duration: 5 } });
    const executor = new ActionExecutor(new ActionHistory());
    const events: AppliedActionEvent[] = [];
    executor.getHistory().subscribeApplied((e) => events.push(e));
    const peerExecutor = new ActionExecutor(new ActionHistory());

    const mySplit = act("clip/split", "s1", { clipId: "c1", time: 2 });
    expect((await executor.execute(mySplit, mine)).success).toBe(true);
    for (const a of events[0].actions) expect((await peerExecutor.applyRemote(a as Action, peer)).success).toBe(true);
    const rightId = mine.timeline.tracks[0].clips[1].id;

    // A collaborator splits my right half at 4.
    const theirSplit = act("clip/split", "s2", { clipId: rightId, time: 4 });
    const theirs = new ActionExecutor(new ActionHistory());
    const theirEvents: AppliedActionEvent[] = [];
    theirs.getHistory().subscribeApplied((e) => theirEvents.push(e));
    expect((await theirs.execute(theirSplit, peer)).success).toBe(true);
    for (const a of theirEvents[0].actions) expect((await peerExecutor.applyRemote(a as Action, mine)).success).toBe(true);
    expect(mine.timeline.tracks[0].clips).toHaveLength(3);

    expect((await executor.undo(mine)).success).toBe(true);
    const undo = events.at(-1)!;
    expect(undo.kind).toBe("undo");
    const shape = (p: Project) => p.timeline.tracks[0].clips.map((c) => [c.startTime, c.duration]);
    expect(shape(mine)).toEqual([[0, 4], [4, 1]]);
    // The published undo applies cleanly on the peer, which converges.
    for (const a of undo.actions) {
      const r = await peerExecutor.applyRemote(a as Action, peer);
      expect(r.error?.message).toBeUndefined();
    }
    expect(shape(peer)).toEqual(shape(mine));
  });
});
