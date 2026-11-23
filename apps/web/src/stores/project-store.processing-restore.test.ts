import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project } from "@openreel/core";
import { useProjectStore } from "./project-store";
import { createEmptyProject } from "./project/project-helpers";

const bridges = vi.hoisted(() => ({
  ready: false,
  effects: vi.fn(),
  transitions: vi.fn(),
}));
vi.mock("../bridges/effects-bridge", async original => ({
  ...await original<typeof import("../bridges/effects-bridge")>(),
  getEffectsBridge: () => ({
    isInitialized: () => bridges.ready,
    deserializeEffects: bridges.effects,
    clearEffects: vi.fn(),
  }),
}));
vi.mock("../bridges/transition-bridge", async original => ({
  ...await original<typeof import("../bridges/transition-bridge")>(),
  getTransitionBridge: () => ({
    isInitialized: () => bridges.ready,
    setTransitionsForTrack: bridges.transitions,
    clearTransitionsForTrack: vi.fn(),
  }),
}));

function savedProject(name: string): Project {
  const project = createEmptyProject(name);
  const clip: Clip = {
    id: `${name}-clip`, mediaId: "source", trackId: "main", startTime: 0,
    duration: 5, inPoint: 0, outPoint: 5, volume: 1, keyframes: [], audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 },
      anchor: { x: .5, y: .5 }, rotation: 0, opacity: 1 },
    effects: [{ id: "blur", type: "blur", enabled: true, params: { radius: 4 } }],
    colorGrading: { temperature: 12, lut: { size: 2, intensity: .6,
      data: Array.from({ length: 24 }, (_, index) => index * 10) } },
  };
  return { ...project, timeline: { ...project.timeline, duration: 5, tracks: [{
    id: "main", name: "Main", type: "video", clips: [clip], locked: false,
    hidden: false, muted: false, solo: false, transitions: [],
  }] } };
}

beforeEach(() => {
  bridges.ready = false;
  vi.clearAllMocks();
  useProjectStore.getState().loadProject(savedProject("Recovered"));
});

describe("processing restored after asynchronous renderer setup", () => {
  it("hydrates saved effects, grades and transitions without authoring or history changes", () => {
    const before = useProjectStore.getState().project;
    expect(bridges.effects).not.toHaveBeenCalled();
    bridges.ready = true;
    useProjectStore.getState().syncProjectProcessing();
    expect(bridges.effects).toHaveBeenCalledWith("Recovered-clip", {
      effects: [{ id: "blur", type: "blur", enabled: true, params: { radius: 4 }, order: 0 }],
      colorGrading: before.timeline.tracks[0].clips[0].colorGrading,
    });
    expect(bridges.transitions).toHaveBeenCalledWith("main", [], expect.any(Number));
    expect(useProjectStore.getState().project).toBe(before);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });

  it("uses the current project when recovery changes during bridge initialization", () => {
    const newer = savedProject("Newer");
    useProjectStore.getState().loadProject(newer);
    bridges.ready = true;
    useProjectStore.getState().syncProjectProcessing();
    expect(bridges.effects).toHaveBeenCalledOnce();
    expect(bridges.effects).toHaveBeenCalledWith("Newer-clip", expect.anything());
    expect(useProjectStore.getState().project.id).toBe(newer.id);
  });
});
