import { describe, expect, it } from "vitest";
import type { Clip, Track, Transition } from "../types/timeline";
import type { MediaItem, Project } from "../types/project";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  prepareTimelineToolEdit,
  validateTimelineToolEdits,
  type TimelineToolMode,
} from "./timeline-tool-edit";
import { chooseNudgeEdge, planToolNudge } from "./timeline-tool-nudge";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};
const clip = (
  id: string,
  trackId: string,
  startTime: number,
  inPoint: number,
  outPoint: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  trackId,
  mediaId: "source",
  startTime,
  duration: (outPoint - inPoint) / (extra.speed ?? 1),
  inPoint,
  outPoint,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
  ...extra,
});
const track = (id: string, clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id,
  name: id,
  type: "video",
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...extra,
});
/** A 0-4, B 4-8, C 8-12 on video; same layout on the linked audio track. */
function fixture(): Project {
  const media = {
    id: "source",
    name: "Source.mp4",
    type: "video",
    fileHandle: null,
    blob: new Blob(["source"]),
    thumbnailUrl: null,
    waveformData: null,
    metadata: {
      duration: 40,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 48000,
      channels: 2,
      fileSize: 6,
    },
  } as unknown as MediaItem;
  const set = (prefix: string, trackId: string) => [
    clip(`${prefix}A`, trackId, 0, 5, 9),
    clip(`${prefix}B`, trackId, 4, 10, 14),
    clip(`${prefix}C`, trackId, 8, 20, 24),
  ];
  return {
    id: "project",
    name: "Trim tools",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [media] },
    timeline: {
      tracks: [track("main", set("v", "main")), track("dialogue", set("a", "dialogue"))],
      duration: 12,
      markers: [],
      subtitles: [],
    },
    textClips: [],
  } as unknown as Project;
}
const find = (p: Project, id: string) =>
  p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const patch = (p: Project, id: string, change: Partial<Clip>) => {
  for (const t of p.timeline.tracks)
    Object.assign(t, { clips: t.clips.map((c) => (c.id === id ? { ...c, ...change } : c)) });
};
function run(
  p: Project,
  mode: TimelineToolMode,
  itemId: string,
  delta: number,
  edge: "left" | "right" = "right",
  linkedIds: string[] = [],
) {
  const plan = prepareTimelineToolEdit(p, { mode, itemId, linkedIds, edge }).plan(delta);
  validateTimelineToolEdits(p, plan.edits);
  return { plan, next: applyTimelineToolEdits(p, plan.edits) };
}
const clips = (p: Project) =>
  Object.fromEntries(p.timeline.tracks.flatMap((t) => t.clips).map((c) => [c.id, c]));
const caption = (source: string, startTime: number, duration: number) =>
  [
    { id: "cap", trackId: "main", startTime, duration, metadata: { captionSourceClipId: source }, keyframes: [] },
  ] as unknown as Project["textClips"];

