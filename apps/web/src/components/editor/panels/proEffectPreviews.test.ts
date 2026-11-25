import { describe, expect, it } from "vitest";
import { PRO_EFFECT_DEFAULTS, PRO_EFFECT_SPECS, PRO_EFFECT_TYPES, isProEffectNeutral } from "@openreel/core";
import { EDITOR_EFFECT_PREVIEWS, SUPERSEDED_EFFECT_PREVIEW_IDS } from "./EffectsTransitionsPanel";
import { PRO_EFFECT_PREVIEWS, REPAIR_PRESETS } from "./proEffectPreviews";

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

describe("repair effects in the effects browser", () => {
  it("lists Dehaze, Deflicker and Deband under the Repair filter", () => {
    for (const type of ["dehaze", "deflicker", "deband"] as const) {
      const entry = EDITOR_EFFECT_PREVIEWS.find((effect) => effect.id === `pro-${type}`);
      expect(entry?.category, type).toBe("Repair");
    }
  });

  it("offers presets whose parameters are valid for their effect and act on the picture", () => {
    expect(REPAIR_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of REPAIR_PRESETS) {
      const entry = EDITOR_EFFECT_PREVIEWS.find((effect) => effect.id === preset.id);
      expect(entry, preset.id).toBeDefined();
      expect(entry?.type).toBe(preset.type);
      const specs = PRO_EFFECT_SPECS[preset.type].params;
      for (const [key, value] of Object.entries(preset.params)) {
        const spec = specs.find((p) => p.key === key);
        expect(spec, `${preset.id}.${key}`).toBeDefined();
        expect(value).toBeGreaterThanOrEqual(spec?.min ?? -Infinity);
        expect(value).toBeLessThanOrEqual(spec?.max ?? Infinity);
      }
      expect(isProEffectNeutral(preset.type, { ...PRO_EFFECT_DEFAULTS[preset.type], ...preset.params }), preset.id).toBe(false);
    }
  });
});
