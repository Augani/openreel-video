import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, ClipColorGrading } from "@openreel/core";
import { DEFAULT_TONE, createDefaultHueCurves } from "@openreel/core";
import { useProjectStore } from "./project-store";

vi.mock("../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const baseClip = (id: string, colorGrading?: ClipColorGrading): Clip => ({
  id,
  mediaId: "media",
  trackId: "main",
  startTime: 0,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  ...(colorGrading ? { colorGrading } : {}),
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
    rotation: 0,
  },
});

const current = (id: string) => useProjectStore.getState().getClip(id)!;

beforeEach(() => {
  useProjectStore.getState().createNewProject("Color pipeline");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 5,
        tracks: [
          {
            id: "main",
            name: "Main",
            type: "video",
            clips: [
              baseClip("fresh"),
              baseClip("saved", { tone: { ...DEFAULT_TONE, exposure: 0.2 } }),
            ],
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

describe("colour pipeline versioning", () => {
  it("gives a clip's first grade the Premiere-order pipeline", async () => {
    await useProjectStore.getState().updateColorGrading("fresh", { tone: { ...DEFAULT_TONE, shadows: 0.3 } });
    expect(current("fresh").colorGrading?.pipelineVersion).toBe(2);
  });

  it("leaves a clip that already has a grade on the classic order (no version stored)", async () => {
    await useProjectStore.getState().updateColorGrading("saved", { tone: { ...DEFAULT_TONE, exposure: 0.2, whites: 0.1 } });
    expect(current("saved").colorGrading).not.toHaveProperty("pipelineVersion");
  });

  it("switching a classic clip to Premiere order is an explicit, undoable edit", async () => {
    await useProjectStore.getState().updateColorGrading("saved", { pipelineVersion: 2 });
    expect(current("saved").colorGrading?.pipelineVersion).toBe(2);
    expect(current("saved").colorGrading?.tone?.exposure).toBe(0.2);
    await useProjectStore.getState().undo();
    expect(current("saved").colorGrading).not.toHaveProperty("pipelineVersion");
  });

  it("stores hue curves on the clip through the undoable grading action", async () => {
    const hueCurves = createDefaultHueCurves();
    hueCurves.hueVsSat = [
      { x: 0, y: 0.5 },
      { x: 0.3, y: 0.9 },
      { x: 1, y: 0.5 },
    ];
    await useProjectStore.getState().updateColorGrading("fresh", { hueCurves });
    expect(current("fresh").colorGrading?.hueCurves?.hueVsSat).toEqual(hueCurves.hueVsSat);
    expect(useProjectStore.getState().getColorGrading("fresh").hueCurves).toEqual(hueCurves);
    await useProjectStore.getState().undo();
    expect(current("fresh").colorGrading).toBeUndefined();
    await useProjectStore.getState().redo();
    expect(current("fresh").colorGrading?.hueCurves?.hueVsSat).toEqual(hueCurves.hueVsSat);
  });
});