describe("rolling edit", () => {
  it("moves the cut: one clip extends, the other trims equally", () => {
    const p = fixture();
    const { next, plan } = run(p, "roll", "vA", 1, "right");
    expect(plan.delta).toBe(1);
    expect(find(next, "vA")).toMatchObject({ startTime: 0, duration: 5, inPoint: 5, outPoint: 10 });
    expect(find(next, "vB")).toMatchObject({ startTime: 5, duration: 3, inPoint: 11, outPoint: 14 });
    expect(find(next, "vC")).toBe(find(p, "vC"));
    expect(next.timeline.duration).toBe(12);
  });
  it("is symmetric when the cut is dragged from the right clip's left edge", () => {
    const p = fixture();
    const a = run(p, "roll", "vA", -1, "right").next;
    const b = run(p, "roll", "vB", -1, "left").next;
    expect(clips(a)).toEqual(clips(b));
    expect(find(b, "vB")).toMatchObject({ startTime: 3, duration: 5, inPoint: 9 });
  });
  it("bounds the cut by both clips' remaining handles", () => {
    const p = fixture();
    patch(p, "vB", { inPoint: 0.5, outPoint: 4.5 });
    patch(p, "vA", { outPoint: 39.5, inPoint: 35.5 });
    expect(run(p, "roll", "vA", -10, "right").plan.delta).toBeCloseTo(-0.5, 5);
    const late = run(p, "roll", "vA", 10, "right");
    expect(late.plan.delta).toBeCloseTo(0.5, 5);
    expect(find(late.next, "vA").outPoint).toBeCloseTo(40, 5);
  });
  it("keeps one frame of the shrinking clip", () => {
    const { next, plan } = run(fixture(), "roll", "vA", 100, "right");
    expect(plan.delta).toBeCloseTo(4 - 1 / 30, 5);
    expect(find(next, "vB").duration).toBeCloseTo(1 / 30, 5);
  });
  it("throws without an adjacent clip, or across a gap", () => {
    const p = fixture();
    expect(() => prepareTimelineToolEdit(p, { mode: "roll", itemId: "vC", edge: "right" })).toThrow(/adjacent/);
    expect(() => prepareTimelineToolEdit(p, { mode: "roll", itemId: "vA", edge: "left" })).toThrow(/adjacent/);
    patch(p, "vC", { startTime: 9 });
    expect(() => prepareTimelineToolEdit(p, { mode: "roll", itemId: "vB", edge: "right" })).toThrow(/adjacent/);
  });
  it("scales source movement by clip speed on both sides", () => {
    const p = fixture();
    patch(p, "vA", { speed: 2, inPoint: 5, outPoint: 13, duration: 4 });
    patch(p, "vB", { speed: 0.5, inPoint: 10, outPoint: 12, duration: 4 });
    const { next } = run(p, "roll", "vA", 1, "right");
    expect(find(next, "vA")).toMatchObject({ duration: 5, outPoint: 15, speed: 2 });
    expect(find(next, "vB")).toMatchObject({ startTime: 5, duration: 3, inPoint: 10.5, outPoint: 12 });
  });
  it("uses the opposite source bound for reversed clips", () => {
    const p = fixture();
    patch(p, "vA", { reversed: true });
    patch(p, "vB", { reversed: true });
    const { next } = run(p, "roll", "vA", 1, "right");
    expect(find(next, "vA")).toMatchObject({ duration: 5, inPoint: 4, outPoint: 9 });
    expect(find(next, "vB")).toMatchObject({ duration: 3, inPoint: 10, outPoint: 13 });
  });
  it("edits linked audio identically and refuses a mismatched or locked partner", () => {
    const p = fixture();
    const { next } = run(p, "roll", "vA", 1, "right", ["aA"]);
    for (const [v, a] of [["vA", "aA"], ["vB", "aB"]])
      expect(find(next, a)).toMatchObject({
        startTime: find(next, v).startTime,
        duration: find(next, v).duration,
        inPoint: find(next, v).inPoint,
        outPoint: find(next, v).outPoint,
      });
    patch(p, "aA", { duration: 3 });
    expect(() => prepareTimelineToolEdit(p, { mode: "roll", itemId: "vA", linkedIds: ["aA"], edge: "right" })).toThrow(/differ/);
    const locked = fixture();
    Object.assign(locked.timeline.tracks[1], { locked: true });
    expect(() => prepareTimelineToolEdit(locked, { mode: "roll", itemId: "vA", linkedIds: ["aA"], edge: "right" })).toThrow(/Unlock/);
  });
  it("uses the tightest linked handle", () => {
    const p = fixture();
    patch(p, "aA", { outPoint: 39.5, inPoint: 35.5 });
    expect(run(p, "roll", "vA", 5, "right", ["aA"]).plan.delta).toBeCloseTo(0.5, 5);
  });
  it("clamps a transition at the cut and restores it through the inverse", () => {
    const p = fixture();
    Object.assign(p.timeline.tracks[0], { transitions: [
      { id: "t", type: "crossfade", duration: 3, clipAId: "vA", clipBId: "vB" } as unknown as Transition,
    ] });
    const { next, plan } = run(p, "roll", "vA", -2, "right");
    expect(next.timeline.tracks[0].transitions[0].duration).toBe(2);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.timeline.tracks[0].transitions[0].duration).toBe(3);
    const gone = run(p, "roll", "vA", 100, "right");
    expect(gone.next.timeline.tracks[0].transitions[0].duration).toBeLessThan(3);
  });
  it("clamps source-linked captions to the new clip range and restores them", () => {
    const p = fixture();
    Object.assign(p, { textClips: caption("vA", 3, 1) });
    const { next, plan } = run(p, "roll", "vA", -2, "right");
    expect(next.textClips).toEqual([]);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.textClips).toEqual(p.textClips);
  });
  it("inverts exactly and makes no edit below one frame", () => {
    const p = fixture();
    const { next, plan } = run(p, "roll", "vA", 1, "right", ["aA"]);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(clips(back)).toEqual(clips(p));
    expect(run(p, "roll", "vA", 0.001, "right").plan.edits).toEqual([]);
  });
  it("previews without mutating project data", () => {
    const p = fixture();
    const before = JSON.stringify(p.timeline);
    const prepared = prepareTimelineToolEdit(p, { mode: "roll", itemId: "vA", edge: "right" });
    const value = prepared.preview(1);
    expect(value).toMatchObject({ startTime: 0, duration: 5, delta: 1 });
    expect(value.neighbor).toMatchObject({ trackId: "main", startTime: 5, duration: 3 });
    expect(JSON.stringify(p.timeline)).toBe(before);
  });
});

