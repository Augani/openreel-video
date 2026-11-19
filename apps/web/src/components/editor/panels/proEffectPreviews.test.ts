import { describe, expect, it } from "vitest";
import { PRO_EFFECT_TYPES } from "@openreel/core";
import { EDITOR_EFFECT_PREVIEWS, SUPERSEDED_EFFECT_PREVIEW_IDS } from "./EffectsTransitionsPanel";
import { PRO_EFFECT_PREVIEWS } from "./proEffectPreviews";

describe("pro effects in the effects browser", () => {
  it("lists every pro effect with an animated preview style", () => {
    for (const type of PRO_EFFECT_TYPES) {
      const entry = EDITOR_EFFECT_PREVIEWS.find((effect) => effect.id === `pro-${type}`);
      expect(entry, type).toBeDefined();
      expect(entry?.type).toBe(type);
      expect(entry?.previewStyle(0)).toBeTypeOf("object");
      expect(entry?.previewStyle(1)).toBeTypeOf("object");
    }
    expect(PRO_EFFECT_PREVIEWS).toHaveLength(PRO_EFFECT_TYPES.length);
  });

  it("keeps catalog ids and labels unique so list keys and search stay unambiguous", () => {
    const keys = EDITOR_EFFECT_PREVIEWS.map((effect) => effect.id ?? effect.type);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = EDITOR_EFFECT_PREVIEWS.map((effect) => effect.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("shows one entry per concept: the pro implementation replaces the legacy twin", () => {
    const labels = EDITOR_EFFECT_PREVIEWS.map((effect) => effect.label);
    const listed = new Set(EDITOR_EFFECT_PREVIEWS.map((effect) => effect.id ?? effect.type));
    for (const id of SUPERSEDED_EFFECT_PREVIEW_IDS) expect(listed.has(id), id).toBe(false);
    for (const label of [
      "Gaussian blur", "Pixelate", "Lens distort", "Mirror H/V/Quad",
      "Posterize Levels", "VHS", "Gaussian Blur (H/V)",
    ]) expect(labels, label).not.toContain(label);
    for (const label of [
      "Gaussian Blur", "Mosaic", "Lens Distortion", "Mirror", "Posterize", "VHS / Glitch",
    ]) expect(labels.filter((entry) => entry === label), label).toHaveLength(1);
    const duplicateConcepts = [/pixelate|mosaic/i, /mirror/i, /lens distort|fisheye/i, /gaussian/i, /posterize(?! time)/i, /vhs/i];
    for (const concept of duplicateConcepts) {
      expect(labels.filter((label) => concept.test(label)), String(concept)).toHaveLength(1);
    }
  });

  it("keeps the old Fisheye search term finding Lens Distortion", () => {
    const lens = EDITOR_EFFECT_PREVIEWS.find((effect) => effect.id === "pro-lens-distortion");
    expect(lens?.description.toLowerCase()).toContain("fisheye");
  });

  it("keeps the old Pixelate search term finding Mosaic", () => {
    const mosaic = EDITOR_EFFECT_PREVIEWS.find((effect) => effect.id === "pro-mosaic");
    expect(`${mosaic?.label} ${mosaic?.description}`.toLowerCase()).toContain("pixelate");
  });
});
