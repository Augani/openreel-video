import { describe, it, expect } from "vitest";
import { RoomCore, type Outgoing } from "./room-core";
import { LOCK_DISCONNECT_GRACE_MS, LOCK_TTL_MS, type ClientMessage, type ServerMessage, type WireOp } from "./protocol";

const hello = (clientId: string, lastSeq: number | null = null): Extract<ClientMessage, { type: "hello" }> => ({ type: "hello", clientId, name: clientId, key: "k", lastSeq });
let n = 0;
const op = (baseSeq: number, touches: string[], locks: string[] = []): WireOp => ({
  opId: `op-${++n}`,
  baseSeq,
  actions: [{ type: "clip/move", id: `a-${n}`, timestamp: 1, params: {} }],
  touches,
  locks,
});
const to = (out: Outgoing[], target: string): ServerMessage[] => out.filter((o) => o.to === target || o.to === "*").map((o) => o.msg);
const reject = (out: Outgoing[]) => out.map((o) => o.msg).find((m): m is Extract<ServerMessage, { type: "reject" }> => m.type === "reject");

function joined(now = () => 1000) {
  const room = new RoomCore({ now });
  room.hello(hello("a"), "editor", "ua");
  room.handle("a", { type: "init", project: { name: "p" } });
  room.hello(hello("b"), "editor", "ub");
  return room;
}

