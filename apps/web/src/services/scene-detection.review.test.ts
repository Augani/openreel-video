import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  applySceneCuts,
  type SceneAnalysis,
} from "./scene-detection";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
  rotation: 0,
};

function clip(id: string, trackId: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    trackId,
    mediaId: "video",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 10,
    speed: 1,
    volume: 1,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform,
    ...extra,
  };
}

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, name: id, type, hidden: false, locked: false, muted: false, solo: false, transitions: [], clips };
}

function fixture(videoExtra: Partial<Clip>, fps = 30): Project {
  const base = createEmptyProject("Scenes");
  return {
    ...base,
    settings: { ...base.settings, frameRate: fps },
    mediaLibrary: {
      items: [
        {
          id: "video",
          name: "Source.mp4",
          type: "video",
          fileHandle: null,
          blob: new Blob(["video"]),
          thumbnailUrl: null,
          waveformData: null,
          metadata: { duration: 30, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "h264", fileSize: 5 },
        },
      ],
    },
    timeline: {
      ...base.timeline,
      duration: 5,
      markers: [],
      tracks: [track("v", "video", [clip("vid", "v", videoExtra)])],
    },
  };
}

const analysisFor = (cuts: number[]): SceneAnalysis => ({
  projectId: useProjectStore.getState().project.id,
  clipId: "vid",
  mediaId: "video",
  cuts: cuts.map((time) => ({ time, score: 0.9 })),
});
const clipsOf = (id: string) =>
  useProjectStore.getState().project.timeline.tracks.find((t) => t.id === id)!.clips;

beforeEach(() => {
  useEditorWorkspaceStore.getState().setLinkedSelection(true);
});

describe("review regressions", () => {
  const ramp = {
    speedKeyframes: [
      { id: "k0", time: 0, speed: 2, easing: "linear" as const },
      { id: "k1", time: 5, speed: 2, easing: "linear" as const },
    ],
  };

  it("refuses to split speed-ramped clips (base split would corrupt source ranges) and changes nothing", async () => {
    useProjectStore.getState().loadProject(fixture(ramp));
    const before = clipsOf("v");
    await expect(
      applySceneCuts(analysisFor([4]), { splitClip: true, addMarkers: true }),
    ).rejects.toThrow(/speed ramps/);
    expect(clipsOf("v")).toEqual(before);
    expect(useProjectStore.getState().project.timeline.markers).toHaveLength(0);
  });

  it("still adds markers on a speed-ramped clip at the mapped timeline time", async () => {
    useProjectStore.getState().loadProject(fixture(ramp));
    const result = await applySceneCuts(analysisFor([4]), { splitClip: false, addMarkers: true });
    expect(result.markers).toBe(1);
    expect(useProjectStore.getState().project.timeline.markers[0].time).toBeCloseTo(2, 2);
  });

  it("keeps pieces contiguous with source continuity at fractional frame rates", async () => {
    useProjectStore.getState().loadProject(fixture({}, 29.97));
    await applySceneCuts(analysisFor([2.5, 4]), { splitClip: true, addMarkers: false });
    const pieces = clipsOf("v");
    expect(pieces).toHaveLength(3);
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].startTime).toBeCloseTo(pieces[i - 1].startTime + pieces[i - 1].duration, 9);
      expect(pieces[i].inPoint).toBeCloseTo(pieces[i - 1].outPoint, 9);
    }
    // snapped to the 29.97 grid
    const frame = 1 / 29.97;
    expect(pieces[1].startTime / frame).toBeCloseTo(Math.round(pieces[1].startTime / frame), 6);
  });
});
