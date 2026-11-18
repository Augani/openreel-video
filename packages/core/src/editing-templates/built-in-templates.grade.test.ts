import { describe, expect, it } from "vitest";
import { BUILT_IN_EDITING_TEMPLATES } from "./built-in-templates";

describe("built-in editing template grades", () => {
  it("expresses contrast as the engine's multiplier (1 = unchanged), never a near-zero value that greys the clip", () => {
    for (const template of BUILT_IN_EDITING_TEMPLATES) {
      for (const effect of template.recipe.effects) {
        if (effect.type !== "contrast") continue;
        const value = effect.params.value;
        expect(typeof value, `${template.id} contrast`).toBe("number");
        expect(value as number, `${template.id} contrast`).toBeGreaterThan(0.5);
        expect(value as number, `${template.id} contrast`).toBeLessThan(2);
      }
    }
  });

  it("binds every text overlay to a control with the resolver's {control.id} syntax, not a literal {{token}}", () => {
    for (const template of BUILT_IN_EDITING_TEMPLATES) {
      for (const overlay of template.recipe.overlays) {
        if (overlay.type !== "text") continue;
        const text = overlay.content.text;
        expect(String(text), `${template.id} text`).not.toContain("{{");
      }
    }
  });

  it("grows the progress bar from its left edge", () => {
    const bar = BUILT_IN_EDITING_TEMPLATES.find((template) => template.id === "overlay-progress-bar")!;
    const keyframes = bar.recipe.overlays[0].keyframes ?? [];
    const at = (property: string, time: number) => keyframes.find((k) => k.property === property && k.time === time)?.value;
    expect(at("scale.x", 0)).toBe(0);
    expect(at("scale.x", 1)).toBe(1);
    // Left anchor on the left edge: scaling about the anchor is what grows it from the left, no position travel.
    expect(bar.recipe.overlays[0].transform?.anchor?.x).toBe(0);
    expect(at("position.x", 1)).toBeUndefined();
  });
});
