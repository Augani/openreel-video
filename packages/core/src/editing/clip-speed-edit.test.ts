import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "../types";
import { planClipSpeedEdit, prepareMultiRateStretch } from "./clip-speed-edit";
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

describe("planClipSpeedEdit", () => {
  const two = () => project([track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 8, 2)])]);

  it("ripples trailing clips when several clips are sped up, as one plan", () => {
    const p = two();
    const plan = planClipSpeedEdit(p, ["a", "b"], { speed: 2 }, { ripple: true }, "op");
    const next = run(p, plan);
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(clipsOf(next, "v1")[0].speed).toBe(2);
    expect(clipsOf(next, "v1")[2].speed).toBeUndefined();
    // Undo restores everything.
    expect(spans(applyTimelineToolEdits(next, invertTimelineToolEdits(plan.edits)), "v1")).toEqual([[0, 4], [4, 8], [8, 10]]);
  });

  it("without ripple leaves a gap and blocks overlapping growth", () => {
    const p = two();
    expect(spans(run(p, planClipSpeedEdit(p, ["a"], { speed: 2 }, { ripple: false }, "op")), "v1")).toEqual([[0, 2], [4, 8], [8, 10]]);
    expect(() => planClipSpeedEdit(p, ["a"], { speed: 0.5 }, { ripple: false }, "op")).toThrow(/overlap/);
    // Two adjacent selected clips slowed together still collide without ripple.
    expect(() => planClipSpeedEdit(p, ["a", "b"], { speed: 0.5 }, { ripple: false }, "op")).toThrow(/overlap/);
    expect(spans(run(p, planClipSpeedEdit(p, ["a"], { speed: 0.5 }, { ripple: true }, "op")), "v1")).toEqual([[0, 8], [8, 12], [12, 14]]);
  });

  it("scales a multi-selection duration and clamps the rate", () => {
    const p = two();
    const next = run(p, planClipSpeedEdit(p, ["a", "b"], { durationScale: 0.5 }, { ripple: true }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 4], [4, 6]]);
    const slow = run(p, planClipSpeedEdit(p, ["c"], { speed: 0.01 }, { ripple: true }, "op"));
    expect(clipsOf(slow, "v1")[2].speed).toBeCloseTo(0.1);
  });

  it("moves linked audio with the video and shifts sync-locked tracks", () => {
    const p = project([
      track("v1", "video", [clip("v", "v1", 0, 4), clip("v2", "v1", 4, 4)]),
      track("a1", "audio", [clip("au", "a1", 0, 4), clip("au2", "a1", 4, 4)]),
      track("v2t", "video", [clip("x", "v2t", 6, 2)], { syncLock: true }),
    ]);
    const next = run(p, planClipSpeedEdit(p, ["v", "au"], { speed: 2, maintainPitch: false }, { ripple: false }, "op"));
    expect(spans(next, "a1")).toEqual([[0, 2], [4, 8]]);
    const rippled = run(p, planClipSpeedEdit(p, ["v", "au"], { speed: 2 }, { ripple: true }, "op"));
    expect(spans(rippled, "v1")).toEqual([[0, 2], [2, 6]]);
    expect(spans(rippled, "a1")).toEqual([[0, 2], [2, 6]]);
    // The sync-locked track holds media inside the span that would close.
    const locked = project([
      track("v1", "video", [clip("v", "v1", 0, 4), clip("v2", "v1", 4, 4)]),
      track("s", "video", [clip("x", "s", 3, 1)], { syncLock: true }),
    ]);
    expect(() => planClipSpeedEdit(locked, ["v"], { speed: 2 }, { ripple: true }, "op")).toThrow(SyncLockBlockedError);
  });

  it("applies reverse and pitch without moving clips, and refuses locked tracks and ramps", () => {
    const p = two();
    const next = run(p, planClipSpeedEdit(p, ["a", "b"], { reversed: true, maintainPitch: false }, { ripple: true }, "op"));
    expect(spans(next, "v1")).toEqual([[0, 4], [4, 8], [8, 10]]);
    expect(clipsOf(next, "v1")[1].reversed).toBe(true);
    expect(clipsOf(next, "v1")[1].pitchCorrection).toBe(false);
    expect(planClipSpeedEdit(p, ["a"], { speed: 1 }, { ripple: true }, "op").edits).toHaveLength(0);
    const locked = project([track("v1", "video", [clip("a", "v1", 0, 4)], { locked: true })]);
    expect(() => planClipSpeedEdit(locked, ["a"], { speed: 2 }, { ripple: true }, "op")).toThrow(/Unlock/);
    const ramp = project([track("v1", "video", [clip("a", "v1", 0, 4, { freezeFrames: [{ id: "f", time: 1, duration: 1 }] as never })])]);
    expect(() => planClipSpeedEdit(ramp, ["a"], { speed: 2 }, { ripple: true }, "op")).toThrow(/ramps/);
  });
});

describe("prepareMultiRateStretch", () => {
  it("scales every selected clip by the primary's drag and ripples the rest", () => {
    const p = project([track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 8, 2)])]);
    const stretch = prepareMultiRateStretch(p, { itemId: "a", clipIds: ["a", "b"], edge: "right" });
    expect(stretch.preview(-2).duration).toBeCloseTo(2);
    const next = run(p, stretch.plan(-2, "op"));
    expect(spans(next, "v1")).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(clipsOf(next, "v1")[1].speed).toBeCloseTo(2);
    // Bounded by the 0.1x floor.
    expect(stretch.preview(1000).speed).toBeCloseTo(0.1);
  });

  it("previews a ghost for every other stretched clip", () => {
    const p = project([track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 8, 2)])]);
    const stretch = prepareMultiRateStretch(p, { itemId: "a", clipIds: ["a", "b"], edge: "right" });
    const ghost = stretch.preview(-2);
    expect(ghost.neighbors).toEqual([{ trackId: "v1", startTime: 4, duration: 2 }]);
  });

  it("without ripple leaves trailing clips alone and cannot grow into a neighbour", () => {
    const p = project([track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4), clip("c", "v1", 12, 2)])]);
    const stretch = prepareMultiRateStretch(p, { itemId: "a", clipIds: ["a", "b"], edge: "right", ripple: false });
    // a touches b, so the scale is capped at 1 and growing does nothing.
    expect(stretch.preview(3).duration).toBeCloseTo(4);
    const next = run(p, stretch.plan(-2, "op"));
    expect(spans(next, "v1")).toEqual([[0, 2], [4, 6], [12, 14]]);
  });
});
