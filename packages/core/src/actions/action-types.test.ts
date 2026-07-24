import { describe, it, expect } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Project } from "../types/project";
import type { Action, ClipAction } from "../types/actions";
import type { Clip } from "../types/timeline";

function makeProjectWithTwoClips(): Project {
  const base = {
    mediaId: "m1",
    trackId: "t1",
    inPoint: 0,
    outPoint: 5,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      anchor: { x: 0.5, y: 0.5 },
      rotation: 0,
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
  const c1 = { ...base, id: "c1", startTime: 0, duration: 5 };
  const c2 = { ...base, id: "c2", startTime: 5, duration: 5 };
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: {
      duration: 10,
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [c1, c2],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

function dispatch(a: ClipAction): Action {
  return { ...a, id: `a-${a.type}`, timestamp: Date.now() } as unknown as Action;
}

describe("ClipAction union completeness", () => {
  it("types and dispatches clip/slip", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithTwoClips();
    const slip: ClipAction = { type: "clip/slip", params: { clipId: "c1", delta: 1 } };

    const result = await executor.execute(dispatch(slip), project);

    expect(result.success).toBe(true);
    const clip = project.timeline.tracks[0].clips.find((c) => c.id === "c1");
    expect(clip?.inPoint).toBe(1);
  });

  it("accepts every executor-handled clip op as a typed ClipAction", () => {
    const fixtureClip = {
      ...makeProjectWithTwoClips().timeline.tracks[0].clips[0],
    } as Clip;

    const actions: ClipAction[] = [
      { type: "clip/slide", params: { clipId: "c1", delta: 1, nextClipId: "c2" } },
      { type: "clip/roll", params: { leftClipId: "c1", rightClipId: "c2", delta: 1 } },
      { type: "clip/merge", params: { clipId: "c1", originalClip: fixtureClip } },
      {
        type: "clip/trimToPlayhead",
        params: { clipId: "c1", playheadTime: 2, trimStart: true },
      },
      { type: "clip/closeGapBefore", params: { clipId: "c2" } },
      { type: "clip/restore", params: { clip: fixtureClip } },
      {
        type: "clip/rippleRestore",
        params: {
          clip: fixtureClip,
          affectedClips: [{ id: "c2", originalStartTime: 5 }],
        },
      },
    ];

    expect(actions).toHaveLength(7);
  });
});
