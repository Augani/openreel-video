import { describe, expect, it } from "vitest";
import type { MotionAudioClip } from "./types";
import {
  duplicateMotionAudioClip,
  moveMotionAudioClipInTime,
  splitMotionAudioClipAtTime,
  trimMotionAudioClipInPoint,
  trimMotionAudioClipOutPoint,
} from "./motion-audio-clips";

const clip: MotionAudioClip = {
  id: "audio-1",
  startTime: 2,
  duration: 5,
  trimStart: 1,
  fadeIn: 2,
  fadeOut: 2,
};

const options = { compositionDuration: 10, frameRate: 25 };

describe("motion audio clip timing", () => {
  it("moves clips without allowing them beyond the composition", () => {
    expect(moveMotionAudioClipInTime(clip, 8, options).startTime).toBe(5);
    expect(moveMotionAudioClipInTime(clip, -2, options).startTime).toBe(0);
  });

  it("trims the in point while preserving the source-time offset", () => {
    const trimmed = trimMotionAudioClipInPoint(clip, 4, options);
    expect(trimmed).toMatchObject({
      startTime: 4,
      duration: 3,
      trimStart: 3,
      fadeIn: 2,
      fadeOut: 2,
    });
  });

  it("trims the out point and clamps fades to the new duration", () => {
    const trimmed = trimMotionAudioClipOutPoint(clip, 3, options);
    expect(trimmed.duration).toBe(1);
    expect(trimmed.fadeIn).toBe(1);
    expect(trimmed.fadeOut).toBe(1);
  });

  it("splits a clip while preserving the second segment's source offset", () => {
    const split = splitMotionAudioClipAtTime(clip, 4, () => "audio-2");
    expect(split).not.toBeNull();
    expect(split?.[0]).toMatchObject({ id: "audio-1", duration: 2 });
    expect(split?.[1]).toMatchObject({
      id: "audio-2",
      startTime: 4,
      duration: 3,
      trimStart: 3,
    });
  });

  it("duplicates full clip state at a requested timeline time", () => {
    expect(
      duplicateMotionAudioClip(clip, {
        ...options,
        startTime: 4,
        idFactory: () => "audio-copy",
      }),
    ).toEqual({ ...clip, id: "audio-copy", startTime: 4 });
  });
});
