import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import {
  clipDropOptionsFromModifiers,
  planClipDropResolution,
  snapshotClipOrigins,
} from "./clip-drop";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  validateTimelineToolEdits,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number, duration: number, inPoint = 0): Clip => ({
  id,
  mediaId: "media",
  trackId,
  startTime,
  duration,
  inPoint,
  outPoint: inPoint + duration,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
});
const track = (id: string, type: Track["type"], clips: Clip[], extra: Partial<Track> = {}): Track => ({
  id,
  name: id.toUpperCase(),
  type,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...extra,
});
const project = (tracks: Track[]): Project =>
  ({
    id: "p",
    name: "p",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "media",
          name: "Media.mp4",
          type: "video",
          fileHandle: null,
          blob: null,
          thumbnailUrl: null,
          waveformData: null,
          metadata: { duration: 60, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 1, hasAudio: true },
        },
      ],
    },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
  }) as unknown as Project;

/** Simulate the live drag: move clips in place (no overlap handling), as clip/move does. */
function drag(p: Project, moves: Record<string, { startTime: number; trackId?: string }>): Project {
  const moving = new Map<string, Clip>();
  for (const t of p.timeline.tracks)
    for (const c of t.clips) if (moves[c.id]) moving.set(c.id, { ...c, ...moves[c.id], trackId: moves[c.id].trackId ?? t.id });
  return {
    ...p,
    timeline: {
      ...p.timeline,
      tracks: p.timeline.tracks.map((t) => ({
        ...t,
        clips: [
          ...t.clips.filter((c) => !moving.has(c.id)),
          ...[...moving.values()].filter((c) => c.trackId === t.id),
        ],
      })),
    },
  };
}
const run = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const clipsOf = (p: Project, id: string) =>
  [...p.timeline.tracks.find((t) => t.id === id)!.clips].sort((a, b) => a.startTime - b.startTime);
const spans = (p: Project, id: string) =>
  clipsOf(p, id).map((c) => [+c.startTime.toFixed(6), +(c.startTime + c.duration).toFixed(6)]);
const noOverlaps = (p: Project) => {
  for (const t of p.timeline.tracks) {
    const cs = clipsOf(p, t.id);
    for (let i = 1; i < cs.length; i++)
      expect(cs[i].startTime).toBeGreaterThanOrEqual(cs[i - 1].startTime + cs[i - 1].duration - 1e-6);
  }
};

const base = () =>
  project([
    track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4, 10), clip("c", "v1", 8, 4)]),
    track("a1", "audio", [clip("aa", "a1", 0, 4), clip("ab", "a1", 4, 4, 10), clip("ac", "a1", 8, 4)]),
    track("a2", "audio", [clip("m", "a2", 20, 2)]),
  ]);

describe("clipDropOptionsFromModifiers", () => {
  it("maps modifiers to modes", () => {
    expect(clipDropOptionsFromModifiers({})).toEqual({ mode: "overwrite", copy: false });
    expect(clipDropOptionsFromModifiers({ metaKey: true })).toEqual({ mode: "insert", copy: false });
    expect(clipDropOptionsFromModifiers({ ctrlKey: true })).toEqual({ mode: "insert", copy: false });
    expect(clipDropOptionsFromModifiers({ altKey: true })).toEqual({ mode: "overwrite", copy: true });
    expect(clipDropOptionsFromModifiers({ altKey: true, metaKey: true })).toEqual({ mode: "insert", copy: true });
  });
});

