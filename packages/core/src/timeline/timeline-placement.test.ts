import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { resolveTimelinePlacement } from "./timeline-placement";

function projectWithTracks(
  tracks: Array<{
    id: string;
    locked?: boolean;
    clips?: Array<{ id: string; startTime: number; duration: number }>;
  }>,
): Project {
  return {
    id: "project",
    name: "Placement",
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
    timeline: {
      duration: 10,
      tracks: tracks.map((track) => ({
        id: track.id,
        name: track.id,
        type: "video",
        mode: "standard",
        locked: track.locked ?? false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: (track.clips ?? []).map((clip) => ({
          ...clip,
          mediaId: "media",
          trackId: track.id,
        })),
      })),
    },
  } as unknown as Project;
}

describe("resolveTimelinePlacement", () => {
  it("keeps an item on the requested row when the interval is clear", () => {
    const project = projectWithTracks([{ id: "target" }]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "target",
        startTime: 2,
        duration: 3,
        policy: "stack-above",
      }),
    ).toEqual({ ok: true, trackId: "target", startTime: 2 });
  });

  it("reuses the nearest clear unlocked row above an overlap", () => {
    const project = projectWithTracks([
      { id: "far" },
      { id: "nearest" },
      {
        id: "target",
        clips: [{ id: "existing", startTime: 1, duration: 4 }],
      },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "target",
        startTime: 2,
        duration: 2,
        policy: "stack-above",
      }),
    ).toEqual({ ok: true, trackId: "nearest", startTime: 2 });
  });

  it("creates one row immediately above when no existing row has room", () => {
    const project = projectWithTracks([
      {
        id: "above",
        clips: [{ id: "above-clip", startTime: 1, duration: 4 }],
      },
      {
        id: "target",
        clips: [{ id: "target-clip", startTime: 1, duration: 4 }],
      },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "target",
        startTime: 2,
        duration: 2,
        policy: "stack-above",
        newTrackId: "new-track",
      }),
    ).toEqual({
      ok: true,
      trackId: "new-track",
      startTime: 2,
      createdTrack: { id: "new-track", position: 1 },
    });
  });

  it("overlap policy keeps an occupied destination track and still refuses a locked one", () => {
    const occupied = projectWithTracks([
      { id: "t", clips: [{ id: "a", startTime: 0, duration: 5 }] },
    ]);
    expect(
      resolveTimelinePlacement(occupied, { targetTrackId: "t", startTime: 2, duration: 3, policy: "overlap" }),
    ).toEqual({ ok: true, trackId: "t", startTime: 2 });
    const locked = projectWithTracks([{ id: "t", locked: true }]);
    expect(
      resolveTimelinePlacement(locked, { targetTrackId: "t", startTime: 0, duration: 1, policy: "overlap" }),
    ).toEqual({ ok: false, reason: "track-locked" });
  });
});
