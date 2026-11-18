import { describe, expect, it } from "vitest";
import {
  MOTION_PRESETS,
  getMotionPreset,
} from "./motion-presets";

describe("motion presets", () => {

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

});
