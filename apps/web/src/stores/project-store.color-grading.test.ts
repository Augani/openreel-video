import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip, ClipColorGrading } from "@openreel/core";
import { useProjectStore } from "./project-store";

vi.mock("../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));
const grade: ClipColorGrading = {
  temperature: 12,
  tint: -3,
  lut: {
    size: 2,
    intensity: 0.6,
    data: Array.from({ length: 24 }, (_, i) => i * 10),
  },
};
const clip: Clip = {
  id: "graded",
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
  colorGrading: grade,
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
  useProjectStore.getState().createNewProject("Color grading persistence");
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

describe("saved color grading without a ready GPU bridge", () => {
  it("reads the persisted LUT as typed runtime data after project load", () => {
    useProjectStore
      .getState()
      .loadProject(
        JSON.parse(JSON.stringify(useProjectStore.getState().project)),
      );
    const value = useProjectStore.getState().getColorGrading(clip.id);
    expect(value.temperature).toBe(12);
    expect(value.lut?.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(value.lut!.data)).toEqual(grade.lut!.data);
  });
  it("preserves other grades while editing and restores values with Undo and Redo", async () => {
    expect(
      await useProjectStore
        .getState()
        .updateColorGrading(clip.id, { temperature: 22 }),
    ).toBe(true);
    expect(current().colorGrading).toEqual({ ...grade, temperature: 22 });
    expect(JSON.parse(JSON.stringify(current().colorGrading)).lut.data).toEqual(
      grade.lut!.data,
    );
    await useProjectStore.getState().undo();
    expect(current().colorGrading).toEqual(grade);
    await useProjectStore.getState().redo();
    expect(current().colorGrading?.temperature).toBe(22);
  });
  it("clears a provided undefined LUT without clearing white balance", async () => {
    expect(
      await useProjectStore
        .getState()
        .updateColorGrading(clip.id, { lut: undefined }),
    ).toBe(true);
    expect(current().colorGrading).toEqual({ temperature: 12, tint: -3 });
    await useProjectStore.getState().undo();
    expect(current().colorGrading).toEqual(grade);
  });
  it("serializes a newly supplied typed LUT and resets all grades through the same undo history", async () => {
    expect(
      await useProjectStore
        .getState()
        .updateColorGrading(clip.id, {
          lut: {
            ...grade.lut!,
            data: new Uint8Array(grade.lut!.data), floatData: undefined, curve1d: undefined,
            intensity: 0.8,
          },
        }),
    ).toBe(true);
    expect(Array.isArray(current().colorGrading?.lut?.data)).toBe(true);
    expect(await useProjectStore.getState().resetColorGrading(clip.id)).toBe(
      true,
    );
    expect(current().colorGrading).toBeUndefined();
    await useProjectStore.getState().undo();
    expect(current().colorGrading?.lut?.intensity).toBe(0.8);
  });
  it("rejects missing clips and locked tracks without publishing a grade", async () => {
    expect(
      await useProjectStore
        .getState()
        .updateColorGrading("missing", { tint: 20 }),
    ).toBe(false);
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((track) => ({
            ...track,
            locked: true,
          })),
        },
      },
    });
    expect(
      await useProjectStore
        .getState()
        .updateColorGrading(clip.id, { tint: 20 }),
    ).toBe(false);
    expect(current().colorGrading).toEqual(grade);
    expect(useProjectStore.getState().canUndo()).toBe(false);
  });
});