describe("slide", () => {
  it("moves the clip, adjusts both neighbours and keeps the total duration", () => {
    const p = fixture();
    const { next, plan } = run(p, "slide", "vB", 1);
    expect(plan.delta).toBe(1);
    expect(find(next, "vA")).toMatchObject({ startTime: 0, duration: 5, outPoint: 10 });
    expect(find(next, "vB")).toMatchObject({ startTime: 5, duration: 4, inPoint: 10, outPoint: 14 });
    expect(find(next, "vC")).toMatchObject({ startTime: 9, duration: 3, inPoint: 21, outPoint: 24 });
    expect(next.timeline.duration).toBe(12);
  });
  it("slides left by extending the next clip's head", () => {
    const { next } = run(fixture(), "slide", "vB", -1);
    expect(find(next, "vA")).toMatchObject({ duration: 3, outPoint: 8 });
    expect(find(next, "vB").startTime).toBe(3);
    expect(find(next, "vC")).toMatchObject({ startTime: 7, duration: 5, inPoint: 19 });
  });
  it("needs both neighbours", () => {
    const p = fixture();
    expect(() => prepareTimelineToolEdit(p, { mode: "slide", itemId: "vA" })).toThrow(/both sides/);
    expect(() => prepareTimelineToolEdit(p, { mode: "slide", itemId: "vC" })).toThrow(/both sides/);
  });
  it("stops at the neighbours' handles and frame minimum", () => {
    const p = fixture();
    patch(p, "vA", { outPoint: 39.5, inPoint: 35.5 });
    expect(run(p, "slide", "vB", 10).plan.delta).toBeCloseTo(0.5, 5);
    const q = fixture();
    patch(q, "vC", { inPoint: 0.5, outPoint: 4.5 });
    expect(run(q, "slide", "vB", -10).plan.delta).toBeCloseTo(-0.5, 5);
    expect(run(fixture(), "slide", "vB", 100).plan.delta).toBeCloseTo(4 - 1 / 30, 5);
  });
  it("respects neighbour speed and reversal", () => {
    const p = fixture();
    patch(p, "vA", { speed: 2, inPoint: 5, outPoint: 13, duration: 4 });
    patch(p, "vC", { reversed: true });
    const { next } = run(p, "slide", "vB", 1);
    expect(find(next, "vA")).toMatchObject({ duration: 5, outPoint: 15 });
    expect(find(next, "vC")).toMatchObject({ startTime: 9, duration: 3, inPoint: 20, outPoint: 23 });
  });
  it("slides linked audio and moves source-linked captions with the clip", () => {
    const p = fixture();
    Object.assign(p, { textClips: caption("vB", 5, 1) });
    const { next, plan } = run(p, "slide", "vB", 1, "right", ["aB"]);
    expect(find(next, "aB").startTime).toBe(5);
    expect(find(next, "aA").duration).toBe(5);
    expect(next.textClips?.[0].startTime).toBe(6);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(clips(back)).toEqual(clips(p));
    expect(back.textClips).toEqual(p.textClips);
  });
  it("refuses a locked track", () => {
    const p = fixture();
    Object.assign(p.timeline.tracks[0], { locked: true });
    expect(() => prepareTimelineToolEdit(p, { mode: "slide", itemId: "vB" })).toThrow(/Unlock/);
  });
});

