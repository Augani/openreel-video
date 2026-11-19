import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@openreel/core";
import { applyWhiteBalance } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { applyWhiteBalancePick, clipNeedsWhiteBalanceInputFrame, previewWhiteBalancePick } from "./white-balance-eyedropper";

vi.mock("../bridges/effects-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bridges/effects-bridge")>()),
  getEffectsBridge: () => ({ isInitialized: () => false }),
}));

const clip: Clip = {
  id: "wb",
  mediaId: "media",
  trackId: "main",
  startTime: 2,
  duration: 4,
  inPoint: 0,
  outPoint: 4,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  colorGrading: { temperature: 20, tint: -5 },
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, opacity: 1, rotation: 0 },
};
const current = () => useProjectStore.getState().getClip(clip.id)!;
const historySize = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();

function load(next: Clip): void {
  useProjectStore.getState().createNewProject("WB eyedropper");
  const project = useProjectStore.getState().project;
  useProjectStore.setState({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        duration: 8,
        tracks: [
          { id: "main", name: "Main", type: "video", clips: [structuredClone(next)], transitions: [], locked: false, hidden: false, muted: false, solo: false },
        ],
      },
    },
  });
  useTimelineStore.setState({ playheadPosition: 3 });
}

beforeEach(() => load(clip));

describe("White balance eyedropper service", () => {
  it("replaces Temperature and Tint in one undoable step and the picked sample ends up neutral", async () => {
    // What the monitor shows: a neutral-ish source cast by the clip's current 20 / -5.
    const source: [number, number, number] = [0.5, 0.46, 0.41];
    const shown = applyWhiteBalance(source, 20, -5);
    const before = historySize();
    const result = await applyWhiteBalancePick(clip.id, shown);
    expect(result.ok).toBe(true);
    expect(historySize()).toBe(before + 1);
    const grade = current().colorGrading!;
    const after = applyWhiteBalance(source, grade.temperature!, grade.tint!);
    expect(Math.max(...after) - Math.min(...after)).toBeLessThan(1 / 255);

    await useProjectStore.getState().undo();
    expect(current().colorGrading).toMatchObject({ temperature: 20, tint: -5 });
  });

  it("keeps the rest of the grade", async () => {
    load({ ...clip, colorGrading: { temperature: 0, tint: 0, pipelineVersion: 2, tone: { exposure: 0.2, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } } });
    await applyWhiteBalancePick(clip.id, [0.6, 0.5, 0.4]);
    expect(current().colorGrading?.tone?.exposure).toBe(0.2);
    expect(current().colorGrading?.temperature).toBeLessThan(0);
  });

  it("refuses unusable samples, a playhead off the clip, and keyframed white balance without writing", async () => {
    const before = historySize();
    expect(await applyWhiteBalancePick(clip.id, [1, 1, 1])).toEqual({ ok: false, reason: "unusable-sample" });
    expect(await applyWhiteBalancePick(clip.id, null)).toEqual({ ok: false, reason: "no-frame" });
    useTimelineStore.setState({ playheadPosition: 7 });
    expect(previewWhiteBalancePick(clip.id, [0.5, 0.5, 0.4])).toEqual({ ok: false, reason: "outside-clip" });
    useTimelineStore.setState({ playheadPosition: 3 });
    expect(historySize()).toBe(before);
    load({ ...clip, keyframes: [{ id: "k", property: "colorGrade.temperature", time: 0, value: 10, easing: "linear" }] });
    const keyedBefore = historySize();
    expect(await applyWhiteBalancePick(clip.id, [0.5, 0.5, 0.4])).toEqual({ ok: false, reason: "keyframed" });
    expect(historySize()).toBe(keyedBefore);
  });

  it("refuses a clip that no longer exists", () => {
    expect(previewWhiteBalancePick("missing", [0.5, 0.5, 0.5])).toEqual({ ok: false, reason: "no-clip" });
  });

  it("treats an input-frame sample as already free of the clip's white balance", () => {
    const sample: [number, number, number] = [0.55, 0.5, 0.45];
    const displayed = previewWhiteBalancePick(clip.id, sample, false);
    const input = previewWhiteBalancePick(clip.id, sample, true);
    expect(input.ok && displayed.ok && input.solution.temperature !== displayed.solution.temperature).toBe(true);
    // Solved from zero: applying the result to the sample neutralises it.
    if (input.ok) {
      const after = applyWhiteBalance(sample, input.solution.temperature, input.solution.tint);
      expect(Math.max(...after) - Math.min(...after)).toBeLessThan(1 / 255);
    }
  });

  it("flags strongly coloured samples without blocking the pick", () => {
    const brown = previewWhiteBalancePick(clip.id, [31 / 255, 22 / 255, 14 / 255], true);
    expect(brown.ok && brown.farFromNeutral).toBe(true);
    const wall = previewWhiteBalancePick(clip.id, [0.55, 0.5, 0.45], true);
    expect(wall.ok && wall.farFromNeutral).toBe(false);
  });

  it("needs the stage input frame when later grade stages follow white balance", () => {
    load({ ...clip, colorGrading: { pipelineVersion: 2, tone: { exposure: 0, contrast: 60, highlights: 0, shadows: 0, whites: 0, blacks: 0 } } });
    expect(clipNeedsWhiteBalanceInputFrame(clip.id)).toBe(true);
    load({ ...clip, colorGrading: { pipelineVersion: 2 } });
    expect(clipNeedsWhiteBalanceInputFrame(clip.id)).toBe(false);
  });
});
