import { describe, it, expect, beforeEach } from "vitest";
import { TransitionEngine } from "./transition-engine";
import type { Clip } from "../types/timeline";

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    mediaId: "media-1",
    trackId: "track-1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchorPoint: { x: 0, y: 0 },
    },
    volume: 1,
    ...overrides,
  } as Clip;
}

describe("TransitionEngine", () => {
  let engine: TransitionEngine;

  beforeEach(() => {
    engine = new TransitionEngine({ width: 1920, height: 1080 });
  });

  describe("validateTransition", () => {
    it("accepts adjacent clips on the same track", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5, duration: 5 });
      const result = engine.validateTransition(a, b, 1);
      expect(result.valid).toBe(true);
    });

    it("rejects non-adjacent clips", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 6, duration: 5 });
      const result = engine.validateTransition(a, b, 1);
      expect(result.valid).toBe(false);
    });

    it("rejects clips on different tracks", () => {
      const a = makeClip({ id: "a", trackId: "t1", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", trackId: "t2", startTime: 5, duration: 5 });
      const result = engine.validateTransition(a, b, 1);
      expect(result.valid).toBe(false);
    });

    it("warns when duration exceeds available range", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 1 });
      const b = makeClip({ id: "b", startTime: 1, duration: 1 });
      const result = engine.validateTransition(a, b, 10);
      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.maxDuration).toBe(2);
    });

    it("rejects zero or negative durations", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5, duration: 5 });
      expect(engine.validateTransition(a, b, 0).valid).toBe(false);
      expect(engine.validateTransition(a, b, -1).valid).toBe(false);
    });
  });

  describe("isTimeInTransition / calculateTransitionProgress", () => {
    const a = makeClip({ id: "a", startTime: 0, duration: 5 });
    const transition = {
      id: "t",
      clipAId: "a",
      clipBId: "b",
      type: "crossfade" as const,
      duration: 1,
      params: {},
    };

    it("centers the transition on the cut point", () => {
      // Cut at t=5, duration=1, window should be [4.5, 5.5]
      expect(engine.isTimeInTransition(transition, a, 4.4)).toBe(false);
      expect(engine.isTimeInTransition(transition, a, 4.5)).toBe(true);
      expect(engine.isTimeInTransition(transition, a, 5.0)).toBe(true);
      expect(engine.isTimeInTransition(transition, a, 5.5)).toBe(true);
      expect(engine.isTimeInTransition(transition, a, 5.6)).toBe(false);
    });

    it("reports 0 progress at start and 1 at end", () => {
      expect(engine.calculateTransitionProgress(transition, a, 4.5)).toBe(0);
      expect(engine.calculateTransitionProgress(transition, a, 5.0)).toBeCloseTo(
        0.5,
        5,
      );
      expect(engine.calculateTransitionProgress(transition, a, 5.5)).toBe(1);
    });
  });

  describe("createTransition", () => {
    it("returns a transition with both clip IDs and default params", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5, duration: 5 });
      const t = engine.createTransition(a, b, "crossfade", 1);
      expect(t).not.toBeNull();
      expect(t!.clipAId).toBe("a");
      expect(t!.clipBId).toBe("b");
      expect(t!.type).toBe("crossfade");
      expect(t!.duration).toBe(1);
      expect(t!.params).toEqual({ curve: "ease" });
    });

    it("clamps to maxDuration when requested duration is too long", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 1 });
      const b = makeClip({ id: "b", startTime: 1, duration: 1 });
      const t = engine.createTransition(a, b, "crossfade", 10);
      expect(t!.duration).toBe(2);
    });
  });

  describe("areClipsAdjacent", () => {
    it("returns true for clips with negligible gap", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5.0005, duration: 5 });
      expect(engine.areClipsAdjacent(a, b)).toBe(true);
    });

    it("returns false for clips with a real gap", () => {
      const a = makeClip({ id: "a", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", startTime: 5.1, duration: 5 });
      expect(engine.areClipsAdjacent(a, b)).toBe(false);
    });

    it("returns false for clips on different tracks", () => {
      const a = makeClip({ id: "a", trackId: "t1", startTime: 0, duration: 5 });
      const b = makeClip({ id: "b", trackId: "t2", startTime: 5, duration: 5 });
      expect(engine.areClipsAdjacent(a, b)).toBe(false);
    });
  });
});
