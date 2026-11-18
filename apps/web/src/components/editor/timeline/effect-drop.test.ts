import { describe, expect, it } from "vitest";
import {
  parseEditorEffectDropPayload,
  serializeEditorEffectDropPayload,
} from "./effect-drop";

describe("editor effect drag payload", () => {
  it("round-trips authored preset parameters", () => {
    const serialized = serializeEditorEffectDropPayload({
      effectType: "glow",
      effectParams: { radius: 28, intensity: 1.25, color: "#c4b5fd" },
    });

    expect(parseEditorEffectDropPayload(serialized, "effect:glow")).toEqual({
      effectType: "glow",
      effectParams: { radius: 28, intensity: 1.25, color: "#c4b5fd" },
    });
  });

  it("falls back to the type-only compatibility payload", () => {
    expect(parseEditorEffectDropPayload("not-json", "effect:blur")).toEqual({
      effectType: "blur",
    });
  });
  it("preserves the LUT preset for drop and supports the type-only fallback", () => {
    const payload = {
      effectType: "lut" as const,
      effectParams: { preset: "warm" },
    };
    expect(
      parseEditorEffectDropPayload(
        serializeEditorEffectDropPayload(payload),
        "effect:lut",
      ),
    ).toEqual(payload);
    expect(parseEditorEffectDropPayload(null, "effect:lut")).toEqual({
      effectType: "lut",
    });
  });
});
