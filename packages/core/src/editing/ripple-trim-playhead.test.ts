import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { planRippleTrimToPlayhead } from "./ripple-trim-playhead";
import { SyncLockBlockedError } from "./sync-lock";
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
const clip = (
  id: string,
  trackId: string,
  startTime: number,
  duration: number,
  extra: Partial<Clip> = {},
): Clip => ({
  id,
  mediaId: "media",
  trackId,
  startTime,
  duration,
  inPoint: 0,
  outPoint: duration,
  effects: [],
  audioEffects: [],
  transform,
  volume: 1,
  keyframes: [],
  ...extra,
});
const track = (
  id: string,
  type: Track["type"],
  clips: Clip[],
  extra: Partial<Track> = {},
): Track => ({
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
          metadata: {
            duration: 60,
            width: 640,
            height: 360,
            frameRate: 30,
            sampleRate: 48000,
            channels: 2,
            codec: "h264",
            fileSize: 1,
            hasAudio: true,
          },
        },
      ],
    },
    timeline: { duration: 40, markers: [], subtitles: [], tracks },
  }) as unknown as Project;

const run = (p: Project, plan: TimelineToolPlan) => {
  validateTimelineToolEdits(p, plan.edits);
  return applyTimelineToolEdits(p, plan.edits);
};
const clipsOf = (p: Project, trackId: string) =>
  [...p.timeline.tracks.find((t) => t.id === trackId)!.clips].sort(
    (a, b) => a.startTime - b.startTime,
  );
const spans = (p: Project, trackId: string) =>
  clipsOf(p, trackId).map((c) => [+c.startTime.toFixed(6), +(c.startTime + c.duration).toFixed(6)]);

