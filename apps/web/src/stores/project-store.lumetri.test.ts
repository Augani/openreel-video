import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, ClipColorGrading } from "@openreel/core";
import { DEFAULT_TONE, DEFAULT_VIGNETTE } from "@openreel/core";
import { useProjectStore } from "./project-store";

vi.mock("../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const legacyGrade: ClipColorGrading = { temperature: 5, tint: -2 };
const clip: Clip = {
  id: "lumetri",
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
  colorGrading: legacyGrade,
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
    rotation: 0,
  },
};
const current = () => useProjectStore.getState().getClip(clip.id)!;

beforeEach(() => {
  useProjectStore.getState().createNewProject("Lumetri persistence");
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
            clips: [structuredClone(clip)],
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

describe("Basic Correction and vignette grading actions", () => {
  it("stores tone and vignette on the clip and keeps the rest of the grade", async () => {
    const tone = { ...DEFAULT_TONE, shadows: 0.5, highlights: -0.25 };
    const vignette = { ...DEFAULT_VIGNETTE, amount: -0.4 };
    expect(await useProjectStore.getState().updateColorGrading(clip.id, { tone, vignette })).toBe(true);
    expect(current().colorGrading).toEqual({ ...legacyGrade, tone, vignette });
    expect(useProjectStore.getState().getColorGrading(clip.id).tone).toEqual(tone);
  });

  it("undo restores the previous grade and redo reapplies it; a slider drag is one step", async () => {
    // Back-to-back edits of the same clip's grade coalesce into one undo step, like any slider drag.
    await useProjectStore.getState().updateColorGrading(clip.id, { tone: { ...DEFAULT_TONE, exposure: 0.3 } });
    await useProjectStore.getState().updateColorGrading(clip.id, { tone: { ...DEFAULT_TONE, exposure: 0.3, whites: 0.4 } });
    expect(current().colorGrading?.tone?.whites).toBe(0.4);
    await useProjectStore.getState().undo();
    expect(current().colorGrading).toEqual(legacyGrade);
    expect(current().colorGrading).not.toHaveProperty("tone");
    await useProjectStore.getState().redo();
    expect(current().colorGrading?.tone).toEqual({ ...DEFAULT_TONE, exposure: 0.3, whites: 0.4 });
  });

  it("round-trips through JSON and an old grade without tone loads untouched", () => {
    const project = JSON.parse(JSON.stringify(useProjectStore.getState().project));
    useProjectStore.getState().loadProject(project);
    const grade = useProjectStore.getState().getColorGrading(clip.id);
    expect(grade.temperature).toBe(5);
    expect(grade.tone).toBeUndefined();
    expect(grade.vignette).toBeUndefined();
  });

  it("Reset All clears tone and vignette in one undoable step", async () => {
    await useProjectStore.getState().updateColorGrading(clip.id, { tone: { ...DEFAULT_TONE, blacks: -0.3 } });
    expect(await useProjectStore.getState().resetColorGrading(clip.id)).toBe(true);
    expect(current().colorGrading).toBeUndefined();
    await useProjectStore.getState().undo();
    expect(current().colorGrading?.tone?.blacks).toBe(-0.3);
  });
});
