import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { applyTimelineToolEdits, type TimelineToolItemEdit } from "./timeline-tool-edit";
import { prepareClipSplit } from "./clip-fragments";
import { expandClipGroups, groupClips, groupMembers, pruneSingletonGroups, reconcileGroupSelection, ungroupClips } from "./clip-groups";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number, duration = 2): Clip => ({
  id, mediaId: "m", trackId, startTime, duration, inPoint: 0, outPoint: duration, effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, clips: Clip[], locked = false): Track => ({ id, name: id, type: "video", clips, transitions: [], locked, hidden: false, muted: false, solo: false });
const base = (locked = false): Project => ({
  id: "p", name: "p", createdAt: 0, modifiedAt: 0,
  settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
  mediaLibrary: { items: [] },
  timeline: { tracks: [track("v1", [clip("a", "v1", 0), clip("b", "v1", 2), clip("c", "v1", 4)]), track("v2", [clip("d", "v2", 0)], locked)], subtitles: [], duration: 6, markers: [] },
} as unknown as Project);
const grouped = (p: Project, g = "g1") => {
  const r = groupClips(p, ["a", "b"], g);
  if (!r.ok) throw new Error(r.message);
  return r.project;
};
const all = (p: Project) => p.timeline.tracks.flatMap((t) => t.clips);

describe("clip groups", () => {
  it("groups two or more clips and refuses fewer or locked ones", () => {
    const p = grouped(base());
    expect(all(p).filter((c) => c.groupId === "g1").map((c) => c.id)).toEqual(["a", "b"]);
    expect(groupClips(base(), ["a"], "g").ok).toBe(false);
    expect(groupClips(base(true), ["a", "d"], "g").ok).toBe(false);
  });

  it("old projects without groups load unchanged: no field appears", () => {
    expect(all(base()).every((c) => !("groupId" in c))).toBe(true);
    expect(JSON.stringify(base())).not.toContain("groupId");
  });

  it("selecting one member selects the group; deselecting one removes the group", () => {
    const p = grouped(base());
    expect(expandClipGroups(p.timeline.tracks, ["a", "c"]).sort()).toEqual(["a", "b", "c"]);
    expect(reconcileGroupSelection(p.timeline.tracks, [], ["a"]).sort()).toEqual(["a", "b"]);
    expect(reconcileGroupSelection(p.timeline.tracks, ["c"], ["c", "b"]).sort()).toEqual(["a", "b", "c"]);
    expect(reconcileGroupSelection(p.timeline.tracks, ["a", "b", "c"], ["a", "c"]).sort()).toEqual(["c"]);
    expect(reconcileGroupSelection(p.timeline.tracks, ["a", "b"], ["a", "b", "c"]).sort()).toEqual(["a", "b", "c"]);
    expect(reconcileGroupSelection(base().timeline.tracks, [], ["a"])).toEqual(["a"]);
  });

  it("members move together as one selection, and moving keeps the group", () => {
    const p = grouped(base());
    const ids = new Set(expandClipGroups(p.timeline.tracks, ["a"]));
    const edits: TimelineToolItemEdit[] = all(p).filter((c) => ids.has(c.id)).map((c, index) => ({
      kind: "media", id: c.id, trackId: c.trackId, index, before: c, after: { ...c, startTime: c.startTime + 10 },
    }));
    const moved = applyTimelineToolEdits(p, edits);
    expect(all(moved).filter((c) => ids.has(c.id)).map((c) => [c.id, c.startTime, c.groupId])).toEqual([["a", 10, "g1"], ["b", 12, "g1"]]);
    expect(all(moved).find((c) => c.id === "c")?.startTime).toBe(4);
  });

  it("a trim stays per clip: the neighbour keeps its edges and the group survives", () => {
    const p = grouped(base());
    const a = all(p).find((c) => c.id === "a") as Clip;
    const trimmed = applyTimelineToolEdits(p, [{ kind: "media", id: "a", trackId: "v1", index: 0, before: a, after: { ...a, duration: 1, outPoint: 1 } }]);
    const b = all(trimmed).find((c) => c.id === "b") as Clip;
    expect([b.startTime, b.duration]).toEqual([2, 2]);
    expect(all(trimmed).find((c) => c.id === "a")?.groupId).toBe("g1");
    expect(groupMembers(trimmed.timeline.tracks, "g1")).toHaveLength(2);
  });

  it("a split keeps both halves in the group", () => {
    const p = grouped(base());
    const plan = prepareClipSplit(p, "a", 1, "op");
    const split = applyTimelineToolEdits(p, plan.edits);
    expect(groupMembers(split.timeline.tracks, "g1")).toHaveLength(3);
  });

  it("grouping again merges groups; ungroup dissolves every touched group and leaves clips alone", () => {
    const merged = groupClips(grouped(base()), ["b", "c"], "g2");
    if (!merged.ok) throw new Error(merged.message);
    expect(all(merged.project).filter((c) => c.groupId === "g2").map((c) => c.id)).toEqual(["a", "b", "c"]);
    const un = ungroupClips(merged.project, ["c"]);
    if (!un.ok) throw new Error(un.message);
    expect(all(un.project).every((c) => !("groupId" in c))).toBe(true);
    expect(all(un.project).map((c) => [c.id, c.startTime])).toEqual(all(base()).map((c) => [c.id, c.startTime]));
    expect(ungroupClips(base(), ["a"]).ok).toBe(false);
  });

  it("pruneSingletonGroups frees a clip left alone in its group", () => {
    const p = grouped(base());
    const lone = { ...p, timeline: { ...p.timeline, tracks: p.timeline.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== "b") })) } };
    expect(all(pruneSingletonGroups(lone)).every((c) => !c.groupId)).toBe(true);
    expect(pruneSingletonGroups(p)).toBe(p);
  });
});