describe("rate stretch", () => {
  const gap = () => {
    const p = fixture();
    patch(p, "vC", { startTime: 10 });
    patch(p, "aC", { startTime: 10 });
    return p;
  };
  it("changes speed while keeping source in and out", () => {
    const { next, plan } = run(gap(), "stretch", "vB", 2, "right");
    expect(plan.delta).toBe(2);
    expect(find(next, "vB")).toMatchObject({ startTime: 4, duration: 6, inPoint: 10, outPoint: 14 });
    expect(find(next, "vB").speed).toBeCloseTo(4 / 6, 8);
    expect(find(next, "vC").startTime).toBe(10);
  });
  it("stretches the left edge against a fixed end", () => {
    const p = fixture();
    patch(p, "vA", { startTime: 0 });
    const { next } = run(p, "stretch", "vB", 2, "left");
    expect(find(next, "vB")).toMatchObject({ startTime: 6, duration: 2, inPoint: 10, outPoint: 14 });
    expect(find(next, "vB").speed).toBeCloseTo(2, 8);
  });
  it("keeps (out - in) / speed equal to the duration when speed is not 1", () => {
    const p = gap();
    patch(p, "vB", { speed: 2, inPoint: 10, outPoint: 18, duration: 4 });
    const { next } = run(p, "stretch", "vB", 2, "right");
    const c = find(next, "vB");
    expect((c.outPoint - c.inPoint) / c.speed!).toBeCloseTo(c.duration, 8);
    expect(c.speed).toBeCloseTo(8 / 6, 8);
  });
  it("never overwrites a neighbour or goes before the timeline start", () => {
    expect(run(fixture(), "stretch", "vB", 3, "right").plan.edits).toEqual([]);
    expect(run(fixture(), "stretch", "vA", -3, "left").plan.edits).toEqual([]);
    expect(run(gap(), "stretch", "vB", 100, "right").plan.delta).toBeCloseTo(2, 5);
  });
  it("clamps to the supported speed range", () => {
    const fast = run(gap(), "stretch", "vB", -100, "right");
    expect(find(fast.next, "vB").speed).toBeCloseTo(20, 5);
    const open = fixture();
    patch(open, "vC", { startTime: 100 });
    const slow = run(open, "stretch", "vB", 1000, "right");
    expect(find(slow.next, "vB").speed).toBeCloseTo(0.1, 5);
  });
  it("keeps reversed direction and applies to linked audio", () => {
    const p = gap();
    patch(p, "vB", { reversed: true });
    const { next } = run(p, "stretch", "vB", 2, "right", ["aB"]);
    expect(find(next, "vB").reversed).toBe(true);
    expect(find(next, "aB")).toMatchObject({ duration: 6, inPoint: 10, outPoint: 14 });
    expect(find(next, "aB").speed).toBeCloseTo(4 / 6, 8);
  });
  it("rescales source-linked captions around the fixed edge", () => {
    const p = gap();
    Object.assign(p, { textClips: caption("vB", 5, 2) });
    const { next, plan } = run(p, "stretch", "vB", 2, "right");
    expect(next.textClips?.[0].startTime).toBeCloseTo(5.5, 8);
    expect(next.textClips?.[0].duration).toBeCloseTo(3, 8);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.textClips).toEqual(p.textClips);
  });
  it("clamps transitions on the stretched clip", () => {
    const p = gap();
    Object.assign(p.timeline.tracks[0], { transitions: [
      { id: "t", type: "crossfade", duration: 3, clipAId: "vA", clipBId: "vB" } as unknown as Transition,
    ] });
    const { next } = run(p, "stretch", "vB", -3.5, "right");
    expect(next.timeline.tracks[0].transitions[0].duration).toBeCloseTo(0.5, 5);
  });
  it("refuses images, speed ramps and locked tracks", () => {
    const p = gap();
    const asImage = {
      ...p,
      mediaLibrary: { items: [{ ...p.mediaLibrary.items[0], type: "image" }] },
    } as unknown as Project;
    expect(() => prepareTimelineToolEdit(asImage, { mode: "stretch", itemId: "vB" })).toThrow(/video or audio/);
    patch(p, "vB", { speedKeyframes: [{ time: 0, speed: 1 }] } as unknown as Partial<Clip>);
    expect(() => prepareTimelineToolEdit(p, { mode: "stretch", itemId: "vB" })).toThrow(/speed ramps/);
    const locked = gap();
    Object.assign(locked.timeline.tracks[0], { locked: true });
    expect(() => prepareTimelineToolEdit(locked, { mode: "stretch", itemId: "vB" })).toThrow(/Unlock/);
  });
  it("inverts exactly", () => {
    const p = gap();
    const { next, plan } = run(p, "stretch", "vB", 2, "right", ["aB"]);
    expect(clips(applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits)))).toEqual(clips(p));
  });
});