describe("RoomCore", () => {
  it("asks the first editor to initialize and welcomes later joiners with the snapshot", () => {
    const room = new RoomCore();
    const first = room.hello(hello("a"), "editor", "ua");
    expect(to(first, "a")[0]).toMatchObject({ type: "welcome", needsInit: true });
    room.handle("a", { type: "init", project: { name: "p" } });
    const second = room.hello(hello("b"), "editor", "ub");
    expect(to(second, "b")[0]).toMatchObject({ type: "welcome", snapshot: { seq: 0, project: { name: "p" } }, ops: [] });
  });

  it("does not let a viewer initialize, and refuses a second init", () => {
    const room = new RoomCore();
    room.hello(hello("v"), "viewer", "uv");
    expect(room.handle("v", { type: "init", project: {} })[0].msg).toMatchObject({ type: "error", code: "readonly" });
    room.hello(hello("a"), "editor", "ua");
    room.handle("a", { type: "init", project: {} });
    expect(room.handle("a", { type: "init", project: {} })[0].msg).toMatchObject({ type: "error", code: "already-initialized" });
  });

  it("sequences ops in arrival order and broadcasts them with their seq", () => {
    const room = joined();
    const out1 = room.handle("a", { type: "op", op: op(0, ["clip:c1"]) });
    const out2 = room.handle("b", { type: "op", op: op(1, ["clip:c2"]) });
    expect(out1[0].msg).toMatchObject({ type: "op", op: { seq: 1, clientId: "a" } });
    expect(out2[0].msg).toMatchObject({ type: "op", op: { seq: 2, clientId: "b" } });
    expect(room.headSeq).toBe(2);
  });

  it("rejects an op that touches something a collaborator changed since its base", () => {
    const room = joined();
    room.handle("a", { type: "op", op: op(0, ["clip:c1", "track:t1"]) });
    const out = room.handle("b", { type: "op", op: op(0, ["track:t1"]) });
    expect(reject(out)).toMatchObject({ reason: "conflict", conflictSeq: 1 });
    expect(room.headSeq).toBe(1);
  });

  it("accepts the same touch when the author had already seen the other op", () => {
    const room = joined();
    room.handle("a", { type: "op", op: op(0, ["clip:c1"]) });
    const out = room.handle("b", { type: "op", op: op(1, ["clip:c1"]) });
    expect(reject(out)).toBeUndefined();
    expect(room.headSeq).toBe(2);
  });

  it("never conflicts an author with its own earlier ops, and a global touch conflicts with anything", () => {
    const room = joined();
    room.handle("a", { type: "op", op: op(0, ["clip:c1"]) });
    expect(reject(room.handle("a", { type: "op", op: op(0, ["clip:c1"]) }))).toBeUndefined();
    expect(reject(room.handle("b", { type: "op", op: op(0, ["*"]) }))?.reason).toBe("conflict");
  });

  it("is idempotent for a resubmitted opId", () => {
    const room = joined();
    const first = op(0, ["clip:c1"]);
    room.handle("a", { type: "op", op: first });
    const again = room.handle("a", { type: "op", op: first });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ to: "a", msg: { type: "op", op: { seq: 1 } } });
    expect(room.headSeq).toBe(1);
  });

  it("rejects viewers, malformed ops and ops from the future", () => {
    const room = joined();
    room.hello(hello("v"), "viewer", "uv");
    expect(reject(room.handle("v", { type: "op", op: op(0, []) }))?.reason).toBe("readonly");
    expect(reject(room.handle("a", { type: "op", op: { opId: "x", baseSeq: 0, actions: [], touches: [], locks: [] } }))?.reason).toBe("invalid");
    expect(reject(room.handle("a", { type: "op", op: op(99, []) }))?.reason).toBe("invalid");
  });

  it("catches a reconnecting client up with the ops after its lastSeq", () => {
    const room = joined();
    room.handle("a", { type: "op", op: op(0, ["clip:c1"]) });
    room.handle("a", { type: "op", op: op(1, ["clip:c2"]) });
    room.leave("b");
    const out = room.hello(hello("b", 1), "editor", "ub");
    const welcome = to(out, "b")[0] as Extract<ServerMessage, { type: "welcome" }>;
    expect(welcome.snapshot).toBeUndefined();
    expect(welcome.ops.map((o) => o.seq)).toEqual([2]);
  });

  describe("compaction", () => {
    it("asks for a snapshot, trims the log, and serves old clients a snapshot while rejecting their stale ops", () => {
      const room = new RoomCore({ compactAt: 4, logRetain: 1 });
      room.hello(hello("a"), "editor", "ua");
      room.handle("a", { type: "init", project: { v: 0 } });
      room.hello(hello("b"), "editor", "ub");
      let asked = false;
      for (let i = 0; i < 6; i++) {
        const out = room.handle("a", { type: "op", op: op(i, [`clip:${i}`]) });
        if (out.some((o) => o.msg.type === "snapshot-request")) asked = true;
      }
      expect(asked).toBe(true);
      room.handle("a", { type: "snapshot", seq: 6, project: { v: 6 } });
      expect(room.floorSeq).toBe(5);
      expect(room.logLength).toBe(1);
      // A client that fell behind gets the snapshot, not a hole.
      room.leave("b");
      const welcome = to(room.hello(hello("b", 2), "editor", "ub"), "b")[0] as Extract<ServerMessage, { type: "welcome" }>;
      expect(welcome.snapshot).toEqual({ seq: 6, project: { v: 6 } });
      // Its offline op based on seq 2 can no longer be conflict-checked.
      expect(reject(room.handle("b", { type: "op", op: op(2, ["clip:z"]) }))?.reason).toBe("stale");
    });

    it("ignores a snapshot from the future or from a viewer", () => {
      const room = joined();
      room.hello(hello("v"), "viewer", "uv");
      room.handle("v", { type: "snapshot", seq: 0, project: { hacked: true } });
      room.handle("a", { type: "snapshot", seq: 50, project: { hacked: true } });
      expect(room.serialize().snapshot).toEqual({ seq: 0, project: { name: "p" } });
    });
  });

  describe("soft locks", () => {
    it("blocks other editors' ops on a locked resource, but not the holder's", () => {
      const room = joined();
      room.handle("a", { type: "lock", resource: "bin:b1", acquire: true });
      expect(reject(room.handle("b", { type: "op", op: op(0, ["media:m1"], ["bin:b1"]) }))).toMatchObject({ reason: "locked", lockedBy: { id: "ua" } });
      expect(reject(room.handle("a", { type: "op", op: op(0, ["media:m1"], ["bin:b1"]) }))).toBeUndefined();
    });

    it("denies a second claim unless it is an explicit take-over, and only bins/sequences lock", () => {
      const room = joined();
      room.handle("a", { type: "lock", resource: "sequence:s1", acquire: true });
      expect(room.handle("b", { type: "lock", resource: "sequence:s1", acquire: true })[0].msg).toMatchObject({ type: "lock-denied", heldBy: { id: "ua" } });
      const steal = room.handle("b", { type: "lock", resource: "sequence:s1", acquire: true, steal: true });
      expect(steal[0].msg).toMatchObject({ type: "locks", locks: [{ resource: "sequence:s1", clientId: "b" }] });
      expect(room.handle("b", { type: "lock", resource: "clip:c1", acquire: true })[0].msg).toMatchObject({ type: "error", code: "invalid" });
    });

    it("only the holder can release", () => {
      const room = joined();
      room.handle("a", { type: "lock", resource: "bin:b1", acquire: true });
      expect(room.handle("b", { type: "lock", resource: "bin:b1", acquire: false })).toEqual([]);
      expect(room.lockList()).toHaveLength(1);
      room.handle("a", { type: "lock", resource: "bin:b1", acquire: false });
      expect(room.lockList()).toHaveLength(0);
    });

    it("expires locks after the TTL, keeps them through a short disconnect and frees them after the grace", () => {
      let t = 1000;
      const room = joined(() => t);
      room.handle("a", { type: "lock", resource: "bin:b1", acquire: true });
      t += LOCK_TTL_MS + 1;
      expect(room.tick()[0].msg).toMatchObject({ type: "locks", locks: [] });

      t = 10_000;
      room.handle("a", { type: "lock", resource: "bin:b2", acquire: true });
      room.leave("a");
      t += LOCK_DISCONNECT_GRACE_MS - 1000;
      expect(room.tick()).toEqual([]);
      room.hello(hello("a"), "editor", "ua"); // back within the grace: lock is refreshed
      t += LOCK_DISCONNECT_GRACE_MS * 2;
      expect(room.lockList()).toHaveLength(1);

      room.leave("a");
      t += LOCK_DISCONNECT_GRACE_MS + 1;
      room.tick();
      expect(room.lockList()).toHaveLength(0);
    });
  });

  it("tracks presence and clamps what clients send", () => {
    const room = joined();
    room.handle("a", { type: "presence", presence: { playhead: 4, selection: Array.from({ length: 500 }, (_, i) => `c${i}`), sequenceId: "s1" } });
    const peer = room.peerList().find((p) => p.clientId === "a")!;
    expect(peer.presence.playhead).toBe(4);
    expect(peer.presence.selection).toHaveLength(200);
    room.handle("a", { type: "presence", presence: { playhead: Number.NaN, selection: [], sequenceId: null } });
    expect(room.peerList().find((p) => p.clientId === "a")!.presence.playhead).toBeNull();
    room.leave("a");
    expect(room.peerList().map((p) => p.clientId)).toEqual(["b"]);
  });

  it("round-trips through serialize/restore (what the Durable Object persists)", () => {
    const room = joined();
    room.handle("a", { type: "op", op: op(0, ["clip:c1"]) });
    room.handle("a", { type: "lock", resource: "bin:b1", acquire: true });
    const copy = RoomCore.restore(JSON.parse(JSON.stringify(room.serialize())));
    expect(copy.headSeq).toBe(1);
    expect(copy.lockList()).toHaveLength(1);
    copy.hello(hello("c"), "editor", "uc");
    expect(reject(copy.handle("c", { type: "op", op: op(0, ["clip:c1"]) }))?.reason).toBe("conflict");
  });
  it("bounds presence payloads so a member cannot amplify traffic through the peer list", () => {
    const room = joined();
    room.handle("b", { type: "presence", presence: { playhead: 1, selection: ["x".repeat(10_000), ...Array.from({ length: 500 }, (_, i) => `c${i}`)], sequenceId: "s".repeat(10_000) } });
    const peer = room.peerList().find((p) => p.clientId === "b")!;
    expect(peer.presence.selection).toHaveLength(200);
    expect(peer.presence.selection.every((s) => s.length <= 128)).toBe(true);
    expect((peer.presence.sequenceId ?? "").length).toBe(128);
  });

  it("re-registers a member whose socket outlived the in-memory room", () => {
    const room = new RoomCore();
    room.hello(hello("a"), "editor", "ua");
    room.handle("a", { type: "init", project: {} });
    const copy = RoomCore.restore(room.serialize());
    expect(copy.handle("a", { type: "ping" })[0].msg).toMatchObject({ type: "error", code: "not-joined" });
    copy.adopt("a", { id: "ua", name: "a", color: "#e5484d" }, "editor");
    expect(copy.handle("a", { type: "ping" })[0].msg).toMatchObject({ type: "pong" });
    expect(copy.clientInfo("a")?.role).toBe("editor");
  });
});
