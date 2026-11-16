import { describe, it, expect } from "vitest";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import { ActionHistory } from "@openreel/core/actions/action-history";
import type { Project } from "@openreel/core/types/project";
import type { Action } from "@openreel/core/types/actions";
import { CollabEngine, type CollabHost, type CollabNotice } from "./client-engine";
import { LoopbackHub } from "./testing";

/**
 * Two (or three) real editors, each with its own project, ActionExecutor and
 * undo history, joined through the real RoomCore over an in-process transport.
 */

function makeProject(): Project {
  const clip = (id: string, trackId: string, start: number) => ({
    id,
    mediaId: "m1",
    trackId,
    startTime: start,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    volume: 1,
    keyframes: [],
  });
  const track = (id: string, clips: unknown[]) => ({ id, type: "video", name: id, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false });
  return {
    id: "p1",
    name: "Shared",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 20, subtitles: [], markers: [], tracks: [track("t1", [clip("c1", "t1", 0), clip("c3", "t1", 10)]), track("t2", [clip("c2", "t2", 0)])] },
    mediaLibrary: {
      items: [{ id: "m1", name: "a.mp4", type: "video", fileHandle: null, blob: null, metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 }, thumbnailUrl: null, waveformData: null }],
    },
  } as unknown as Project;
}

const clipOf = (p: Project, id: string) => p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;

let counter = 0;
const act = (type: string, params: Record<string, unknown>): Action => ({ type, id: `act-${++counter}`, timestamp: Date.now(), params });

/** The timeline, minus volatile fields, as a comparable string. */
function view(project: Project): string {
  return JSON.stringify({
    tracks: project.timeline.tracks.map((t) => ({ id: t.id, clips: t.clips.map((c) => ({ id: c.id, s: c.startTime, d: c.duration, i: c.inPoint, o: c.outPoint, speed: (c as { speed?: number }).speed })) })),
    markers: project.timeline.markers.map((m) => ({ id: m.id, t: m.time, l: m.label })),
  });
}

class Editor {
  project: Project;
  readonly history = new ActionHistory();
  readonly executor = new ActionExecutor(this.history);
  private readonly remote = new ActionExecutor(new ActionHistory());
  readonly notices: CollabNotice[] = [];
  readonly engine: CollabEngine<Project>;

  constructor(
    readonly id: string,
    hub: LoopbackHub,
    key: string,
    project: Project | null,
  ) {
    this.project = project ?? ({ ...makeProject(), timeline: { duration: 0, subtitles: [], markers: [], tracks: [] } } as unknown as Project);
    const host: CollabHost<Project> = {
      getProject: () => this.project,
      clone: (p) => structuredClone(p),
      replaceProject: (next) => {
        this.project = next;
      },
      projectChanged: () => undefined,
      applyAction: async (a, p) => (await this.remote.applyRemote(a, p)).success,
      serialize: (p) => JSON.parse(JSON.stringify(p)),
      deserialize: (raw) => structuredClone(raw) as Project,
      discardHistory: (ids) => ids.forEach((i) => this.history.discard(i)),
    };
    this.engine = new CollabEngine(host, { clientId: id, name: id, key, send: hub.sender(id), newOpId: (() => { let n = 0; return () => `${id}-op-${++n}`; })() });
    this.engine.onNotice((n) => this.notices.push(n));
    this.history.subscribeApplied((e) => this.engine.localApplied(e));
    hub.attach(this.engine, false);
  }

  edit(type: string, params: Record<string, unknown>) {
    return this.executor.execute(act(type, params), this.project);
  }
}

async function room() {
  const hub = new LoopbackHub();
  const a = new Editor("alice", hub, "editor-key", makeProject());
  hub.open("alice");
  await hub.pump();
  const b = new Editor("bob", hub, "editor-key", null);
  hub.open("bob");
  await hub.pump();
  return { hub, a, b };
}

