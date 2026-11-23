import { describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { getVisibleClips, isTimelineClipPinned, pinTimelineClip } from "./visible-clips";

const clips = Array.from({ length: 100 }, (_, i) => ({
  id: `c${i}`, mediaId: "m", trackId: "t", startTime: i * 6, duration: 5,
  inPoint: 0, outPoint: 5, effects: [], audioEffects: [], keyframes: [], volume: 1,
})) as unknown as Clip[];

describe("getVisibleClips", () => {
  it("keeps only the viewport plus half a viewport of lookahead per side", () => {
    // 10 px/s: clip i spans [60i, 60i + 50]; viewport 600..1800 + 600 overscan
    const visible = getVisibleClips(clips, 600, 1200, 10);
    const ids = visible.map((c) => c.id);
    expect(ids[0]).toBe("c0");
    expect(ids).toContain("c30");
    expect(ids).not.toContain("c45");
    expect(visible.length).toBeLessThan(clips.length * 0.6);
  });

  it("always keeps selected and gesture-pinned clips mounted", () => {
    const unpin = pinTimelineClip("c90");
    expect(isTimelineClipPinned("c90")).toBe(true);
    const ids = getVisibleClips(clips, 0, 600, 10, ["c80"]).map((c) => c.id);
    expect(ids).toContain("c80");
    expect(ids).toContain("c90");
    unpin();
    expect(isTimelineClipPinned("c90")).toBe(false);
    expect(getVisibleClips(clips, 0, 600, 10).map((c) => c.id)).not.toContain("c90");
  });

  it("does not cull when the viewport is unknown", () => {
    expect(getVisibleClips(clips, 0, 0, 10)).toHaveLength(clips.length);
  });

  it("counts overlapping pins so one finished gesture does not unpin another", () => {
    const a = pinTimelineClip("x");
    const b = pinTimelineClip("x");
    a();
    expect(isTimelineClipPinned("x")).toBe(true);
    b();
    expect(isTimelineClipPinned("x")).toBe(false);
  });
});

describe("getVisibleClips selection pinning", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, startTime: i, duration: 1 }) as Clip);

  it("keeps a handful of off-screen selected clips mounted", () => {
    const ids = ["c150", "c199"];
    const visible = getVisibleClips(many, 0, 1000, 100, ids).map((c) => c.id);
    expect(visible).toContain("c150");
    expect(visible).toContain("c199");
  });

  it("does not mount a select-all's off-screen clips", () => {
    const visible = getVisibleClips(many, 0, 1000, 100, many.map((c) => c.id));
    expect(visible.length).toBeLessThan(30);
  });
});
