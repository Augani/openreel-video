import { describe, expect, it } from "vitest";
import {
  MOTION_PRESETS,
  getMotionPreset,
  getMotionPresetCategories,
} from "./motion-presets";

describe("motion presets", () => {
  it("ships at least one template for every launch category", () => {
    for (const category of getMotionPresetCategories()) {
      expect(
        MOTION_PRESETS.some((preset) => preset.category === category),
      ).toBe(true);
    }
  });

  it("creates editable compositions with valid variable bindings", () => {
    for (const preset of MOTION_PRESETS) {
      const composition = preset.create();
      const variableIds = new Set(
        composition.variables.map((variable) => variable.id),
      );

      expect(getMotionPreset(preset.id)).toBe(preset);
      expect(composition.layers.length).toBeGreaterThan(0);
      expect(composition.variables.map((variable) => variable.id)).toEqual(
        preset.variables.map((variable) => variable.id),
      );

      for (const layer of composition.layers) {
        for (const binding of layer.variableBindings ?? []) {
          expect(variableIds.has(binding.variableId)).toBe(true);
        }
      }
    }
  });

  it("uses absolute stage coordinates for position keyframes", () => {
    for (const preset of MOTION_PRESETS) {
      const composition = preset.create();
      for (const layer of composition.layers) {
        for (const axis of ["x", "y"] as const) {
          const property = `transform.position.${axis}`;
          const keyframes = layer.keyframes.filter(
            (keyframe) => keyframe.property === property,
          );
          if (keyframes.length === 0) continue;
          expect(
            keyframes.some(
              (keyframe) => keyframe.value === layer.transform.position[axis],
            ),
          ).toBe(true);
          for (const keyframe of keyframes) {
            expect(typeof keyframe.value).toBe("number");
          }
        }
      }
    }
  });
});
