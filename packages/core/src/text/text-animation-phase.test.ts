import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM, type TextAnimation, type TextClip } from "./types";
import type { Project } from "../types";
import { TextAnimationEngine } from "./text-animation";
import { CharacterAnimator } from "./character-animator";
import { createProjectSerializer } from "../storage/project-serializer";
import { createStorageEngine } from "../storage/storage-engine";
import { calculateUnitAnimationState } from "./text-animation-presets";

const engine = new TextAnimationEngine();
const animation: TextAnimation = {
  preset: "rise", params: { slideDistance: 36, blurAmount: 8, easing: "linear" },
  inDuration: 0.6, outDuration: 0.4, unit: "word", stagger: 0.08,
  out: { preset: "fade", params: { easing: "linear" }, unit: "line", stagger: 0 },
};
const clip = (animation?: TextAnimation): TextClip => ({
  id: "title", trackId: "titles", startTime: 10, duration: 4, text: "Golden Hour",
  style: { ...DEFAULT_TEXT_STYLE, shader: { shaderId: "paper-mesh-gradient", params: { color1: "#ee55aa" } } },
  transform: { ...DEFAULT_TEXT_TRANSFORM, opacity: 0.8 }, animation, keyframes: [],
});

describe("independent text animation phases", () => {
  it("rises on entry, holds, and fades on exit while preserving the clip's opacity, material and transform", () => {
    const original = clip(animation);
    const before = structuredClone(original);
    const entry = engine.getAnimatedState(original, 0.3);
    expect(entry.opacity).toBeGreaterThan(0);
    expect(entry.opacity).toBeLessThan(0.8);
    expect(entry.transform.position.y).toBeGreaterThan(0.5);
    const hold = engine.getAnimatedState(original, 2);
    expect(hold.transform).toEqual(original.transform);
    const exit = engine.getAnimatedState(original, 3.8);
    expect(exit.opacity).toBeCloseTo(0.4);
    expect(exit.transform).toEqual({ ...original.transform, opacity: exit.opacity });
    expect(exit.style).toEqual(original.style);
    expect(engine.getAnimatedState(original, 4).opacity).toBeCloseTo(0);
    expect(original).toEqual(before);
  });

  it("supports exit-only and entry-only titles, with legacy shared exits still available", () => {
    const exitOnly = clip({ ...animation, preset: "none", inDuration: 0 });
    expect(engine.getAnimatedState(exitOnly, 2).transform).toEqual(exitOnly.transform);
    expect(engine.getAnimatedState(exitOnly, 3.8).opacity).toBeCloseTo(0.4);
    const entryOnly = clip({ ...animation, out: { preset: "none", params: {} } });
    expect(engine.getAnimatedState(entryOnly, 3.9).transform).toEqual(entryOnly.transform);
    const legacy = clip({ ...animation, out: undefined });
    expect(engine.getAnimatedState(legacy, 3.8).transform.scale.x).toBeLessThan(1);
  });

  it("uses the exit's own unit, stagger and parameters in character layouts and direct preset sampling", () => {
    const animator = new CharacterAnimator();
    const original = clip(animation);
    const layout = animator.calculateAnimatedLayout(original, 13.8);
    const characters = layout.lines.flatMap(line => line.animatedWords.flatMap(word => word.animatedChars));
    expect(characters.length).toBeGreaterThan(2);
    for (const character of characters) {
      expect(character.state.opacity).toBeCloseTo(0.5);
      expect(character.state.offsetY).toBe(0);
      expect(character.state.scale).toEqual({ x: 1, y: 1 });
    }
    const state = calculateUnitAnimationState({ animation, isIn: false, progress: 0.5, totalDuration: 4,
      unit: { text: "Title", index: 0, totalUnits: 1, x: 0, y: 0, width: 100, height: 40 } });
    expect(state.opacity).toBeCloseTo(0.5);
    expect(state.offsetY).toBe(0);
  });

  it("composes explicit phases with keyframes while retaining untouched legacy keyframe precedence", () => {
    const original = { ...clip(animation),
      transform: { ...clip(animation).transform, rotate3d: { x: 10, y: 20, z: 0 } },
      keyframes: [{ id: "opacity", time: 0, property: "opacity", value: 0.3, easing: "linear" as const }],
    };
    const state = engine.getAnimatedState(original, 3.8);
    expect(state.opacity).toBeCloseTo(0.15);
    expect(state.transform.rotate3d).toEqual(original.transform.rotate3d);
    expect(engine.getAnimatedState({ ...original, animation: { ...animation, out: undefined } }, 3.8).opacity).toBeCloseTo(0.3);
  });

  it("round trips both phases through the actual project JSON serializer", () => {
    const project: Project = { id: "phases", name: "Phases", createdAt: 0, modifiedAt: 0,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [] }, timeline: { tracks: [], duration: 14, subtitles: [], markers: [] }, textClips: [clip(animation)],
    };
    const serializer = createProjectSerializer(createStorageEngine());
    const restored = serializer.importFromJson(serializer.exportToJson(project));
    expect(restored.textClips?.[0]).toEqual(project.textClips![0]);
    expect(engine.getAnimatedState(restored.textClips![0], 3.8)).toEqual(engine.getAnimatedState(project.textClips![0], 3.8));
  });
});
