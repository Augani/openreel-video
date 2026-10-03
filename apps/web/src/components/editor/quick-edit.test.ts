import { describe, expect, it } from "vitest";
import { canQuickEditAtPlayhead } from "./quick-edit";

describe("quick edit frame boundaries", () => {
  const clip = { startTime: 2, duration: 4 };

  it("requires at least one frame on both sides, including fractional frame rates", () => {
    const frame = 1 / 23.976;
    expect(canQuickEditAtPlayhead(clip, 2 + frame, 23.976)).toBe(true);
    expect(canQuickEditAtPlayhead(clip, 6 - frame, 23.976)).toBe(true);
    expect(canQuickEditAtPlayhead(clip, 2 + frame / 2, 23.976)).toBe(false);
    expect(canQuickEditAtPlayhead(clip, 6 - frame / 2, 23.976)).toBe(false);
  });

  it("rejects outside, nonfinite and too-short edit positions", () => {
    for (const time of [1, 2, 6, 7, NaN, Infinity]) {
      expect(canQuickEditAtPlayhead(clip, time, 30)).toBe(false);
    }
    expect(canQuickEditAtPlayhead({ startTime: 0, duration: 0.04 }, 0.02, 30)).toBe(false);
    expect(canQuickEditAtPlayhead(clip, 3, 0)).toBe(true);
  });
});
