import { describe, it, expect } from "vitest";
import { validateEditJSON } from "./safe-json";
import { keyframeSchema } from "./portable-project";

const key = (property: string) => ({ id: "k", time: 0, property, value: 1, easing: "linear" });

describe("portable keyframe property ids", () => {
  it("accepts instance-keyed effect ids and legacy type-keyed ids", () => {
    for (const property of ["opacity", "fx:effect-1:radius", "effect.brightness", "effect.vibrance.vibrance", "effect.hsl-secondary.saturation"]) {
      expect(() => validateEditJSON(key(property), keyframeSchema)).not.toThrow();
    }
  });

  it("rejects unknown properties", () => {
    for (const property of ["fx:no-param", "effect.nonsense.thing", "bogus"]) {
      expect(() => validateEditJSON(key(property), keyframeSchema)).toThrow(/unsupported string value/);
    }
  });
});
