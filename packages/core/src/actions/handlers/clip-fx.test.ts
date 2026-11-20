import { describe, it, expect } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Project } from "../../types/project";
import type { Action } from "../../types/actions";
import type {
  ChromaKeySettings,
  SpeedKeyframe,
} from "../../types/timeline";

function makeProjectWithClip(overrides: Record<string, unknown> = {}): Project {
  const clip = {
    id: "c1",
    mediaId: "m1",
    trackId: "t1",
    startTime: 0,
    duration: 5,
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
    ...overrides,
  };
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
      duration: 5,
      subtitles: [],
      markers: [],
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

function act(type: string, params: Record<string, unknown>): Action {
  return { type, id: `a-${type}`, timestamp: Date.now(), params };
}

function clipOf(project: Project) {
  return project.timeline.tracks[0].clips[0];
}

describe("clip fx handlers", () => {
  it("clip/setSpeed sets speed and is undoable", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({ speed: 1 });

    const res = await executor.execute(act("clip/setSpeed", { clipId: "c1", speed: 2 }), project);
    expect(res.success).toBe(true);
    expect(clipOf(project).speed).toBe(2);

    await executor.undo(project);
    expect(clipOf(project).speed).toBe(1);
  });

  it("clip/setSpeed clamps out-of-range speed", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({ speed: 1 });
    await executor.execute(act("clip/setSpeed", { clipId: "c1", speed: 999 }), project);
    expect(clipOf(project).speed).toBeLessThanOrEqual(20);
  });

  it("clip/setSpeed rejects unknown clip", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const res = await executor.execute(act("clip/setSpeed", { clipId: "nope", speed: 2 }), project);
    expect(res.success).toBe(false);
  });

  it("clip/setColorInterpretation sets a per-clip Interpret Footage override, validates it, and is undoable", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const set = await executor.execute(act("clip/setColorInterpretation", { clipId: "c1", colorInterpretation: "log-logc3" }), project);
    expect(set.success).toBe(true);
    expect(clipOf(project).colorInterpretation).toBe("log-logc3");
    await executor.execute(act("clip/setColorInterpretation", { clipId: "c1", colorInterpretation: "aces-acescg" }), project);
    expect(clipOf(project).colorInterpretation).toBe("aces-acescg");
    // Clearing restores "use the footage setting".
    await executor.execute(act("clip/setColorInterpretation", { clipId: "c1", colorInterpretation: null }), project);
    expect(clipOf(project).colorInterpretation).toBeUndefined();
    await executor.undo(project);
    expect(clipOf(project).colorInterpretation).toBe("aces-acescg");
    await executor.undo(project);
    expect(clipOf(project).colorInterpretation).toBe("log-logc3");
    await executor.undo(project);
    expect(clipOf(project).colorInterpretation).toBeUndefined();
    const bad = await executor.execute(act("clip/setColorInterpretation", { clipId: "c1", colorInterpretation: "ocio:Rec709" }), project);
    expect(bad.success).toBe(false);
    const missing = await executor.execute(act("clip/setColorInterpretation", { clipId: "nope", colorInterpretation: "srgb" }), project);
    expect(missing.success).toBe(false);
  });

  it("clip/setReverse toggles reversed and is undoable", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip({ reversed: false });
    await executor.execute(act("clip/setReverse", { clipId: "c1", reversed: true }), project);
    expect(clipOf(project).reversed).toBe(true);
    await executor.undo(project);
    expect(clipOf(project).reversed).toBe(false);
  });

  it("clip/setChromaKey sets and undoes", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const chromaKey: ChromaKeySettings = {
      enabled: true,
      keyColor: { r: 0, g: 1, b: 0 },
      tolerance: 0.3,
      edgeSoftness: 0.1,
      spillSuppression: 0.5,
    };
    await executor.execute(act("clip/setChromaKey", { clipId: "c1", chromaKey }), project);
    expect(clipOf(project).chromaKey?.enabled).toBe(true);
    await executor.undo(project);
    expect(clipOf(project).chromaKey).toBeUndefined();
  });

  it("speed/setKeyframes sets and undoes speed ramp", async () => {
    const executor = new ActionExecutor();
    const project = makeProjectWithClip();
    const keyframes: SpeedKeyframe[] = [
      { id: "k1", time: 0, speed: 1, easing: "linear" },
      { id: "k2", time: 2, speed: 2, easing: "linear" },
    ];
    await executor.execute(act("speed/setKeyframes", { clipId: "c1", keyframes }), project);
    expect(clipOf(project).speedKeyframes).toHaveLength(2);
    await executor.undo(project);
    expect(clipOf(project).speedKeyframes ?? []).toHaveLength(0);
  });
});
