import { describe, expect, it } from "vitest";
import { advanceMotionPlayhead } from "./playback";

describe("advanceMotionPlayhead", () => {
  it("advances inside the full composition duration", () => {
    expect(
      advanceMotionPlayhead({
        currentTime: 1,
        deltaSeconds: 0.5,
        duration: 5,
        playbackRate: 1,
        loop: true,
      }),
    ).toEqual({ time: 1.5, isPlaying: true });
  });

  it("loops inside the active work area", () => {
    const result = advanceMotionPlayhead({
      currentTime: 2.8,
      deltaSeconds: 0.5,
      duration: 5,
      playbackRate: 1,
      loop: true,
      workAreaStart: 1,
      workAreaEnd: 3,
    });

    expect(result.isPlaying).toBe(true);
    expect(result.time).toBeCloseTo(1.3);
  });

  it("stops at the end when looping is disabled", () => {
    expect(
      advanceMotionPlayhead({
        currentTime: 4.8,
        deltaSeconds: 0.5,
        duration: 5,
        playbackRate: 1,
        loop: false,
      }),
    ).toEqual({ time: 5, isPlaying: false });
  });

  it("normalizes playback from outside the work area", () => {
    expect(
      advanceMotionPlayhead({
        currentTime: 0,
        deltaSeconds: 0.25,
        duration: 5,
        playbackRate: 2,
        loop: true,
        workAreaStart: 1,
        workAreaEnd: 3,
      }),
    ).toEqual({ time: 1.5, isPlaying: true });
  });

  it("snaps playback to a preview frame step when provided", () => {
    expect(
      advanceMotionPlayhead({
        currentTime: 0,
        deltaSeconds: 0.09,
        duration: 5,
        playbackRate: 1,
        loop: true,
        frameStepSeconds: 1 / 30,
      }).time,
    ).toBeCloseTo(2 / 30);
  });

  it("loops from a stepped work area boundary", () => {
    const result = advanceMotionPlayhead({
      currentTime: 2.9,
      deltaSeconds: 0.2,
      duration: 5,
      playbackRate: 1,
      loop: true,
      frameStepSeconds: 0.1,
      workAreaStart: 1,
      workAreaEnd: 3,
    });

    expect(result.isPlaying).toBe(true);
    expect(result.time).toBeCloseTo(1.1);
  });
});
