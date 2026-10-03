import { describe, expect, it } from "vitest";
import { getVisibleRepeatRange } from "./visible-repeat-range";

describe("getVisibleRepeatRange", () => {
  it("bounds decorations on an hour-long clip at maximum zoom", () => {
    const range = getVisibleRepeatRange(0, 3600 * 500, 500_000, 1000, 300_000);
    expect(range.end - range.start).toBeLessThanOrEqual(208);
    expect(range.start * 6).toBeLessThanOrEqual(500_000 - 120);
    expect(range.end * 6).toBeGreaterThanOrEqual(501_000 + 120);
  });

  it("keeps original tile indices as the timeline scrolls", () => {
    expect(getVisibleRepeatRange(100, 1000, 500, 200, 10, 0))
      .toEqual({ start: 4, end: 6 });
  });

  it("renders no decorations for clips outside the viewport", () => {
    expect(getVisibleRepeatRange(2000, 1000, 0, 1000, 10))
      .toEqual({ start: 0, end: 0 });
    expect(getVisibleRepeatRange(0, 1000, 2000, 1000, 10))
      .toEqual({ start: 0, end: 0 });
  });

  it("clamps overscan at the clip edges and ignores empty geometry", () => {
    expect(getVisibleRepeatRange(0, 100, 0, 1000, 1))
      .toEqual({ start: 0, end: 1 });
    expect(getVisibleRepeatRange(0, 0, 0, 1000, 10))
      .toEqual({ start: 0, end: 0 });
  });
});
