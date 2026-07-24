import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE_STYLE, TEXT_STYLE_PRESETS } from "./AssetsPanel";

describe("editor text presets", () => {
  it("starts the primary title at a shader-friendly display scale", () => {
    expect(DEFAULT_TITLE_STYLE.fontSize).toBeGreaterThanOrEqual(96);
    expect(DEFAULT_TITLE_STYLE.fontWeight).toBe(800);
  });

  it("offers distinct title, editorial, outline, and utility treatments", () => {
    expect(TEXT_STYLE_PRESETS.map((preset) => preset.name)).toEqual([
      "Heading",
      "Subtitle",
      "Lower Third",
      "Caption",
      "Hero",
      "Quote",
      "Outline",
      "Badge",
    ]);
    expect(new Set(TEXT_STYLE_PRESETS.map((preset) => preset.style.fontSize)).size)
      .toBeGreaterThanOrEqual(6);
  });
});
