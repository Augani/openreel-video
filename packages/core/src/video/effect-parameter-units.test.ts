import { describe, expect, it } from "vitest";
import { toNormalizedVideoEffectParams, toRuntimeVideoEffectParams } from "./effect-parameter-units";
import { VideoEffectsEngine } from "./video-effects-engine";

describe("explicit video effect unit boundaries", () => {
  it.each([
    ["brightness", { value: -0.2 }, { value: -20 }],
    ["sharpen", { amount: 0.5, radius: 2, threshold: 0.1 }, { amount: 50, radius: 2, threshold: 0.1 }],
    ["vignette", { amount: 0.3, midpoint: 0.5, feather: 0.7 }, { amount: 30, midpoint: 0.5, feather: 0.7 }],
    ["grain", { amount: 0.18, size: 1.4, roughness: 0.6, colored: false }, { amount: 18, size: 1.4, roughness: 0.6, colored: false }],
    ["hue", { rotation: -15 }, { rotation: -15 }],
    ["blur", { radius: 3 }, { radius: 3 }],
    ["contrast", { value: 1.2 }, { value: 1.2 }],
    ["saturation", { value: 1.1 }, { value: 1.1 }],
  ])("converts only the documented %s scalar without mutating inputs", (type, normalized, runtime) => {
    const snapshot = JSON.stringify(normalized);
    expect(toRuntimeVideoEffectParams(type, normalized)).toEqual(runtime);
    expect(toNormalizedVideoEffectParams(type, runtime)).toEqual(normalized);
    expect(JSON.stringify(normalized)).toBe(snapshot);
    expect(toRuntimeVideoEffectParams(type, normalized)).not.toBe(normalized);
  });

  it.each([0, 0.18, 0.29, 18, 0.000001, -0.29])("preserves a saved runtime value of %s on a decimal roundtrip", amount => {
    expect(toRuntimeVideoEffectParams("grain", toNormalizedVideoEffectParams("grain", { amount })).amount).toBe(amount);
  });

  it("leaves partial and invalid values for caller validation without inferring units", () => {
    expect(toRuntimeVideoEffectParams("grain", { size: 2 })).toEqual({ size: 2 });
    expect(toRuntimeVideoEffectParams("grain", { amount: "0.18" })).toEqual({ amount: "0.18" });
    expect(toRuntimeVideoEffectParams("grain", { amount: 0.18 })).toEqual({ amount: 18 });
    expect(toNormalizedVideoEffectParams("grain", { amount: 0.18 })).toEqual({ amount: 0.0018 });
  });

  it("makes normalized brightness reach the actual renderer as a twenty percent lift", () => {
    const engine = new VideoEffectsEngine({ width: 2, height: 2, useGPU: false });
    expect(engine.getCssFilterString([{ id: "brightness", type: "brightness", enabled: true,
      params: toRuntimeVideoEffectParams("brightness", { value: 0.2 }),
    }])).toBe("brightness(1.2)");
  });
});