describe("review regressions", () => {
  const sourceAt = (c: Clip, t: number) =>
    c.reversed
      ? c.outPoint - (t - c.startTime) * (c.speed ?? 1)
      : c.inPoint + (t - c.startTime) * (c.speed ?? 1);
  const variants: Partial<Clip>[] = [{}, { speed: 2 }, { reversed: true }, { speed: 0.5, reversed: true }];

  it("keeps every surviving frame on the same source time for roll and slide (speed and reversal)", () => {
    for (const variant of variants) {
      for (const [mode, id, delta, edge] of [
        ["roll", "vA", 0.4, "right"],
        ["roll", "vB", -0.7, "left"],
        ["roll", "vA", -0.9, "right"],
        ["slide", "vB", 0.6, "right"],
        ["slide", "vB", -0.6, "right"],
      ] as const) {
        const p = fixture();
        const dur = (c: Clip) => (c.outPoint - c.inPoint) / (variant.speed ?? 1);
        let at = 0;
        for (const cid of ["vA", "vB", "vC"]) {
          const c = find(p, cid);
          patch(p, cid, { ...variant, startTime: at, duration: dur(c) });
          at += dur(c);
        }
        const before = clips(p);
        const { next } = run(p, mode, id, delta, edge);
        const after = clips(next);
        for (const cid of ["vA", "vB", "vC"]) {
          const o = before[cid];
          const n = after[cid];
          if (cid === id && mode === "slide") {
            expect(n.duration).toBeCloseTo(o.duration, 8);
            expect(sourceAt(n, n.startTime)).toBeCloseTo(sourceAt(o, o.startTime), 8);
            continue;
          }
          const lo = Math.max(o.startTime, n.startTime);
          const hi = Math.min(o.startTime + o.duration, n.startTime + n.duration);
          if (hi - lo < 1e-9) continue;
          for (let k = 0; k <= 4; k++) {
            const t = lo + ((hi - lo) * k) / 4;
            expect(sourceAt(n, t)).toBeCloseTo(sourceAt(o, t), 6);
          }
        }
        const a = after.vA, b = after.vB, c = after.vC;
        expect(a.startTime + a.duration).toBeCloseTo(b.startTime, 8);
        expect(b.startTime + b.duration).toBeCloseTo(c.startTime, 8);
        expect(c.startTime + c.duration).toBeCloseTo(at, 8);
      }
    }
  });

  it("moves captions sourced from a linked partner clip with a slide", () => {
    const p = fixture();
    Object.assign(p, { textClips: caption("aB", 5, 1) });
    const { next, plan } = run(p, "slide", "vB", 1, "right", ["aB"]);
    expect(next.textClips?.[0].startTime).toBe(6);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.textClips).toEqual(p.textClips);
  });

  it("never reports a speed outside the supported range, even at the clamp", () => {
    const p = fixture();
    patch(p, "vC", { startTime: 100 });
    patch(p, "vB", { inPoint: 10.1, outPoint: 13.7, duration: 3.6 });
    for (const d of [-1000, 1000]) {
      const { next } = run(p, "stretch", "vB", d, "right");
      const s = find(next, "vB").speed!;
      expect(s).toBeLessThanOrEqual(20);
      expect(s).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("refuses roll at the outer edges of a track and non-finite deltas", () => {
    const p = fixture();
    expect(() => prepareTimelineToolEdit(p, { mode: "roll", itemId: "vA", edge: "left" })).toThrow(/adjacent/);
    expect(() => prepareTimelineToolEdit(p, { mode: "roll", itemId: "vC", edge: "right" })).toThrow(/adjacent/);
    const prepared = prepareTimelineToolEdit(p, { mode: "roll", itemId: "vA", edge: "right" });
    expect(() => prepared.plan(Number.NaN)).toThrow();
    expect(prepared.plan(0).edits).toEqual([]);
  });

  it("previews exactly what the plan commits", () => {
    for (const [mode, id, edge, delta] of [
      ["roll", "vA", "right", 0.7],
      ["slide", "vB", "right", -0.5],
    ] as const) {
      const p = fixture();
      const prepared = prepareTimelineToolEdit(p, { mode, itemId: id, edge });
      const preview = prepared.preview(delta);
      const next = clips(applyTimelineToolEdits(p, prepared.plan(delta).edits));
      expect(next[id]).toMatchObject({ startTime: preview.startTime, duration: preview.duration });
    }
  });

  it("keeps cuts adjacent at 29.97 fps", () => {
    const p = fixture();
    Object.assign(p.settings, { frameRate: 29.97 });
    const { next } = run(p, "roll", "vA", 0.7, "right");
    const a = find(next, "vA"), b = find(next, "vB");
    expect(a.startTime + a.duration).toBeCloseTo(b.startTime, 9);
  });

  it("clamps transitions around a slid clip and restores them on undo", () => {
    const p = fixture();
    Object.assign(p.timeline.tracks[0], { transitions: [
      { id: "t1", type: "crossfade", duration: 3, clipAId: "vA", clipBId: "vB" } as unknown as Transition,
      { id: "t2", type: "crossfade", duration: 3, clipAId: "vB", clipBId: "vC" } as unknown as Transition,
    ] });
    const { next, plan } = run(p, "slide", "vB", 3, "right");
    for (const t of next.timeline.tracks[0].transitions) {
      const a = find(next, t.clipAId), b = find(next, t.clipBId!);
      expect(t.duration).toBeLessThanOrEqual(Math.min(a.duration, b.duration) + 1e-9);
    }
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.timeline.tracks[0].transitions).toEqual(p.timeline.tracks[0].transitions);
  });
});

describe("trim-tool gaps", () => {
  type Text = NonNullable<Project["textClips"]>[number];
  const groupCaption = (id: string, trackId: string, startTime: number, duration: number) =>
    ({ id, trackId, startTime, duration, metadata: {}, keyframes: [] }) as unknown as Text;
  const grouped = () => {
    const p = fixture();
    Object.assign(p.timeline.tracks[0], { groupId: "g" });
    Object.assign(p.timeline.tracks[1], { groupId: "g" });
    Object.assign(p.timeline, {
      tracks: [...p.timeline.tracks, track("captions", [], { groupId: "g" })],
    });
    return p;
  };

  it("slide previews a ghost for both adjusted neighbours", () => {
    const value = prepareTimelineToolEdit(fixture(), { mode: "slide", itemId: "vB" }).preview(1);
    expect(value.neighbors).toEqual([
      { trackId: "main", startTime: 0, duration: 5 },
      { trackId: "main", startTime: 9, duration: 3 },
    ]);
    expect(value.neighbor).toEqual(value.neighbors![0]);
  });

  it("slide moves group-attached captions with the clip", () => {
    const p = grouped();
    Object.assign(p, { textClips: [groupCaption("mid", "captions", 5, 1), groupCaption("tail", "captions", 3, 1)] });
    const { next, plan } = run(p, "slide", "vB", 1);
    const text = Object.fromEntries((next.textClips ?? []).map((t) => [t.id, t]));
    expect(text.mid.startTime).toBe(6);
    expect(text.tail.startTime).toBe(3);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.textClips).toEqual(p.textClips);
  });

  it("roll clamps a group-attached caption to the shrunken clip", () => {
    const p = grouped();
    Object.assign(p, { textClips: [groupCaption("c", "captions", 3, 1)] });
    expect(run(p, "roll", "vA", -2, "right").next.textClips).toEqual([]);
    const q = grouped();
    Object.assign(q, { textClips: [groupCaption("c", "captions", 2, 2)] });
    expect(run(q, "roll", "vA", -1, "right").next.textClips?.[0]).toMatchObject({ startTime: 2, duration: 1 });
  });

  it("stretch rescales group-attached captions around the fixed edge", () => {
    const q = grouped();
    Object.assign(q, { textClips: [groupCaption("c", "captions", 2, 2)] });
    const { next } = run(q, "stretch", "vA", -1, "right");
    expect(next.textClips?.[0]).toMatchObject({ startTime: 1.5, duration: 1.5 });
  });

  it("slide hands a caption inside the neighbour's lost region to the neighbour, never beyond the clips", () => {
    const p = grouped();
    Object.assign(p, { textClips: [groupCaption("c", "captions", 8.2, 0.5), groupCaption("d", "captions", 8.5, 2)] });
    const { next, plan } = run(p, "slide", "vB", 1);
    const text = Object.fromEntries((next.textClips ?? []).map((t) => [t.id, t]));
    // C now starts at 9: a caption wholly inside [8,9) is dropped or pushed past 9.
    if (text.c) expect(text.c.startTime).toBeGreaterThanOrEqual(9 - 1e-6);
    expect(text.d.startTime).toBeGreaterThanOrEqual(9 - 1e-6);
    expect(text.d.startTime + text.d.duration).toBeLessThanOrEqual(12 + 1e-6);
    const back = applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits));
    expect(back.textClips).toEqual(p.textClips);
  });

  it("does not move captions of other groups", () => {
    const p = grouped();
    Object.assign(p.timeline.tracks[2], { groupId: "other" });
    Object.assign(p, { textClips: [groupCaption("c", "captions", 5, 1)] });
    const { next } = run(p, "slide", "vB", 1);
    expect(next.textClips?.[0].startTime).toBe(5);
  });

  it("explains why roll and slide refuse neighbours with speed ramps or freeze frames", () => {
    const ramp = fixture();
    patch(ramp, "vB", { speedKeyframes: [{ id: "k", time: 1, speed: 2 }] } as unknown as Partial<Clip>);
    expect(() => prepareTimelineToolEdit(ramp, { mode: "roll", itemId: "vA", edge: "right" })).toThrow(
      /speed ramps or freeze frames/,
    );
    const freeze = fixture();
    patch(freeze, "vA", { freezeFrames: [{ id: "f", sourceTime: 1, duration: 1 }] } as unknown as Partial<Clip>);
    expect(() => prepareTimelineToolEdit(freeze, { mode: "slide", itemId: "vB" })).toThrow(/Selection tool/);
  });

  it("allows slide when only the slid clip has a ramp (its source is untouched)", () => {
    const p = fixture();
    patch(p, "vB", { speedKeyframes: [{ id: "k", time: 1, speed: 2 }] } as unknown as Partial<Clip>);
    expect(run(p, "slide", "vB", 1).plan.delta).toBe(1);
  });
});

