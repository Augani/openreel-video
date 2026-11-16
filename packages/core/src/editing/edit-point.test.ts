import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import {
  defaultEditPointKind,
  findEditPointNeighbor,
  findGapAt,
  markClipRange,
  planDeleteGap,
  planEditPointTrim,
  toggleEditPointKind,
} from "./edit-point";
import { applyTimelineToolEdits, validateTimelineToolEdits, type TimelineToolPlan } from "./timeline-tool-edit";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  rotation: 0,
  opacity: 1,
};
const clip = (id: string, trackId: string, startTime: number, duration: number, inPoint = 10): Clip => ({
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
function project(tracks: Track[]): Project {
  return {
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
          metadata: {
            duration: 60, width: 640, height: 360, frameRate: 30, sampleRate: 48000,
            channels: 2, codec: "h264", fileSize: 1, hasAudio: true,
          },
        },
      ],
    },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
  } as unknown as Project;
}
const run = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const spans = (p: Project, trackId: string) =>
  [...p.timeline.tracks.find((t) => t.id === trackId)!.clips]
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => [+c.startTime.toFixed(4), +(c.startTime + c.duration).toFixed(4)]);

/** v1: a[0,4] b[4,8] gap c[10,14]; a1 mirrors v1 for a and b; music m[10,12] on a2 (not sync-locked off). */
const layout = (extra: Partial<Track> = {}) =>
  project([
    track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 10, 4)]),
    track("a1", "audio", [clip("aa", "a1", 0, 4), clip("ab", "a1", 4, 4), clip("ac", "a1", 10, 4)], extra),
  ]);

describe("edit point kinds", () => {
  const p = layout();
  it("is a roll at a cut and a ripple at a free edge", () => {
    expect(defaultEditPointKind(p, { clipId: "a", edge: "right" })).toBe("roll");
    expect(defaultEditPointKind(p, { clipId: "b", edge: "left" })).toBe("roll");
    expect(defaultEditPointKind(p, { clipId: "a", edge: "left" })).toBe("ripple");
    expect(defaultEditPointKind(p, { clipId: "b", edge: "right" })).toBe("ripple");
    expect(findEditPointNeighbor(p, { clipId: "a", edge: "right" })?.id).toBe("b");
  });
  it("toggles between ripple and roll only where a roll is possible", () => {
    expect(toggleEditPointKind(p, { clipId: "a", edge: "right" }, "roll")).toBe("ripple");
    expect(toggleEditPointKind(p, { clipId: "a", edge: "right" }, "ripple")).toBe("roll");
    expect(toggleEditPointKind(p, { clipId: "a", edge: "left" }, "ripple")).toBe("ripple");
  });
});

