import { describe, it, expect, beforeEach } from "vitest";
import { getAnimatedImageSourceTime, SpeedEngine } from "./speed-engine";

describe("SpeedEngine", () => {
  let speedEngine: SpeedEngine;

  beforeEach(() => {
    speedEngine = new SpeedEngine();
  });

  describe("Basic Speed Operations", () => {
    it("refreshes an existing reverse clip's source span after Split and Undo", () => {
      speedEngine.setClipSpeed("clip", 2, 8);
      speedEngine.setReverse("clip", true, 8);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip", 0)).toBe(8);
      speedEngine.setClipSpeed("clip", 2, 3);
      expect(speedEngine.getEffectiveDuration("clip")).toBe(1.5);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip", .5)).toBe(2);
      speedEngine.initializeClip("clip", 1.5);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip", .5)).toBe(2);
      speedEngine.setClipSpeed("clip", 2, 8);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip", .5)).toBe(7);
    });
    it.each([false, true])("keeps looping animated-image source time across a cut, reversed=%s", reversed => {
      const original = { inPoint: 2, duration: 4, speed: 2, reversed };
      const right = { ...original, inPoint: reversed ? 2 : 5, duration: 2.5 };
      for (const time of [1.5, 2, 3.999]) expect(getAnimatedImageSourceTime(right, time - 1.5)).toBeCloseTo(getAnimatedImageSourceTime(original, time), 12);
    });
    it("should set and get clip speed", () => {
      speedEngine.setClipSpeed("clip-1", 2, 10);
      expect(speedEngine.getClipSpeed("clip-1")).toBe(2);
    });

    it("should clamp speed to valid range", () => {
      speedEngine.setClipSpeed("clip-1", 0.01, 10);
      expect(speedEngine.getClipSpeed("clip-1")).toBe(0.1);

      speedEngine.setClipSpeed("clip-2", 100, 10);
      expect(speedEngine.getClipSpeed("clip-2")).toBe(20);
    });
  });

  describe("getSourceTimeAtPlaybackTime - Critical for Playback", () => {
    it("should return doubled time when speed is 2x", () => {
      speedEngine.setClipSpeed("clip-1", 2, 10);

      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 0)).toBe(0);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 2.5)).toBe(5);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 5)).toBe(10);
    });

    it("should clamp source time to valid range", () => {
      speedEngine.setClipSpeed("clip-1", 2, 10);

      const sourceTime = speedEngine.getSourceTimeAtPlaybackTime("clip-1", 100);
      expect(sourceTime).toBeLessThanOrEqual(10);
    });

    it("should handle reverse playback", () => {
      speedEngine.setClipSpeed("clip-1", 1, 10);
      speedEngine.setReverse("clip-1", true, 10);

      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 0)).toBe(10);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 5)).toBe(5);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 10)).toBe(0);
    });

    it("should handle reverse playback at 2x speed", () => {
      speedEngine.setClipSpeed("clip-1", 2, 10);
      speedEngine.setReverse("clip-1", true, 10);

      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 0)).toBe(10);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 2.5)).toBe(5);
      expect(speedEngine.getSourceTimeAtPlaybackTime("clip-1", 5)).toBe(0);
    });
  });

  describe("Effective duration and frame index", () => {
    it("computes effective duration and frame index at 2x speed", () => {
      speedEngine.setClipSpeed("clip-1", 2, 10);
      expect(speedEngine.getEffectiveDuration("clip-1")).toBe(5);
      expect(speedEngine.getFrameIndexAtTime("clip-1", 1, 30)).toBe(60);
    });
  });
});
