import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { SilenceCutBridge } from "./silence-cut-bridge";
import { useProjectStore } from "../stores/project-store";

const makeClip = (id: string, trackId: string): Clip => ({
  id,
  trackId,
  mediaId: "media",
  startTime: 10,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
});
beforeEach(() => {
  useProjectStore.getState().createNewProject("Silence cuts QA");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 14,
        tracks: [
          {
            id: "video",
            type: "video",
            name: "Main",
            clips: [makeClip("video", "video")],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
          {
            id: "voice",
            type: "audio",
            name: "Dialogue",
            clips: [makeClip("voice", "voice")],
            transitions: [],
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
          },
        ],
      },
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
const setSyncLock = (trackId: string, syncLock: boolean) => {
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((track) =>
          track.id === trackId ? { ...track, syncLock } : track,
        ),
      },
    },
  });
};
describe("silence cuts on the real action engine", () => {
  it("cuts the selected track using absolute timeline positions and restores the whole operation with one Undo", async () => {
    // The picture track holds content over the cut, so it must opt out of Sync Lock.
    setSyncLock("video", false);
    const before = JSON.stringify(useProjectStore.getState().project.timeline);
    const progress: number[] = [];
    const result = await new SilenceCutBridge().cutSilence(
      "voice",
      [{ start: 1, end: 2, duration: 1 }],
      (value) => progress.push(value),
    );
    expect(result.success).toBe(true);
    expect(progress.at(-1)).toBe(100);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(1);
    const project = useProjectStore.getState().project;
    expect(project.timeline.tracks[0].clips).toEqual([
      makeClip("video", "video"),
    ]);
    expect(
      project.timeline.tracks[1].clips.map((clip) => ({
        start: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
      })),
    ).toEqual([
      { start: 10, duration: 1, inPoint: 0 },
      { start: 11, duration: 2, inPoint: 2 },
    ]);
    await useProjectStore.getState().undo();
    expect(JSON.stringify(useProjectStore.getState().project.timeline)).toBe(
      before,
    );
  });
  it("is blocked, naming the track and changing nothing, when a sync-locked track has content in the cut", async () => {
    const before = JSON.stringify(useProjectStore.getState().project.timeline);
    const result = await new SilenceCutBridge().cutSilence("voice", [
      { start: 1, end: 2, duration: 1 },
    ]);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/Sync Lock blocked this edit: "Main"/),
    });
    expect(JSON.stringify(useProjectStore.getState().project.timeline)).toBe(
      before,
    );
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("ripples a sync-locked track that is clear over the cut, in the same single undo step", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) =>
            track.id === "video"
              ? { ...track, clips: [{ ...makeClip("video", "video"), startTime: 20 }] }
              : track,
          ),
        },
      },
    });
    const tracksOf = () => JSON.stringify(useProjectStore.getState().project.timeline.tracks);
    const before = tracksOf();
    const result = await new SilenceCutBridge().cutSilence("voice", [
      { start: 1, end: 2, duration: 1 },
      { start: 3, end: 3.5, duration: 0.5 },
    ]);
    expect(result.success).toBe(true);
    const after = useProjectStore.getState().project;
    // 1.5s removed in total; the clear follower moved earlier by exactly that.
    expect(after.timeline.tracks[0].clips[0].startTime).toBeCloseTo(18.5, 6);
    expect(after.timeline.tracks[1].clips.reduce((sum, c) => sum + c.duration, 0)).toBeCloseTo(2.5, 6);
    expect(useProjectStore.getState().actionHistory.getUndoStackSize()).toBe(1);
    await useProjectStore.getState().undo();
    expect(tracksOf()).toBe(before);
  });
  it("rejects overlapping proposed pauses before editing", async () => {
    const before = JSON.stringify(useProjectStore.getState().project.timeline);
    const result = await new SilenceCutBridge().cutSilence("voice", [
      { start: 0.5, end: 2, duration: 1.5 },
      { start: 1, end: 3, duration: 2 },
    ]);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/overlap/),
    });
    expect(JSON.stringify(useProjectStore.getState().project.timeline)).toBe(
      before,
    );
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
  it("rejects locked tracks and stale analysis without changing another overlapping track", async () => {
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) =>
            track.id === "voice" ? { ...track, locked: true } : track,
          ),
        },
      },
    });
    const bridge = new SilenceCutBridge();
    expect(
      await bridge.cutSilence("voice", [{ start: 1, end: 2, duration: 1 }]),
    ).toMatchObject({ success: false, error: expect.stringMatching(/Unlock/) });
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) =>
            track.id === "voice"
              ? {
                  ...track,
                  clips: track.clips.map((clip) => ({
                    ...clip,
                    duration: 0.5,
                    outPoint: 0.5,
                  })),
                }
              : track,
          ),
        },
      },
    });
    expect(
      await bridge.cutSilence("voice", [{ start: 1, end: 2, duration: 1 }]),
    ).toMatchObject({
      success: false,
      error: expect.stringMatching(/Re-analyze/),
    });
    expect(useProjectStore.getState().getClip("video")).toEqual(
      makeClip("video", "video"),
    );
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
