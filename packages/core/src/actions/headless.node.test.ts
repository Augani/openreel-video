import { describe, it, expect } from "vitest";
import { ActionExecutor } from "./action-executor";
import { CAPABILITY_MANIFEST } from "../capabilities/manifest";
import type { Project } from "../types/project";
import type { Action } from "../types/actions";

function makeProject(): Project {
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
  };
  return {
    id: "p1",
    name: "Headless",
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

const act = (type: string, params: Record<string, unknown>): Action => ({
  type,
  id: `a-${type}-${Math.round(params.startTime as number) || 0}`,
  timestamp: Date.now(),
  params,
});

describe("headless core editing (Node environment)", () => {
  it("runs without any browser globals", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("applies edits across many domains and undoes/redoes with no renderer", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const actions: Action[] = [
      act("track/add", { trackType: "text" }),
      act("clip/setSpeed", { clipId: "c1", speed: 2 }),
      act("clip/setReverse", { clipId: "c1", reversed: true }),
      act("clip/setStabilization", {
        clipId: "c1",
        stabilization: { enabled: true, strength: 0.5, cropMode: "auto" },
      }),
      act("clip/setChromaKey", {
        clipId: "c1",
        chromaKey: {
          enabled: true,
          keyColor: { r: 0, g: 1, b: 0 },
          tolerance: 0.3,
          edgeSoftness: 0.1,
          spillSuppression: 0.5,
        },
      }),
      act("clip/setBlendMode", { clipId: "c1", blendMode: "screen" }),
      act("clip/setBlendOpacity", { clipId: "c1", opacity: 0.5 }),
      act("transform/update", { clipId: "c1", transform: { opacity: 0.8 } }),
      act("marker/add", { time: 1, label: "M1", color: "#fff" }),
      act("speed/setKeyframes", {
        clipId: "c1",
        keyframes: [{ id: "k1", time: 0, speed: 1, easing: "linear" }],
      }),
    ];

    for (const action of actions) {
      const result = await executor.execute(action, project);
      expect(result.success).toBe(true);
    }

    expect(project.timeline.tracks).toHaveLength(2);
    expect(project.timeline.tracks[0].clips[0].speed).toBe(2);

    const undo1 = await executor.undo(project);
    expect(undo1.success).toBe(true);
    const redo1 = await executor.redo(project);
    expect(redo1.success).toBe(true);
  });

  it("exposes the capability manifest headlessly", () => {
    expect(CAPABILITY_MANIFEST.blendModes).toContain("screen");
    expect(CAPABILITY_MANIFEST.transitionTypes.length).toBeGreaterThan(0);
  });
});