describe("planEditPointTrim", () => {
  it("rolls a cut by whole frames without changing total length", () => {
    const p = layout();
    const plan = planEditPointTrim(p, { clipId: "a", edge: "right", frames: 5, linkedIds: ["aa"] });
    expect(plan.kind).toBe("roll");
    const after = run(p, plan);
    const cut = +(4 + 5 / 30).toFixed(4);
    expect(spans(after, "v1")).toEqual([[0, cut], [cut, 8], [10, 14]]);
    expect(spans(after, "a1")[0]).toEqual([0, +(4 + 5 / 30).toFixed(4)]);
  });

  it("trims earlier with negative frames", () => {
    const p = layout();
    const after = run(p, planEditPointTrim(p, { clipId: "a", edge: "right", frames: -1, linkedIds: ["aa"] }));
    expect(spans(after, "v1")[0]).toEqual([0, +(4 - 1 / 30).toFixed(4)]);
  });

  it("ripples a free edge, pulling later clips along", () => {
    const p = layout();
    const plan = planEditPointTrim(p, { clipId: "b", edge: "right", frames: -3, linkedIds: ["ab"] });
    expect(plan.kind).toBe("ripple");
    const after = run(p, plan);
    expect(spans(after, "v1")).toEqual([[0, 4], [4, +(8 - 0.1).toFixed(4)], [+(10 - 0.1).toFixed(4), +(14 - 0.1).toFixed(4)]]);
  });

  it("honours an explicit ripple on a cut and falls back from roll on a free edge", () => {
    const p = layout();
    expect(planEditPointTrim(p, { clipId: "a", edge: "right", frames: -2, kind: "ripple", linkedIds: ["aa"] }).kind).toBe("ripple");
    expect(planEditPointTrim(p, { clipId: "b", edge: "right", frames: -2, kind: "roll", linkedIds: ["ab"] }).kind).toBe("ripple");
  });

  it("refuses a locked track and rejects fractional frames", () => {
    const locked = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4)], { locked: true }),
    ]);
    expect(() => planEditPointTrim(locked, { clipId: "a", edge: "right", frames: 1 })).toThrow(/Unlock/);
    expect(() => planEditPointTrim(layout(), { clipId: "a", edge: "right", frames: 1.5 })).toThrow(/whole number/);
    expect(() => planEditPointTrim(layout(), { clipId: "zz", edge: "right", frames: 1 })).toThrow(/no longer exists/);
  });

  it("ripple trim carries a sync-locked track and is blocked when it would cut its content", () => {
    // a1 is not linked (no linkedIds) but sync-locked: it follows a ripple.
    const followed = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m", "a2", 10, 2)]),
    ]);
    const after = run(followed, planEditPointTrim(followed, { clipId: "b", edge: "right", frames: -3 }));
    expect(spans(after, "a2")).toEqual([[+(10 - 0.1).toFixed(4), +(12 - 0.1).toFixed(4)]]);
    const blocked = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4)]),
      track("a2", "audio", [clip("m", "a2", 7.95, 2)]),
    ]);
    expect(() => planEditPointTrim(blocked, { clipId: "b", edge: "right", frames: -6 })).toThrow();
  });
});

describe("gaps", () => {
  const p = layout();
  it("finds the gap under a time, including a leading gap, but not trailing space", () => {
    expect(findGapAt(p, "v1", 9)).toEqual({ trackId: "v1", start: 8, end: 10 });
    expect(findGapAt(p, "v1", 5)).toBeNull();
    expect(findGapAt(p, "v1", 20)).toBeNull();
    const lead = project([track("v1", "video", [clip("a", "v1", 2, 4)])]);
    expect(findGapAt(lead, "v1", 1)).toEqual({ trackId: "v1", start: 0, end: 2 });
  });

  it("ripple-deletes a gap, shifting later clips and sync-locked tracks", () => {
    const gap = findGapAt(p, "v1", 9)!;
    const after = run(p, planDeleteGap(p, gap, "op"));
    expect(spans(after, "v1")).toEqual([[0, 4], [4, 8], [8, 12]]);
    expect(spans(after, "a1")[2]).toEqual([8, 12]);
  });

  it("is blocked when a sync-locked track has content in the gap", () => {
    const blocked = project([
      track("v1", "video", [clip("a", "v1", 0, 4), clip("c", "v1", 10, 4)]),
      track("a2", "audio", [clip("m", "a2", 5, 2)]),
    ]);
    expect(() => planDeleteGap(blocked, { trackId: "v1", start: 4, end: 10 }, "op")).toThrow();
  });

  it("rejects a stale gap", () => {
    expect(() => planDeleteGap(p, { trackId: "v1", start: 7, end: 10 }, "op")).toThrow(/no longer exists/);
  });
});

describe("markClipRange", () => {
  const p = project([
    track("v2", "video", [clip("o", "v2", 20, 3)]),
    track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4)]),
  ]);
  it("returns the clip under the time on targeted tracks, falling back to any track", () => {
    expect(markClipRange(p, 5, ["v1"])).toMatchObject({ start: 4, end: 8, clipId: "b" });
    expect(markClipRange(p, 4, ["v1"])).toMatchObject({ clipId: "b" });
    expect(markClipRange(p, 21)).toMatchObject({ start: 20, end: 23, trackId: "v2" });
    expect(markClipRange(p, 21, ["v1"])).toBeNull();
    expect(markClipRange(p, 30)).toBeNull();
  });
});
