import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { TitleEngine, type TextAnimation } from "@openreel/core";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { updateTextAnimationPhase } from "./text-animation-phases";

let id: string;
const state = () => useProjectStore.getState();
const legacy: TextAnimation = { preset: "rise", inDuration: 0.6, outDuration: 0.4,
  unit: "word", stagger: 0.12, params: { easing: "linear", slideDistance: 52, blurAmount: 13 },
};
beforeEach(() => {
  useEngineStore.setState({ titleEngine: new TitleEngine() });
  state().createNewProject("Animation phases");
  const track = state().project.timeline.tracks.find(track => track.type === "text")!;
  id = state().createTextClip(track.id, 0, "Golden Hour", 4, {
    shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ffeeaa" } }, shadowBlur: 12,
  })!.id;
  state().updateTextAnimation(id, legacy);
  state().actionHistory.clear();
  useUIStore.setState({ effectApplicationClipId: null, exportState: { isExporting: false, progress: 0, phase: "" } });
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused" });
});

describe("text phase authoring", () => {
  it("sets an independent exit in one Undo and preserves entry parameters, material and geometry", async () => {
    const before = structuredClone(state().getTextClip(id)!);
    updateTextAnimationPhase(id, "exit", "fade", 0.6, 0.4, { easing: "linear" });
    expect(state().getTextClip(id)).toEqual({ ...before, animation: { ...legacy,
      out: { preset: "fade", params: { fadeOpacity: { start: 0, end: 1 }, easing: "linear" } },
    } });
    expect((await state().undo()).success).toBe(true);
    expect(state().getTextClip(id)).toEqual(before);
    expect(state().canUndo()).toBe(false);
    expect((await state().redo()).success).toBe(true);
    expect(state().getTextClip(id)?.animation?.out?.preset).toBe("fade");
  });

  it("freezes a legacy exit when changing entry, then retains its parameters across timing edits", () => {
    updateTextAnimationPhase(id, "entry", "slide-left", 0.6, 0.4, { slideDistance: 0.35 });
    const changed = state().getTextClip(id)!.animation!;
    expect(changed.out).toEqual({ preset: legacy.preset, params: legacy.params, unit: "word", stagger: 0.12 });
    state().applyTextAnimationPreset(id, "slide-left", 0.8, 0.7);
    expect(state().getTextClip(id)?.animation).toMatchObject({
      inDuration: 0.8, outDuration: 0.7, params: { slideDistance: 0.35 }, out: changed.out,
    });
  });

  it("keeps repeated unchanged edits out of history", () => {
    updateTextAnimationPhase(id, "entry", "rise", 0.6, 0.4);
    expect(state().canUndo()).toBe(false);
    expect(state().getTextClip(id)?.animation).toEqual(legacy);
  });

  it.each(["track", "export"] as const)("honors a current %s lock", lock => {
    if (lock === "track") {
      const project = state().project;
      useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline,
        tracks: project.timeline.tracks.map(track => ({ ...track, locked: true })),
      } } });
    }
    if (lock === "export") useUIStore.setState({ exportState: { isExporting: true, progress: 0, phase: "Encoding" } });
    expect(updateTextAnimationPhase(id, "exit", "fade", 0.6, 0.4)).toBeNull();
    expect(state().getTextClip(id)?.animation).toEqual(legacy);
    expect(state().canUndo()).toBe(false);
  });
});
