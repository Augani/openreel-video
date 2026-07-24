import { describe, expect, it } from "vitest";
import { DEFAULT_MOTION_TRANSFORM, type MotionVideoLayer } from "./types";
import { getMotionVideoLayerSourceTime } from "./motion-video-timing";

const layer = (updates: Partial<MotionVideoLayer> = {}): MotionVideoLayer => ({
  id: "video-1",
  type: "video",
  name: "Footage",
  assetId: "asset-1",
  startTime: 0,
  duration: 12,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  ...updates,
});

describe("motion video source timing", () => {
  it("combines trim offset and playback speed and clamps at the source end", () => {
    expect(getMotionVideoLayerSourceTime(layer({ trimStart: 1, playbackRate: 2 }), 2, 10)).toBe(5);
    expect(getMotionVideoLayerSourceTime(layer({ trimStart: 8, playbackRate: 2 }), 2, 10)).toBe(10);
  });

  it("loops forward and reverse playback across source boundaries", () => {
    expect(getMotionVideoLayerSourceTime(layer({ loop: true, trimStart: 1 }), 11, 10)).toBe(2);
    expect(getMotionVideoLayerSourceTime(layer({ loop: true, reverse: true, trimStart: 1 }), 10, 10)).toBe(9);
  });

  it("holds a freeze frame independently of speed, reverse, and local time", () => {
    const frozen = layer({ freezeFrame: 3.25, playbackRate: 4, reverse: true, loop: true });
    expect(getMotionVideoLayerSourceTime(frozen, 0, 10)).toBe(3.25);
    expect(getMotionVideoLayerSourceTime(frozen, 8, 10)).toBe(3.25);
  });

  it("honors legacy timeOffset when trimStart is absent", () => {
    expect(getMotionVideoLayerSourceTime(layer({ timeOffset: 2 }), 1, 10)).toBe(3);
  });
});
