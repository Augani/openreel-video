import { describe, expect, it } from "vitest";
import type { TextAnimationPreset } from "./types";
import {
  TEXT_ANIMATION_PRESETS,
  calculateUnitAnimationState,
  createDefaultAnimation,
  type TextAnimationContext,
} from "./text-animation-presets";

const NEW_ENTRANCES: TextAnimationPreset[] = [
  "rise",
  "drop",
  "elastic",
  "swing",
  "zoom-blur",
  "cascade",
];

function context(
  preset: TextAnimationPreset,
  progress: number,
  index = 0,
  totalUnits = 1,
): TextAnimationContext {
  return {
    unit: {
      text: "OpenReel",
      index,
      totalUnits,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    },
    progress,
    isIn: true,
    animation: createDefaultAnimation(preset),
    totalDuration: 3,
  };
}

describe("text animation preset library", () => {
  it("publishes a unique 25-preset catalog with the polished entrance pack", () => {
    const ids = TEXT_ANIMATION_PRESETS.map((preset) => preset.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(NEW_ENTRANCES));
  });

  it.each(NEW_ENTRANCES)("settles %s into a stable final state", (preset) => {
    const start = calculateUnitAnimationState(context(preset, 0));
    const end = calculateUnitAnimationState(context(preset, 1));

    expect(start.opacity).toBeLessThanOrEqual(0.001);
    expect(end.opacity).toBeCloseTo(1);
    expect(end.offsetX).toBeCloseTo(0);
    expect(end.offsetY).toBeCloseTo(0);
    expect(end.rotation).toBeCloseTo(0);
    expect(end.blur).toBeCloseTo(0);
    expect(end.scale.x).toBeCloseTo(1);
    expect(end.scale.y).toBeCloseTo(1);
  });

  it("stagger-delays later cascade characters instead of moving the whole title together", () => {
    const first = calculateUnitAnimationState(context("cascade", 0.05, 0, 3));
    const last = calculateUnitAnimationState(context("cascade", 0.05, 2, 3));

    expect(first.opacity).toBeGreaterThan(0);
    expect(last.opacity).toBe(0);
    expect(last.offsetY).toBeGreaterThan(first.offsetY);
  });
});
