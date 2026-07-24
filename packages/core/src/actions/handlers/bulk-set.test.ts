import { describe, it, expect } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Project } from "../../types/project";
import type { Action } from "../../types/actions";

function makeProject(): Project {
  const clip = {
    id: "c1",
    mediaId: "m1",
    trackId: "t1",
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    effects: [
      { id: "e1", type: "blur", params: {}, enabled: true },
      { id: "e2", type: "vignette", params: {}, enabled: true },
    ],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      anchor: { x: 0.5, y: 0.5 },
      rotation: 0,
      opacity: 1,
    },
    volume: 1,
    keyframes: [
      { id: "k1", time: 0, property: "opacity", value: 1, easing: "linear" },
    ],
  };
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 5,
      markers: [],
      subtitles: [
        { id: "s1", text: "hello", startTime: 0, endTime: 2 },
      ],
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [clip],
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

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}`,
  timestamp: Date.now(),
  params,
});

const clip = (p: Project) => p.timeline.tracks[0].clips[0];

describe("bulk-set handlers", () => {
  it("effect/setOrder reorders effects and undoes", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("effect/setOrder", { clipId: "c1", effectIds: ["e2", "e1"] }), project);
    expect(clip(project).effects.map((e) => e.id)).toEqual(["e2", "e1"]);
    await executor.undo(project);
    expect(clip(project).effects.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("effect/setOrder rejects an invalid permutation", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const res = await executor.execute(act("effect/setOrder", { clipId: "c1", effectIds: ["e1"] }), project);
    expect(res.success).toBe(false);
  });

  it("effect/setStack replaces the authored stack and undoes", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const replacement = [
      { id: "e3", type: "glow", enabled: false, params: { radius: 28 } },
    ];

    await executor.execute(
      act("effect/setStack", { clipId: "c1", effects: replacement }),
      project,
    );
    expect(clip(project).effects).toEqual(replacement);

    await executor.undo(project);
    expect(clip(project).effects.map((effect) => effect.id)).toEqual(["e1", "e2"]);
  });

  it("keyframe/setAll replaces keyframes and undoes", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const next = [
      { id: "k2", time: 1, property: "opacity", value: 0.5, easing: "linear" },
      { id: "k3", time: 2, property: "opacity", value: 0, easing: "linear" },
    ];
    await executor.execute(act("keyframe/setAll", { clipId: "c1", keyframes: next }), project);
    expect(clip(project).keyframes).toHaveLength(2);
    await executor.undo(project);
    expect(clip(project).keyframes).toHaveLength(1);
  });

  it("subtitle/replace updates a subtitle and undoes", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(
      act("subtitle/replace", { subtitleId: "s1", subtitle: { id: "s1", text: "world", startTime: 0, endTime: 3 } }),
      project,
    );
    expect(project.timeline.subtitles[0].text).toBe("world");
    expect(project.timeline.subtitles[0].endTime).toBe(3);
    await executor.undo(project);
    expect(project.timeline.subtitles[0].text).toBe("hello");
  });
});
