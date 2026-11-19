import { describe, expect, it } from "vitest";
import { BURN_IN_SPECS, withEffectDefaults } from "@openreel/core";
import { BURN_IN_PREVIEWS } from "./burnInPreviews";
import { EDITOR_EFFECT_PREVIEWS } from "./EffectsTransitionsPanel";
import { BURN_IN_CARD_SIZE_BOOST, previewNote, previewParams } from "./effect-previews/preview-params";

describe("burn-in effect cards", () => {
  it("lists Timecode and Clip Name once each under Generate, with the effect type as the card id", () => {
    expect(BURN_IN_PREVIEWS.map((d) => [d.id, d.type, d.label, d.category])).toEqual([
      ["burn-in-timecode", "burn-in-timecode", "Timecode", "Generate"],
      ["burn-in-name", "burn-in-name", "Clip Name", "Generate"],
    ]);
    for (const def of BURN_IN_PREVIEWS) {
      expect(EDITOR_EFFECT_PREVIEWS.filter((d) => d.type === def.type)).toHaveLength(1);
      expect(def.description).toBe(BURN_IN_SPECS[def.type as "burn-in-timecode"].description);
    }
  });

  it("applies with visible defaults and the card says its text is a sample", () => {
    for (const def of BURN_IN_PREVIEWS) {
      expect(withEffectDefaults(def.type, def.params)).toMatchObject({ opacity: 100, box: true });
      expect(previewNote({ kind: "effect", type: def.type } as Parameters<typeof previewNote>[0])).toBe("Sample text");
    }
  });

  it("enlarges the sample text at card scale and keeps the name clear of the badge, without touching other params", () => {
    const tc = previewParams({ kind: "effect", type: "burn-in-timecode" } as Parameters<typeof previewParams>[0], { size: 5, position: "bottom-center", opacity: 100 });
    expect(tc).toEqual({ size: 5 * BURN_IN_CARD_SIZE_BOOST, position: "bottom-center", opacity: 100 });
    const name = previewParams({ kind: "effect", type: "burn-in-name" } as Parameters<typeof previewParams>[0], { size: 4, position: "top-left" });
    expect(name).toEqual({ size: 4 * BURN_IN_CARD_SIZE_BOOST, position: "bottom-left" });
  });
});
