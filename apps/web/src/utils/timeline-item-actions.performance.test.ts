import { describe, it, expect } from "vitest";
import type { Project } from "@openreel/core";
import {
  getSplittableTimelineItemIds,
  getTimelineItemRanges,
} from "./timeline-item-actions";

function buildProject(tracks: number, perTrack: number): Project {
  const make = (prefix: string, trackId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`,
      trackId,
      startTime: i * 2,
      duration: 2,
    }));
  return {
    timeline: {
      tracks: Array.from({ length: tracks }, (_, t) => ({
        id: `t${t}`,
        type: "video",
        clips: make(`m${t}`, `t${t}`, perTrack),
      })),
    },
    textClips: make("text", "tx", 20),
    shapeClips: make("shape", "sh", 20),
    svgClips: make("svg", "sv", 20),
    stickerClips: make("sticker", "st", 20),
  } as unknown as Project;
}

function reference(project: Project, ids: readonly string[], time: number): string[] {
  const selected = new Set(ids);
  return getTimelineItemRanges(project)
    .filter((r) => selected.has(r.id) && time > r.startTime && time < r.startTime + r.duration)
    .map((r) => r.id);
}

describe("getSplittableTimelineItemIds", () => {
  const project = buildProject(10, 500);

  it("matches the range-based reference across all clip families", () => {
    const ids = ["m0-3", "m9-499", "text-2", "shape-5", "svg-7", "sticker-1", "missing"];
    for (const time of [0, 0.5, 2, 5, 7, 11, 13.5, 14, 999, 1001]) {
      expect(getSplittableTimelineItemIds(project, ids, time)).toEqual(reference(project, ids, time));
    }
  });

  it("is exclusive at clip boundaries", () => {
    expect(getSplittableTimelineItemIds(project, ["m0-1"], 2)).toEqual([]);
    expect(getSplittableTimelineItemIds(project, ["m0-1"], 4)).toEqual([]);
    expect(getSplittableTimelineItemIds(project, ["m0-1"], 3)).toEqual(["m0-1"]);
  });

  it("returns a fresh mutable array that callers may sort or push to", () => {
    const a = getSplittableTimelineItemIds(project, [], 1);
    const b = getSplittableTimelineItemIds(project, [], 1);
    expect(a).not.toBe(b);
    expect(Object.isFrozen(a)).toBe(false);
    a.push("x");
    expect(getSplittableTimelineItemIds(project, [], 1)).toEqual([]);
  });

  it("does not scan clips for an empty selection (1000 calls, 5000 clips)", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) getSplittableTimelineItemIds(project, [], i);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
