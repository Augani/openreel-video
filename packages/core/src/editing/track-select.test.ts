import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { planTrackSelect } from "./track-select";
import { zoomAtPoint, zoomToRange } from "./timeline-view";

const c = (id: string, trackId: string, startTime: number, duration: number) => ({
  id,
  trackId,
  startTime,
  duration,
});
function project(): Project {
  return {
    timeline: {
      tracks: [
        { id: "v1", locked: false, clips: [c("v-a", "v1", 0, 4), c("v-b", "v1", 4, 4), c("v-c", "v1", 8, 4)] },
        { id: "a1", locked: false, clips: [c("a-a", "a1", 0, 4), c("a-b", "a1", 4, 4), c("a-c", "a1", 8, 4)] },
        { id: "lk", locked: true, clips: [c("l-1", "lk", 6, 2)] },
      ],
    },
    textClips: [c("t-1", "v1", 9, 2)],
  } as unknown as Project;
}
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id).sort();

describe("planTrackSelect", () => {
  it("forward selects the clip and everything at or after it on all tracks, skipping locked tracks", () => {
    expect(ids(planTrackSelect(project(), "v-b", { direction: "forward" }))).toEqual([
      "a-b",
      "a-c",
      "t-1",
      "v-b",
      "v-c",
    ]);
  });
  it("backward selects the clip and everything ending at or before its end", () => {
    expect(ids(planTrackSelect(project(), "a-b", { direction: "backward" }))).toEqual([
      "a-a",
      "a-b",
      "v-a",
      "v-b",
    ]);
  });
  it("shift limits it to the clicked track", () => {
    expect(ids(planTrackSelect(project(), "v-b", { direction: "forward", trackOnly: true }))).toEqual([
      "t-1",
      "v-b",
      "v-c",
    ]);
  });
  it("selects nothing from a locked or unknown anchor", () => {
    expect(planTrackSelect(project(), "l-1", { direction: "forward" })).toEqual([]);
    expect(planTrackSelect(project(), "nope", { direction: "forward" })).toEqual([]);
  });
});

describe("zoom math", () => {
  const limits = { min: 10, max: 500 };
  it("zooms in at the pointer keeping the time under it fixed", () => {
    const next = zoomAtPoint({ pixelsPerSecond: 100, scrollX: 200 }, 300, 2, limits);
    expect(next.pixelsPerSecond).toBe(200);
    // time under the pointer: (300 + 200) / 100 = 5s -> 5 * 200 - 300
    expect(next.scrollX).toBe(700);
  });
  it("clamps to the limits and is a no-op at them", () => {
    const view = { pixelsPerSecond: 500, scrollX: 0 };
    expect(zoomAtPoint(view, 10, 2, limits)).toBe(view);
    expect(zoomAtPoint({ pixelsPerSecond: 12, scrollX: 0 }, 0, 0.1, limits).pixelsPerSecond).toBe(10);
  });
  it("fits a dragged range to the viewport", () => {
    expect(zoomToRange(2, 4, 600, limits)).toEqual({ pixelsPerSecond: 300, scrollX: 600 });
    expect(zoomToRange(2, 2, 600, limits)).toBeNull();
    expect(zoomToRange(0, 0.1, 600, limits)?.pixelsPerSecond).toBe(500);
  });
});
