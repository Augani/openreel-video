import "../test/install-local-storage-mock";
import { describe, expect, it } from "vitest";
import { getSpeedEngine, type Clip, type Project } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { createEmptyProject } from "./project/project-helpers";

function fixture(): Project {
  const clip: Clip = {
    id: "source",
    trackId: "main",
    mediaId: "video",
    startTime: 0,
    duration: 4,
    inPoint: 4,
    outPoint: 12,
    speed: 2,
    reversed: true,
    volume: 0.8,
    fade: { fadeIn: 3, fadeOut: 3 },
    effects: [],
    audioEffects: [],
    keyframes: [
      { id: "start", time: 0, property: "opacity", value: 0, easing: "linear" },
      { id: "end", time: 4, property: "opacity", value: 1, easing: "linear" },
    ],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
      rotation: 0,
    },
  };
  return {
    ...createEmptyProject("Split source continuity"),
    mediaLibrary: {
      items: [
        {
          id: "video",
          name: "Source.mp4",
          type: "video",
          fileHandle: null,
          blob: new Blob(["video"]),
          thumbnailUrl: null,
          waveformData: new Float32Array(65536),
          metadata: {
            duration: 20,
            width: 640,
            height: 360,
            frameRate: 30,
            sampleRate: 48000,
            channels: 2,
            codec: "h264",
            fileSize: 5,
          },
        },
      ],
    },
    timeline: {
      duration: 4,
      markers: [],
      subtitles: [],
      tracks: [
        {
          id: "main",
          name: "Main",
          type: "video",
          hidden: false,
          locked: false,
          muted: false,
          solo: false,
          transitions: [],
          clips: [clip],
        },
      ],
    },
  };
}
describe("Split through the project store", () => {
  it("also refreshes playback through generic actions and retains a concurrent rename", async () => {
    useProjectStore.getState().loadProject(fixture());
    const pending = useProjectStore.getState().executeAction({
      id: "direct",
      type: "clip/split",
      timestamp: 1,
      params: { clipId: "source", time: 1.5 },
    });
    const rename = useProjectStore.getState().renameProject("Retained rename");
    expect((await pending).success).toBe(true);
    await rename;
    expect(useProjectStore.getState().project.name).toBe("Retained rename");
    expect(
      useProjectStore.getState().project.timeline.tracks[0].clips,
    ).toHaveLength(2);
    expect(getSpeedEngine().getSourceTimeAtPlaybackTime("source", 0.5)).toBe(2);
  });
  it("publishes both pieces once, synchronizes reverse playback and restores exact Undo/Redo without waveform traversal", async () => {
    useProjectStore.getState().loadProject(fixture());
    const before =
        useProjectStore.getState().project.timeline.tracks[0].clips[0],
      media = useProjectStore.getState().project.mediaLibrary,
      speed = getSpeedEngine();
    Object.assign(media.items[0].waveformData!, {
      toJSON() {
        throw new Error("Do not serialize media");
      },
    });
    expect(speed.getSourceTimeAtPlaybackTime("source", 0.5)).toBe(7);
    let publications = 0;
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project !== previous.project) publications++;
    });
    try {
      expect(
        (await useProjectStore.getState().splitClip("source", 1.5)).success,
      ).toBe(true);
      expect(publications).toBe(1);
      const after = useProjectStore.getState().project,
        pieces = after.timeline.tracks[0].clips;
      expect(pieces).toHaveLength(2);
      expect(pieces[0]).toMatchObject({
        inPoint: 9,
        outPoint: 12,
        duration: 1.5,
      });
      expect(pieces[1]).toMatchObject({
        inPoint: 4,
        outPoint: 9,
        startTime: 1.5,
        duration: 2.5,
      });
      expect(pieces[1].keyframes.map((key) => key.time)).toEqual([-1.5, 2.5]);
      expect(speed.getSourceTimeAtPlaybackTime("source", 0.5)).toBe(2);
      expect(after.mediaLibrary).toBe(media);
      await useProjectStore.getState().undo();
      expect(
        useProjectStore.getState().project.timeline.tracks[0].clips,
      ).toEqual([before]);
      expect(speed.getSourceTimeAtPlaybackTime("source", 0.5)).toBe(7);
      await useProjectStore.getState().redo();
      expect(
        useProjectStore.getState().project.timeline.tracks[0].clips,
      ).toEqual(pieces);
      expect(speed.getSourceTimeAtPlaybackTime("source", 0.5)).toBe(2);
      await useProjectStore.getState().undo();
    } finally {
      unsubscribe();
    }
  });
});
