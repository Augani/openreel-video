import { describe, expect, it } from "vitest";
import { FILTER_PRESETS } from "@openreel/core";
import { filterPresetEffectsForPreview } from "../../../../services/filter-preset-application";
import { lookEffectsFor } from "./preview-params";

describe("look card effects", () => {
  it("render exactly the params apply writes, for every preset, grain included (no card boost)", () => {
    for (const preset of FILTER_PRESETS) {
      const written = filterPresetEffectsForPreview(preset);
      const rendered = lookEffectsFor({ id: `look-${preset.id}`, kind: "look", type: "filter-preset", effects: written });
      expect(rendered.map((e) => ({ type: e.type, params: e.params }))).toEqual(written);
    }
    const noir = FILTER_PRESETS.find((p) => p.name === "Film Noir")!;
    const grain = lookEffectsFor({ id: "n", kind: "look", type: "filter-preset", effects: filterPresetEffectsForPreview(noir) }).find((e) => e.type === "grain");
    expect(grain?.params.amount).toBe(15);
  });
});