describe("planClipDropResolution", () => {
  it("does nothing when no clip moved", () => {
    const p = base();
    expect(planClipDropResolution(p, snapshotClipOrigins(p), { mode: "overwrite" }, "op").edits).toEqual([]);
  });

  it("overwrite trims, splits and removes what is underneath", () => {
    const p0 = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4, 10), clip("c", "v1", 8, 4), clip("d", "v1", 14, 2)]),
    ]);
    const origins = snapshotClipOrigins(p0);
    // d lands on [3, 9): trims a's tail, removes b, trims c's head.
    const p1 = drag(p0, { d: { startTime: 3 } });
    const next = run(p1, planClipDropResolution(p1, origins, { mode: "overwrite" }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 3], [3, 5], [5, 8], [8, 12]]);
    noOverlaps(next);
    const [first, dropped, third, fourth] = clipsOf(next, "v1");
    expect(first.id).toBe("a");
    expect(first.outPoint).toBeCloseTo(3);
    expect(dropped.id).toBe("d");
    expect(third.mediaId).toBe("media");
    expect(third.inPoint).toBeCloseTo(11);
    expect(fourth.id).toBe("c");
  });

  it("overwrite onto the middle of a clip splits it around the drop", () => {
    const p0 = project([
      track("v1", "video", [clip("big", "v1", 0, 10), clip("s", "v1", 20, 2)]),
    ]);
    const p1 = drag(p0, { s: { startTime: 4 } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "overwrite" }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 4], [4, 6], [6, 10]]);
    const tail = clipsOf(next, "v1")[2];
    expect(tail.inPoint).toBeCloseTo(6);
    noOverlaps(next);
  });

  it("overwrite resolves a linked A/V pair on both tracks", () => {
    const p0 = base();
    const p1 = drag(p0, { c: { startTime: 2 }, ac: { startTime: 2 } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "overwrite" }, "op"));
    for (const id of ["v1", "a1"]) {
      expect(spans(next, id)).toEqual([[0, 2], [2, 6], [6, 8]]);
    }
    noOverlaps(next);
  });

  it("overwrite handles a multi-clip drag as one group", () => {
    const p0 = project([
      track("v1", "video", [clip("x", "v1", 0, 2), clip("y", "v1", 2, 2), clip("a", "v1", 10, 4), clip("b", "v1", 14, 4)]),
    ]);
    const p1 = drag(p0, { x: { startTime: 11 }, y: { startTime: 13 } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "overwrite" }, "op"));
    expect(spans(next, "v1")).toEqual([[10, 11], [11, 13], [13, 15], [15, 18]]);
    noOverlaps(next);
  });

  it("insert ripples later clips on the track and on sync-locked tracks", () => {
    const p0 = base();
    // v1/a1 'c' pair dropped at t=2 with Cmd held; a2 (sync locked) follows.
    const p1 = drag(p0, { c: { startTime: 2 }, ac: { startTime: 2 } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "insert" }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 6], [6, 8], [8, 12]]);
    expect(spans(next, "a1")).toEqual([[0, 2], [2, 6], [6, 8], [8, 12]]);
    expect(spans(next, "a2")).toEqual([[24, 26]]);
    expect(clipsOf(next, "v1")[1].id).toBe("c");
    // The split tail of a keeps source continuity.
    expect(clipsOf(next, "v1")[2].inPoint).toBeCloseTo(2);
    expect(clipsOf(next, "v1")[3].id).toBe("b");
    noOverlaps(next);
  });

  it("insert leaves a track with Sync Lock off alone", () => {
    const p0 = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("c", "v1", 10, 2)]),
      track("a2", "audio", [clip("m", "a2", 6, 2)], { syncLock: false }),
    ]);
    const p1 = drag(p0, { c: { startTime: 1 } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "insert" }, "op"));
    expect(spans(next, "a2")).toEqual([[6, 8]]);
    expect(spans(next, "v1")).toEqual([[0, 1], [1, 3], [3, 6]]);
    noOverlaps(next);
  });

  it("insert across tracks moves the clip to the new track and ripples there", () => {
    const p0 = project([
      track("v2", "video", [clip("o", "v2", 0, 6)]),
      track("v1", "video", [clip("k", "v1", 0, 3)]),
    ]);
    const p1 = drag(p0, { k: { startTime: 2, trackId: "v2" } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "insert" }, "op"));
    expect(spans(next, "v2")).toEqual([[0, 2], [2, 5], [5, 9]]);
    expect(spans(next, "v1")).toEqual([]);
  });

  it("alt copies: originals return to where the drag began and copies get the overwrite", () => {
    const p0 = base();
    const origins = snapshotClipOrigins(p0);
    const p1 = drag(p0, { c: { startTime: 2 }, ac: { startTime: 2 } });
    const plan = planClipDropResolution(p1, origins, { mode: "overwrite", copy: true }, "op");
    const next = run(p1, plan);
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 6], [6, 8], [8, 12]]);
    const ids = clipsOf(next, "v1").map((c) => c.id);
    expect(ids).toContain("c");
    expect(clipsOf(next, "v1").find((c) => c.startTime === 2)!.id).not.toBe("c");
    expect(clipsOf(next, "a1").find((c) => c.startTime === 2)!.id).not.toBe("ac");
    noOverlaps(next);
  });

  it("alt+insert copies and ripples", () => {
    const p0 = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("c", "v1", 10, 2)]),
    ]);
    const p1 = drag(p0, { c: { startTime: 1 } });
    const next = run(p1, planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "insert", copy: true }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 1], [1, 3], [3, 6], [12, 14]]);
    expect(clipsOf(next, "v1").some((c) => c.id === "c" && c.startTime === 12)).toBe(true);
    noOverlaps(next);
  });

  it("refuses a locked destination track", () => {
    const p0 = project([
      track("v1", "video", [clip("a", "v1", 0, 4)]),
      track("v2", "video", [], { locked: true }),
    ]);
    const p1 = drag(p0, { a: { startTime: 0, trackId: "v2" } });
    expect(() => planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "overwrite" }, "op")).toThrow(/Unlock/);
  });

  it("is undone by inverting the plan", () => {
    const p0 = base();
    const p1 = drag(p0, { c: { startTime: 2 }, ac: { startTime: 2 } });
    const plan = planClipDropResolution(p1, snapshotClipOrigins(p0), { mode: "insert" }, "op");
    const after = run(p1, plan);
    const back = invertTimelineToolEdits(plan.edits);
    validateTimelineToolEdits(after, back);
    const undone = applyTimelineToolEdits(after, back);
    expect(spans(undone, "v1")).toEqual(spans(p1, "v1"));
    expect(spans(undone, "a2")).toEqual(spans(p1, "a2"));
  });
});
