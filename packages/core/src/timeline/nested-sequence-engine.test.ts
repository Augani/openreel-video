import { describe, expect, it } from "vitest";
import type { Clip, Track } from "../types/timeline";
import { NestedSequenceEngine } from "./nested-sequence-engine";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id,
  mediaId: `media-${id}`,
  trackId,
  startTime,
  duration,
  inPoint: 0,
  outPoint: duration,
  transform,
  effects: [],
  audioEffects: [],
  volume: 1,
  keyframes: [],
});

const track = (id: string, clips: Clip[]): Track => ({
  id,
  type: "video",
  name: id,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});

describe("NestedSequenceEngine", () => {
  it("stores only selected clips and normalizes them to compound-local time", () => {
    const selectedA = clip("a", "track-a", 3, 2);
    const selectedB = clip("b", "track-b", 5, 3);
    const unselected = clip("other", "track-a", 9, 1);
    const engine = new NestedSequenceEngine();

    const compound = engine.createCompoundClip(
      [selectedA, selectedB],
      [track("track-a", [selectedA, unselected]), track("track-b", [selectedB])],
    );

    expect(compound.content.duration).toBe(5);
    expect(compound.content.clips.map((item) => [item.id, item.startTime])).toEqual([
      ["a", 0], ["b", 2],
    ]);
    expect(compound.content.tracks.flatMap((item) => item.clips.map((entry) => entry.id))).toEqual([
      "a", "b",
    ]);
  });

  it("creates a persisted-shape instance and flattens it back at timeline time", () => {
    const sourceA = clip("a", "track-a", 2, 2);
    const sourceB = clip("b", "track-a", 4, 1);
    const engine = new NestedSequenceEngine();
    const compound = engine.createCompoundClip(
      [sourceA, sourceB],
      [track("track-a", [sourceA, sourceB])],
    );
    const instance = engine.createInstance(compound.id, "target", 10)!;
    const flattened = engine.flattenInstance(instance.id)!;

    expect(flattened.clips.map((item) => item.startTime)).toEqual([10, 12]);
    expect(flattened.clips.every((item) => item.trackId === "target")).toBe(true);
    expect(engine.getInstance(instance.id)).toBeUndefined();
  });
});
