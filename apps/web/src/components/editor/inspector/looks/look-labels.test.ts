import { describe, expect, it } from "vitest";
import { FILTER_PRESETS } from "@openreel/core";
import { effectLabel, presetAdjustments, presetSummary } from "./look-labels";

describe("look labels", () => {
  it("never shows a raw effect id for any built-in preset", () => {
    for (const preset of FILTER_PRESETS) {
      const labels = presetAdjustments(preset);
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label).toMatch(/^[A-Z]/);
        expect(label).not.toMatch(/^(brightness|contrast|saturation|hue|blur|sharpen|vignette|grain|color-grade)$/);
      }
    }
  });

  it("lists each adjustment once, in order", () => {
    const effects = ["contrast", "saturation", "contrast", "grain"].map((type) => ({ type, params: {} }));
    expect(presetSummary({ effects } as never)).toBe("Contrast, Saturation, Film grain");
  });

  it("title-cases unknown ids instead of leaking them", () => {
    expect(effectLabel("color-grade")).toBe("Color grade");
  });
});
