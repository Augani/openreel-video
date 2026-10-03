import { describe, expect, it } from "vitest";
import { resolvePlaybackLoop, resolvePlaybackStart } from "./playback-loop";

describe("preview loop bounds", () => {
  it("uses the full project until in and out points are marked", () => {
    expect(resolvePlaybackLoop({ loopEnabled: true, loopStart: 0, loopEnd: 0 }, 12)).toEqual({ start: 0, end: 12 });
  });
  it("clamps a marked range after the project is shortened", () => {
    expect(resolvePlaybackLoop({ loopEnabled: true, loopStart: 2, loopEnd: 20 }, 8)).toEqual({ start: 2, end: 8 });
    expect(resolvePlaybackLoop({ loopEnabled: true, loopStart: 10, loopEnd: 20 }, 8)).toEqual({ start: 0, end: 8 });
  });
  it.each([0, -1, NaN, Infinity])("does not loop an invalid duration of %s", (duration) => {
    expect(resolvePlaybackLoop({ loopEnabled: true, loopStart: 1, loopEnd: 4 }, duration)).toBeNull();
  });
  it("leaves ordinary playback alone when looping is disabled", () => {
    expect(resolvePlaybackLoop({ loopEnabled: false, loopStart: 1, loopEnd: 4 }, 10)).toBeNull();
    expect(resolvePlaybackStart(2, 10, null)).toBe(2);
    expect(resolvePlaybackStart(10, 10, null)).toBe(0);
  });
  it("starts outside-range playback at the in point and preserves in-range positions", () => {
    const range = { start: 2, end: 4 };
    expect(resolvePlaybackStart(0, 10, range)).toBe(2);
    expect(resolvePlaybackStart(4, 10, range)).toBe(2);
    expect(resolvePlaybackStart(9, 10, range)).toBe(2);
    expect(resolvePlaybackStart(3, 10, range)).toBe(3);
  });
});
