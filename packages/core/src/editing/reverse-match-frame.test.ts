import { describe, expect, it } from "vitest";
import type { Clip, Project } from "../types";
import { findReverseMatch, timelineTimeForSource } from "./reverse-match-frame";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } };
const clip = (id: string, startTime: number, duration: number, inPoint: number, extra: Partial<Clip> = {}): Clip =>
  ({
    id, trackId: "t", mediaId: "m", startTime, duration, inPoint, outPoint: inPoint + duration,
    volume: 1, effects: [], audioEffects: [], keyframes: [], transform, ...extra,
  }) as Clip;
const track = (id: string, type: string, clips: Clip[], hidden = false) => ({
  id, name: id, type, locked: false, hidden, solo: false, muted: false, transitions: [], clips,
});
const project = (tracks: ReturnType<typeof track>[]) =>
  ({ timeline: { tracks } }) as unknown as Project;

describe("timelineTimeForSource", () => {
  it("maps source time through an in-point offset", () => {
    expect(timelineTimeForSource(clip("a", 10, 4, 6), 8)).toBeCloseTo(12, 5);
  });
  it("returns null outside the used range and honours tolerance", () => {
    const c = clip("a", 0, 4, 6);
    expect(timelineTimeForSource(c, 5)).toBeNull();
    expect(timelineTimeForSource(c, 10.2)).toBeNull();
    expect(timelineTimeForSource(c, 10.02, 0.05)).not.toBeNull();
  });
  it("accounts for a speed change (source range stays inPoint..outPoint)", () => {
    // 2x: 4 timeline seconds consume 8 source seconds.
    const c = clip("a", 0, 4, 0, { speed: 2, outPoint: 8 });
    expect(timelineTimeForSource(c, 6)).toBeCloseTo(3, 3);
    const slow = clip("b", 0, 8, 0, { speed: 0.5, outPoint: 4 });
    expect(timelineTimeForSource(slow, 1)).toBeCloseTo(2, 3);
  });
  it("inverts reversed clips", () => {
    const c = clip("a", 0, 4, 0, { reversed: true });
    expect(timelineTimeForSource(c, 1)).toBeCloseTo(3, 3);
    expect(timelineTimeForSource(c, 4)).toBeCloseTo(0, 3);
  });
});

describe("findReverseMatch", () => {
  it("returns null when the frame is not in the sequence", () => {
    expect(findReverseMatch(project([track("v1", "video", [clip("a", 0, 4, 0)])]), "m", 9, 0)).toBeNull();
    expect(findReverseMatch(project([track("v1", "video", [clip("a", 0, 4, 0)])]), "other", 1, 0)).toBeNull();
  });
  it("prefers the topmost track", () => {
    const p = project([
      track("v2", "video", [clip("top", 20, 4, 0)]),
      track("v1", "video", [clip("bottom", 0, 4, 0)]),
    ]);
    expect(findReverseMatch(p, "m", 2, 0)?.clipId).toBe("top");
  });
  it("skips hidden video tracks and falls back to audio", () => {
    const p = project([
      track("v1", "video", [clip("hid", 0, 4, 0)], true),
      track("a1", "audio", [clip("aud", 30, 4, 0)]),
    ]);
    expect(findReverseMatch(p, "m", 1, 0)?.clipId).toBe("aud");
  });
  it("chooses the instance nearest the playhead within a track", () => {
    const p = project([track("v1", "video", [clip("a", 0, 4, 0), clip("b", 10, 4, 0)])]);
    expect(findReverseMatch(p, "m", 2, 11)?.clipId).toBe("b");
    expect(findReverseMatch(p, "m", 2, 1)?.clipId).toBe("a");
  });
  it("finds a frame inside a sped-up instance", () => {
    const p = project([track("v1", "video", [clip("a", 5, 4, 0, { speed: 2, outPoint: 8 })])]);
    expect(findReverseMatch(p, "m", 4, 0)?.time).toBeCloseTo(7, 3);
  });
});
