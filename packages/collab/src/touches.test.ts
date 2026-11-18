import { describe, it, expect } from "vitest";
import { computeTouches, toWireAction, touchesOverlap, type TouchProject } from "./touches";
import type { WireAction } from "./protocol";

const project: TouchProject = {
  activeSequenceId: "s1",
  sequences: [{ id: "s1", timeline: { tracks: [{ id: "t1", clips: [{ id: "c1" }] }] } }],
  timeline: { tracks: [{ id: "t1", clips: [{ id: "c1" }, { id: "c2" }] }, { id: "t2", clips: [{ id: "c9" }] }] },
  mediaLibrary: { items: [{ id: "m1", binId: "b1" }, { id: "m2" }] },
};
const a = (type: string, params: Record<string, unknown>): WireAction => ({ type, id: "x", timestamp: 1, params });

describe("computeTouches", () => {
  it("adds the clip's track to a clip edit, and the active sequence as a lock", () => {
    expect(computeTouches([a("clip/trim", { clipId: "c2", outPoint: 3 })], project)).toEqual({
      touches: ["clip:c2", "track:t1"],
      locks: ["sequence:s1"],
    });
  });

  it("keeps edits on different tracks disjoint", () => {
    const x = computeTouches([a("clip/trim", { clipId: "c2" })], project).touches;
    const y = computeTouches([a("clip/trim", { clipId: "c9" })], project).touches;
    expect(touchesOverlap(x, y)).toBe(false);
  });

  it("makes two edits to one track overlap even when they name different clips", () => {
    const x = computeTouches([a("clip/move", { clipId: "c1" })], project).touches;
    const y = computeTouches([a("clip/move", { clipId: "c2" })], project).touches;
    expect(touchesOverlap(x, y)).toBe(true);
  });

  it("finds ids nested in tool edits and lists", () => {
    const { touches } = computeTouches([a("timeline/toolEdit", { edits: [{ clipId: "c9" }, { trackId: "t2" }] }), a("clip/merge", { clipIds: ["c1", "c2"] })], project);
    expect(touches).toEqual(expect.arrayContaining(["clip:c9", "track:t2", "clip:c1", "clip:c2", "track:t1"]));
  });

  it("locks the bins a media edit reads from and writes to", () => {
    const { touches, locks } = computeTouches([a("media/organize", { itemPatches: { m1: { binId: "b2" }, m2: { comment: "x" } } })], project);
    expect(touches).toEqual(expect.arrayContaining(["media:m1", "media:m2"]));
    expect(locks).toEqual(["bin:b1", "bin:b2"]);
  });

  it("treats a bin tree replacement and a project snapshot specially", () => {
    expect(computeTouches([a("media/organize", { bins: [{ id: "b9", name: "x" }] })], project).touches).toEqual(["bins:tree"]);
    expect(computeTouches([a("project/applyEditSnapshot", { snapshot: {} })], project).touches).toEqual(["*"]);
    expect(touchesOverlap(["*"], ["clip:z"])).toBe(true);
  });

  it("an op touching nothing (a new track, a marker) never conflicts", () => {
    const { touches } = computeTouches([a("marker/add", { time: 1, label: "x", color: "#fff" })], project);
    expect(touches).toEqual([]);
    expect(touchesOverlap(touches, ["clip:c1"])).toBe(false);
  });

  it("does not lock a plain project without sequences", () => {
    const flat: TouchProject = { timeline: project.timeline };
    expect(computeTouches([a("clip/trim", { clipId: "c1" })], flat).locks).toEqual([]);
  });
});

describe("toWireAction", () => {
  it("drops file imports and un-serializable params, keeps the rest as plain JSON", () => {
    expect(toWireAction({ type: "media/import", id: "1", timestamp: 1, params: { file: {} } })).toBeNull();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(toWireAction({ type: "clip/move", id: "1", timestamp: 1, params: cyc })).toBeNull();
    expect(toWireAction({ type: "clip/move", id: "1", timestamp: 1, params: { clipId: "c", u: undefined } })).toEqual({ type: "clip/move", id: "1", timestamp: 1, params: { clipId: "c" } });
  });
});