describe("keyboard nudge", () => {
  it("nudges by whole frames through the same bounds as a drag", () => {
    const p = fixture();
    const plan = planToolNudge(p, { mode: "roll", itemId: "vA", edge: "right", frames: 5 });
    expect(plan.delta).toBeCloseTo(5 / 30, 9);
    expect(find(applyTimelineToolEdits(p, plan.edits), "vA").duration).toBeCloseTo(4 + 5 / 30, 9);
    expect(planToolNudge(p, { mode: "roll", itemId: "vA", edge: "right", frames: -1 }).delta).toBeCloseTo(-1 / 30, 9);
  });
  it("matches the drag direction for slip", () => {
    const p = fixture();
    const plan = planToolNudge(p, { mode: "slip", itemId: "vB", frames: 3 });
    expect(find(applyTimelineToolEdits(p, plan.edits), "vB").inPoint).toBeCloseTo(10 - 3 / 30, 9);
  });
  it("clamps at a handle and rejects non-finite nudges", () => {
    const p = fixture();
    patch(p, "vA", { outPoint: 40, inPoint: 36 });
    expect(planToolNudge(p, { mode: "slide", itemId: "vB", frames: 1 }).edits).toEqual([]);
    expect(() => planToolNudge(p, { mode: "roll", itemId: "vA", frames: Number.NaN })).toThrow();
  });
  it("picks the edit point nearest the playhead", () => {
    expect(chooseNudgeEdge({ startTime: 4, duration: 4 }, 4.5)).toBe("left");
    expect(chooseNudgeEdge({ startTime: 4, duration: 4 }, 7.5)).toBe("right");
  });
});
