import { describe, expect, it } from "vitest";
import { trackIdAtOffset } from "./track-hit-test";

const tracks = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("trackIdAtOffset", () => {
  it("maps with collapsed heights", () => {
    const heights = new Map([["a", 50], ["b", 50], ["c", 50]]);
    expect(trackIdAtOffset(tracks, heights, 60)).toBe("b");
    expect(trackIdAtOffset(tracks, heights, 120)).toBe("c");
    expect(trackIdAtOffset(tracks, heights, 150)).toBeUndefined();
  });

  it("accounts for the automation lanes of an expanded track above", () => {
    // a is expanded: 50 clip lane + 80 automation lanes.
    const rows = new Map([["a", 130], ["b", 50], ["c", 50]]);
    expect(trackIdAtOffset(tracks, rows, 100)).toBe("a");
    expect(trackIdAtOffset(tracks, rows, 140)).toBe("b");
    expect(trackIdAtOffset(tracks, rows, 185)).toBe("c");
    // With the collapsed heights the same pointer would have landed on the wrong track.
    const collapsed = new Map([["a", 50], ["b", 50], ["c", 50]]);
    expect(trackIdAtOffset(tracks, collapsed, 100)).toBe("c");
  });
});