describe("planRippleTrimToPlayhead", () => {
  it("Q trims the start to the playhead and closes the gap", () => {
    const p = project([
      track("v1", "video", [clip("a", "v1", 2, 4), clip("b", "v1", 6, 4)]),
    ]);
    const next = run(p, planRippleTrimToPlayhead(p, 3, true, { trackIds: ["v1"] }, "op"));
    expect(spans(next, "v1")).toEqual([[2, 5], [5, 9]]);
    const a = clipsOf(next, "v1")[0];
    expect(a.inPoint).toBeCloseTo(1);
    expect(a.outPoint).toBeCloseTo(4);
  });

  it("W trims the end to the playhead and pulls later clips in", () => {
    const p = project([
      track("v1", "video", [clip("a", "v1", 2, 4), clip("b", "v1", 6, 4)]),
    ]);
    const next = run(p, planRippleTrimToPlayhead(p, 3, false, { trackIds: ["v1"] }, "op"));
    expect(spans(next, "v1")).toEqual([[2, 3], [3, 7]]);
    const a = clipsOf(next, "v1")[0];
    expect(a.inPoint).toBeCloseTo(0);
    expect(a.outPoint).toBeCloseTo(1);
  });

  it("converts timeline delta to source time through speed", () => {
    const p = project([
      track("v1", "video", [clip("a", "v1", 0, 4, { speed: 2, inPoint: 0, outPoint: 8 })]),
    ]);
    const q = clipsOf(run(p, planRippleTrimToPlayhead(p, 1, true, { trackIds: ["v1"] }, "op")), "v1");
    expect(q).toHaveLength(1);
    expect(q[0].startTime).toBeCloseTo(0);
    expect(q[0].duration).toBeCloseTo(3);
    expect(q[0].inPoint).toBeCloseTo(2);
    expect(q[0].outPoint).toBeCloseTo(8);
    const w = clipsOf(run(p, planRippleTrimToPlayhead(p, 1, false, { trackIds: ["v1"] }, "op")), "v1");
    expect(w[0].duration).toBeCloseTo(1);
    expect(w[0].inPoint).toBeCloseTo(0);
    expect(w[0].outPoint).toBeCloseTo(2);
  });

  it("honours reverse playback", () => {
    const p = project([
      track("v1", "video", [clip("a", "v1", 0, 4, { reversed: true, inPoint: 0, outPoint: 4 })]),
    ]);
    const q = clipsOf(run(p, planRippleTrimToPlayhead(p, 1, true, { trackIds: ["v1"] }, "op")), "v1")[0];
    expect(q.inPoint).toBeCloseTo(0);
    expect(q.outPoint).toBeCloseTo(3);
    const w = clipsOf(run(p, planRippleTrimToPlayhead(p, 1, false, { trackIds: ["v1"] }, "op")), "v1")[0];
    expect(w.inPoint).toBeCloseTo(3);
    expect(w.outPoint).toBeCloseTo(4);
  });

  it("trims a linked pair together and ripples a sync-locked follower that is empty there", () => {
    const p = project([
      track("v1", "video", [clip("v", "v1", 0, 4), clip("v2", "v1", 4, 4)]),
      track("a1", "audio", [clip("a", "a1", 0, 4), clip("a2", "a1", 4, 4)]),
      track("a2", "audio", [clip("m", "a2", 6, 2)]),
    ]);
    const next = run(p, planRippleTrimToPlayhead(p, 1, true, { itemIds: ["v", "a"] }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 3], [3, 7]]);
    expect(spans(next, "a1")).toEqual([[0, 3], [3, 7]]);
    expect(spans(next, "a2")).toEqual([[5, 7]]);
  });

  it("is blocked when a sync-locked follower has content in the removed range", () => {
    const p = project([
      track("v1", "video", [clip("v", "v1", 0, 4)]),
      track("a2", "audio", [clip("m", "a2", 0, 4)]),
    ]);
    expect(() => planRippleTrimToPlayhead(p, 2, true, { itemIds: ["v"] }, "op")).toThrow(
      SyncLockBlockedError,
    );
  });

  it("leaves tracks with sync lock off alone", () => {
    const p = project([
      track("v1", "video", [clip("v", "v1", 0, 4)]),
      track("a2", "audio", [clip("m", "a2", 0, 4)], { syncLock: false }),
    ]);
    const next = run(p, planRippleTrimToPlayhead(p, 2, true, { itemIds: ["v"] }, "op"));
    expect(spans(next, "a2")).toEqual([[0, 4]]);
  });

  it("only touches the targeted tracks and skips locked ones", () => {
    const p = project([
      track("v1", "video", [clip("v", "v1", 0, 4)]),
      track("v2", "video", [clip("w", "v2", 0, 4)], { locked: true }),
    ]);
    const next = run(p, planRippleTrimToPlayhead(p, 2, false, { trackIds: ["v1", "v2"] }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 2]]);
    expect(spans(next, "v2")).toEqual([[0, 4]]);
    expect(() => planRippleTrimToPlayhead(p, 2, false, { itemIds: ["w"] }, "op")).toThrow(/Unlock/);
  });

  it("returns an empty plan when nothing is under the playhead and undoes as one step", () => {
    const p = project([track("v1", "video", [clip("a", "v1", 2, 4), clip("b", "v1", 6, 4)])]);
    expect(planRippleTrimToPlayhead(p, 12, true, { trackIds: ["v1"] }, "op").edits).toEqual([]);
    expect(planRippleTrimToPlayhead(p, 6, true, { trackIds: ["v1"] }, "op").edits).toEqual([]);
    const plan = planRippleTrimToPlayhead(p, 3, false, { trackIds: ["v1"] }, "op");
    const after = run(p, plan);
    const back = invertTimelineToolEdits(plan.edits);
    validateTimelineToolEdits(after, back);
    expect(spans(applyTimelineToolEdits(after, back), "v1")).toEqual([[2, 6], [6, 10]]);
  });

  it("does nothing for an explicit empty track list", () => {
    const p = project([track("v1", "video", [clip("a", "v1", 2, 4)])]);
    expect(planRippleTrimToPlayhead(p, 3, true, { trackIds: [] }, "op").edits).toEqual([]);
  });

  it("shifts followers and markers by the shortest linked range, not the union", () => {
    const p = project([
      track("v1", "video", [clip("v", "v1", 0, 6), clip("v2", "v1", 6, 4)]),
      track("a1", "audio", [clip("a", "a1", 1, 5)]),
      track("a2", "audio", [clip("m", "a2", 8, 2)]),
    ]);
    const next = run(p, planRippleTrimToPlayhead(p, 3, true, { itemIds: ["v", "a"] }, "op"));
    // v lost [0,3] (3s), a lost [1,3] (2s); the follower closes only the shorter 2s.
    expect(spans(next, "a2")).toEqual([[6, 8]]);
  });
});
