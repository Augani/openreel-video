import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import {
  adjacentEditPoint,
  availableTrimMonitorModes,
  defaultTrimMonitorMode,
  planTrimMonitor,
  resolveTrimMonitorEdit,
  type TrimMonitorMode,
} from "./trim-monitor";
import { applyTimelineToolEdits, validateTimelineToolEdits, type TimelineToolPlan } from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number, duration: number, inPoint = 10): Clip => ({
  id, mediaId: "media", trackId, startTime, duration, inPoint, outPoint: inPoint + duration,
  effects: [], audioEffects: [], transform, volume: 1, keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id, name: id.toUpperCase(), type, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra,
});
const project = (tracks: Track[]): Project =>
  ({
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [{
      id: "media", name: "Media.mp4", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 60, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1, hasAudio: true },
    }] },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
  }) as unknown as Project;
const run = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const clipOf = (p: Project, id: string) => p.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const FRAME = 1 / 30;

/** v1: a[0,4] b[4,8] c[10,14] with a1 mirroring a, b, c (a sync-locked partner track). */
const layout = (audio: Partial<Track> = {}) =>
  project([
    track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 10, 4)]),
    track("a1", "audio", [clip("aa", "a1", 0, 4), clip("ab", "a1", 4, 4), clip("ac", "a1", 10, 4)], audio),
  ]);
const cut = { clipId: "b", edge: "left" } as const;
const PARTNERS: Record<string, string[]> = { a: ["aa"], b: ["ab"], c: ["ac"] };
const partnersOf = (id: string) => PARTNERS[id] ?? [];
const plan = (p: Project, mode: TrimMonitorMode, frames: number, ref: { clipId: string; edge: "left" | "right" } = cut) =>
  planTrimMonitor(p, { ref, mode, frames, linkedIdsOf: partnersOf });

describe("trim monitor edit resolution", () => {
  it("resolves outgoing and incoming at a cut, from either side", () => {
    const p = layout();
    const fromLeft = resolveTrimMonitorEdit(p, { clipId: "b", edge: "left" })!;
    const fromRight = resolveTrimMonitorEdit(p, { clipId: "a", edge: "right" })!;
    expect([fromLeft.outgoing?.id, fromLeft.incoming?.id]).toEqual(["a", "b"]);
    expect([fromRight.outgoing?.id, fromRight.incoming?.id]).toEqual(["a", "b"]);
    expect(fromLeft.time).toBeCloseTo(4);
  });
  it("offers roll only at a cut and defaults to it", () => {
    const p = layout();
    const atCut = resolveTrimMonitorEdit(p, cut)!;
    const atGap = resolveTrimMonitorEdit(p, { clipId: "b", edge: "right" })!;
    expect(availableTrimMonitorModes(atCut)).toEqual(["roll", "ripple-out", "ripple-in", "slip", "slide"]);
    expect(availableTrimMonitorModes(atGap)).toEqual(["ripple-out", "slip", "slide"]);
    expect(defaultTrimMonitorMode(atCut)).toBe("roll");
    expect(defaultTrimMonitorMode(atGap)).toBe("ripple-out");
  });
});