describe("collaboration integration (real executor, real room)", () => {
  it("seeds a joiner from the owner's project", async () => {
    const { a, b } = await room();
    expect(view(b.project)).toBe(view(a.project));
    expect(b.project.timeline.tracks).toHaveLength(2);
  });

  it("converges concurrent edits to different tracks, in both directions", async () => {
    const { hub, a, b } = await room();
    hub.freeze("alice");
    hub.freeze("bob");
    await a.edit("clip/move", { clipId: "c1", startTime: 2 });
    await b.edit("clip/trim", { clipId: "c2", outPoint: 3 });
    // Each side already shows its own optimistic edit.
    expect(clipOf(a.project, "c1").startTime).toBe(2);
    expect(clipOf(b.project, "c2").outPoint).toBe(3);
    hub.thaw("alice");
    hub.thaw("bob");
    await hub.pump();
    expect(view(a.project)).toBe(view(b.project));
    expect(clipOf(a.project, "c1").startTime).toBe(2);
    expect(clipOf(a.project, "c2").outPoint).toBe(3);
    expect(a.notices).toEqual([]);
    expect(b.notices).toEqual([]);
    expect(a.engine.getSnapshot().pending).toBe(0);
  });

  it("rejects the second of two concurrent edits to the same clip, and rolls it back with a notice", async () => {
    const { hub, a, b } = await room();
    hub.freeze("alice");
    hub.freeze("bob");
    await a.edit("clip/move", { clipId: "c1", startTime: 2 });
    await b.edit("clip/move", { clipId: "c1", startTime: 7 });
    hub.thaw("alice"); // alice's op reaches the room first
    await hub.pump();
    hub.thaw("bob");
    await hub.pump();
    expect(view(a.project)).toBe(view(b.project));
    expect(clipOf(a.project, "c1").startTime).toBe(2);
    const rejected = b.notices.find((n) => n.kind === "rejected");
    expect(rejected).toMatchObject({ kind: "rejected", reason: "conflict" });
    expect(a.notices).toEqual([]);
    // The rolled-back edit is gone from Bob's undo history.
    expect(b.history.canUndo()).toBe(false);
  });

  it("treats a same-track concurrent edit as a conflict (order-dependent overlap)", async () => {
    const { hub, a, b } = await room();
    hub.freeze("alice");
    hub.freeze("bob");
    await a.edit("clip/move", { clipId: "c1", startTime: 1 });
    await b.edit("clip/move", { clipId: "c3", startTime: 12 });
    hub.thaw("alice");
    await hub.pump();
    hub.thaw("bob");
    await hub.pump();
    expect(b.notices.some((n) => n.kind === "rejected" && n.reason === "conflict")).toBe(true);
    expect(view(a.project)).toBe(view(b.project));
  });

  it("keeps remote edits out of the local undo stack and local undo out of others' work", async () => {
    const { hub, a, b } = await room();
    await a.edit("clip/move", { clipId: "c1", startTime: 2 });
    await hub.pump();
    await b.edit("clip/trim", { clipId: "c2", outPoint: 3 });
    await hub.pump();
    // Bob only authored one edit; Alice's move is not on his stack.
    expect(b.history.getUndoStackSize()).toBe(1);
    expect(a.history.getUndoStackSize()).toBe(1);
    const undone = await b.executor.undo(b.project);
    expect(undone.success).toBe(true);
    await hub.pump();
    // Bob's undo reverted his trim only; Alice's move survives on both machines.
    expect(clipOf(b.project, "c1").startTime).toBe(2);
    expect(clipOf(b.project, "c2").outPoint).toBe(5);
    expect(view(a.project)).toBe(view(b.project));
    expect((await b.executor.undo(b.project)).success).toBe(false);
    // Redo travels too.
    await b.executor.redo(b.project);
    await hub.pump();
    expect(clipOf(a.project, "c2").outPoint).toBe(3);
  });

  it("creates identical ids on every machine for generated entities (split, track, marker)", async () => {
    const { hub, a, b } = await room();
    await a.edit("clip/split", { clipId: "c1", time: 2 });
    await a.edit("track/add", { trackType: "audio" });
    await a.edit("marker/add", { time: 1, label: "hello", color: "#fff" });
    await hub.pump();
    expect(a.project.timeline.tracks).toHaveLength(3);
    expect(a.project.timeline.tracks[0].clips).toHaveLength(3);
    expect(a.project.timeline.tracks.map((t) => t.id)).toEqual(b.project.timeline.tracks.map((t) => t.id));
    expect(a.project.timeline.markers.map((m) => m.id)).toEqual(b.project.timeline.markers.map((m) => m.id));
    expect(view(a.project)).toBe(view(b.project));
  });

  it("applies sequenced ops in server order on every machine even when they interleave with pending local ops", async () => {
    const { hub, a, b } = await room();
    hub.freeze("alice");
    hub.freeze("bob");
    await a.edit("clip/setSpeed", { clipId: "c1", speed: 2 });
    await a.edit("marker/add", { time: 3, label: "A", color: "#f00" });
    await b.edit("marker/add", { time: 4, label: "B", color: "#0f0" });
    await b.edit("clip/trim", { clipId: "c2", outPoint: 2 });
    hub.thaw("bob");
    await hub.pump();
    hub.thaw("alice");
    await hub.pump();
    expect(view(a.project)).toBe(view(b.project));
    expect(a.project.timeline.markers).toHaveLength(2);
    expect(a.notices).toEqual([]);
    expect(b.notices).toEqual([]);
  });

  describe("offline edits (rebase or reject)", () => {
    it("rebases non-conflicting offline edits onto what happened meanwhile", async () => {
      const { hub, a, b } = await room();
      hub.drop("bob");
      await b.edit("clip/trim", { clipId: "c2", outPoint: 3 });
      await b.edit("marker/add", { time: 2, label: "offline", color: "#00f" });
      await a.edit("clip/move", { clipId: "c1", startTime: 3 });
      await hub.pump();
      expect(b.engine.getSnapshot().status).toBe("offline");
      expect(b.engine.getSnapshot().pending).toBe(2);
      hub.open("bob");
      await hub.pump();
      expect(b.engine.getSnapshot().status).toBe("live");
      expect(b.engine.getSnapshot().pending).toBe(0);
      expect(view(a.project)).toBe(view(b.project));
      expect(clipOf(a.project, "c1").startTime).toBe(3);
      expect(clipOf(a.project, "c2").outPoint).toBe(3);
      expect(a.project.timeline.markers).toHaveLength(1);
      expect(b.notices).toEqual([]);
    });

    it("rejects an offline edit that conflicts with a collaborator's edit and tells the user", async () => {
      const { hub, a, b } = await room();
      hub.drop("bob");
      await b.edit("clip/move", { clipId: "c1", startTime: 9 });
      await b.edit("clip/trim", { clipId: "c2", outPoint: 4 });
      await a.edit("clip/move", { clipId: "c1", startTime: 2 });
      await hub.pump();
      hub.open("bob");
      await hub.pump();
      const rejected = b.notices.filter((n) => n.kind === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ reason: "conflict" });
      expect(view(a.project)).toBe(view(b.project));
      expect(clipOf(b.project, "c1").startTime).toBe(2); // Alice's edit wins
      expect(clipOf(b.project, "c2").outPoint).toBe(4); // Bob's unrelated edit survives
    });

    it("an acked op whose ack was lost with the socket is not applied twice", async () => {
      const { hub, a, b } = await room();
      await b.edit("marker/add", { time: 1, label: "once", color: "#fff" });
      // The room sequences it, but Bob's connection dies before the ack arrives.
      hub.freeze("bob");
      await hub.pump();
      hub.drop("bob");
      hub.thaw("bob");
      hub.open("bob");
      await hub.pump();
      expect(a.project.timeline.markers).toHaveLength(1);
      expect(b.project.timeline.markers).toHaveLength(1);
      expect(b.engine.getSnapshot().pending).toBe(0);
      expect(view(a.project)).toBe(view(b.project));
    });

    it("rejects offline work older than the retained history as stale", async () => {
      const hub = new LoopbackHub(undefined, { logRetain: 1, compactAt: 3 });
      const a = new Editor("alice", hub, "editor-key", makeProject());
      hub.open("alice");
      await hub.pump();
      const b = new Editor("bob", hub, "editor-key", null);
      hub.open("bob");
      await hub.pump();
      hub.drop("bob");
      await b.edit("clip/trim", { clipId: "c2", outPoint: 3 });
      for (let i = 0; i < 8; i++) {
        await a.edit("marker/add", { time: i, label: `m${i}`, color: "#fff" });
        await hub.pump();
      }
      expect(hub.room.floorSeq).toBeGreaterThan(0);
      hub.open("bob");
      await hub.pump();
      expect(b.notices.some((n) => n.kind === "rejected" && n.reason === "stale")).toBe(true);
      expect(view(a.project)).toBe(view(b.project));
      expect(b.project.timeline.markers).toHaveLength(8);
    });
  });

  describe("roles and locks", () => {
    it("viewers receive edits but cannot send any", async () => {
      const { hub, a } = await room();
      const v = new Editor("vera", hub, "viewer-key", null);
      hub.open("vera");
      await hub.pump();
      await a.edit("clip/move", { clipId: "c1", startTime: 4 });
      await hub.pump();
      expect(v.engine.getSnapshot().role).toBe("viewer");
      expect(clipOf(v.project, "c1").startTime).toBe(4);
      await v.edit("clip/move", { clipId: "c2", startTime: 1 });
      await hub.pump();
      expect(v.engine.getSnapshot().pending).toBe(0);
      expect(hub.room.headSeq).toBe(1);
    });

    it("soft-locks a bin: others' edits to it are rejected until the lock is released or taken over", async () => {
      const { hub, a, b } = await room();
      await a.edit("media/organize", { bins: [{ id: "b1", name: "B-roll" }] });
      await hub.pump();
      a.engine.setLock("bin:b1", true);
      await hub.pump();
      expect(b.engine.getSnapshot().locks.map((l) => l.resource)).toEqual(["bin:b1"]);
      await b.edit("media/organize", { itemPatches: { m1: { binId: "b1" } } });
      await hub.pump();
      const denied = b.notices.find((n) => n.kind === "rejected");
      expect(denied).toMatchObject({ reason: "locked" });
      expect(b.project.mediaLibrary.items[0].binId).toBeUndefined();
      // The holder can still edit it.
      await a.edit("media/organize", { itemPatches: { m1: { binId: "b1" } } });
      await hub.pump();
      expect(b.project.mediaLibrary.items[0].binId).toBe("b1");
      // Release -> others may edit.
      a.engine.setLock("bin:b1", false);
      await hub.pump();
      expect(b.engine.getSnapshot().locks).toEqual([]);
      await b.edit("media/organize", { itemPatches: { m1: { comment: "ok" } } });
      await hub.pump();
      expect(a.project.mediaLibrary.items[0].comment).toBe("ok");
    });
  });

  it("shows presence (playhead and selection) to the other editor", async () => {
    const { hub, a, b } = await room();
    a.engine.setPresence({ playhead: 3.5, selection: ["c1"], sequenceId: null });
    await hub.pump();
    const alice = b.engine.getSnapshot().peers.find((p) => p.clientId === "alice");
    expect(alice?.presence).toEqual({ playhead: 3.5, selection: ["c1"], sequenceId: null });
    hub.drop("alice");
    await hub.pump();
    expect(b.engine.getSnapshot().peers.map((p) => p.clientId)).toEqual(["bob"]);
  });
});
