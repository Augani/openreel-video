import { describe, expect, it } from "vitest";
import type { Project } from "../types/project";
import { calculateProjectDuration } from "./project-duration";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project",
    name: "Duration",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], duration: 0, subtitles: [], markers: [] },
    ...overrides,
  };
}

describe("calculateProjectDuration", () => {
  it("includes overlays when no media clips exist", () => {
    const duration = calculateProjectDuration(
      project({
        textClips: [{ startTime: 2, duration: 5 } as NonNullable<Project["textClips"]>[number]],
        shapeClips: [{ startTime: 1, duration: 9 } as NonNullable<Project["shapeClips"]>[number]],
      }),
    );

    expect(duration).toBe(10);
  });

  it("includes subtitles, nested sequences, and motion instances", () => {
    const value = project({
      timeline: {
        tracks: [],
        duration: 0,
        markers: [],
        subtitles: [{ id: "subtitle", text: "End", startTime: 1, endTime: 12 }],
      },
      nestedInstances: [{ startTime: 3, duration: 5 } as NonNullable<Project["nestedInstances"]>[number]],
      motionInstances: [{ startTime: 4, duration: 6 } as NonNullable<Project["motionInstances"]>[number]],
    });

    expect(calculateProjectDuration(value)).toBe(12);
  });
});