describe("trim monitor plans", () => {
  it("roll moves the cut: both clips change, nothing downstream moves", () => {
    const p = layout();
    const after = run(p, plan(p, "roll", 5));
    expect(clipOf(after, "a").duration).toBeCloseTo(4 + 5 * FRAME);
    expect(clipOf(after, "b").startTime).toBeCloseTo(4 + 5 * FRAME);
    expect(clipOf(after, "b").duration).toBeCloseTo(4 - 5 * FRAME);
    expect(clipOf(after, "b").inPoint).toBeCloseTo(10 + 5 * FRAME);
    expect(clipOf(after, "c").startTime).toBeCloseTo(10);
  });
  it("ripple out trims the outgoing tail and closes the gap by shifting what follows", () => {
    const p = layout();
    const after = run(p, plan(p, "ripple-out", -3));
    expect(clipOf(after, "a").duration).toBeCloseTo(4 - 3 * FRAME);
    expect(clipOf(after, "b").startTime).toBeCloseTo(4 - 3 * FRAME);
    expect(clipOf(after, "c").startTime).toBeCloseTo(10 - 3 * FRAME);
  });
  it("ripple in trims the incoming head and keeps its start", () => {
    const p = layout();
    const after = run(p, plan(p, "ripple-in", 4));
    expect(clipOf(after, "b").startTime).toBeCloseTo(4);
    expect(clipOf(after, "b").inPoint).toBeCloseTo(10 + 4 * FRAME);
    expect(clipOf(after, "b").duration).toBeCloseTo(4 - 4 * FRAME);
    expect(clipOf(after, "c").startTime).toBeCloseTo(10 - 4 * FRAME);
    expect(clipOf(after, "a").duration).toBeCloseTo(4);
  });
  it("slip moves the incoming clip's source window only", () => {
    const p = layout();
    const after = run(p, plan(p, "slip", 6));
    const b = clipOf(after, "b");
    expect(b.startTime).toBeCloseTo(4);
    expect(b.duration).toBeCloseTo(4);
    expect(Math.abs(b.inPoint - 10)).toBeCloseTo(6 * FRAME);
    expect(clipOf(after, "a").duration).toBeCloseTo(4);
  });
  it("slip targets the chosen side and reports the requested direction", () => {
    const p = layout();
    const outgoing = planTrimMonitor(p, { ref: cut, mode: "slip", frames: 6, side: "outgoing", linkedIdsOf: partnersOf });
    const after = run(p, outgoing);
    expect(Math.abs(clipOf(after, "a").inPoint - 10)).toBeCloseTo(6 * FRAME);
    expect(clipOf(after, "b").inPoint).toBeCloseTo(10);
    expect(Math.round(outgoing.delta * 30)).toBe(6);
    expect(Math.round(plan(p, "slip", -4).delta * 30)).toBe(-4);
  });
  it("slide moves the clip and trades length with its neighbours", () => {
    const p = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 8, 4)]),
      track("a1", "audio", [clip("aa", "a1", 0, 4), clip("ab", "a1", 4, 4), clip("ac", "a1", 8, 4)]),
    ]);
    const after = run(p, plan(p, "slide", 3));
    expect(clipOf(after, "b").startTime).toBeCloseTo(4 + 3 * FRAME);
    expect(clipOf(after, "b").duration).toBeCloseTo(4);
    expect(clipOf(after, "a").duration).toBeCloseTo(4 + 3 * FRAME);
    expect(clipOf(after, "c").startTime).toBeCloseTo(8 + 3 * FRAME);
  });
  it("numeric offsets and JKL-style frame counts are whole frames", () => {
    const p = layout();
    expect(() => plan(p, "roll", 1.5)).toThrow(/whole number/);
    const one = run(p, plan(p, "roll", -1));
    expect(clipOf(one, "a").duration).toBeCloseTo(4 - FRAME);
  });
  it("a roll needs both sides and ripples need their own side", () => {
    const p = layout();
    expect(() => planTrimMonitor(p, { ref: { clipId: "c", edge: "left" }, mode: "roll", frames: 1 })).toThrow(/both sides/);
    expect(() => planTrimMonitor(p, { ref: { clipId: "c", edge: "left" }, mode: "ripple-out", frames: 1 })).toThrow(/outgoing/);
  });
  it("clamps at source handles to an empty plan instead of overshooting", () => {
    const p = layout();
    const huge = plan(p, "ripple-in", -100000);
    expect(huge.edits.length === 0 || Math.abs(huge.delta) < 10000).toBe(true);
  });
});

describe("sync lock and locks", () => {
  it("includes linked partners in one plan so a single undo reverts them all", () => {
    const p = layout();
    const planned = plan(p, "roll", 5);
    const ids = new Set(planned.edits.map((e) => e.id));
    expect(planned.edits.length).toBeGreaterThanOrEqual(4);
    expect([...ids].sort()).toEqual(["a", "aa", "ab", "b"]);
  });
  it("refuses a ripple that would shift a locked sync-lock track", () => {
    const p = layout({ locked: true });
    expect(() => plan(p, "ripple-out", -3)).toThrow(/Unlock|locked/i);
  });
  it("lets sync lock block a ripple that would cut unlinked content on another track", () => {
    const p = layout();
    expect(() => planTrimMonitor(p, { ref: cut, mode: "ripple-out", frames: -3 })).toThrow(/Sync Lock/);
  });
  it("refuses to trim a locked track", () => {
    const p = project([track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4)], { locked: true })]);
    expect(() => plan(p, "roll", 2)).toThrow();
  });
});

describe("edit point navigation", () => {
  it("walks the track's edit points in both directions", () => {
    const p = layout();
    const next1 = adjacentEditPoint(p, { clipId: "a", edge: "left" }, 1)!;
    expect(next1).toEqual({ clipId: "b", edge: "left" });
    const next2 = adjacentEditPoint(p, next1, 1)!;
    expect(next2).toEqual({ clipId: "b", edge: "right" });
    const next3 = adjacentEditPoint(p, next2, 1)!;
    expect(next3).toEqual({ clipId: "c", edge: "left" });
    expect(adjacentEditPoint(p, { clipId: "c", edge: "right" }, 1)).toBeNull();
    expect(adjacentEditPoint(p, next1, -1)).toEqual({ clipId: "a", edge: "left" });
    expect(adjacentEditPoint(p, { clipId: "a", edge: "left" }, -1)).toBeNull();
  });
});
