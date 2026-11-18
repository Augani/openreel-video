import { describe, expect, it } from "vitest";
import { clipEffectsForPreview, currentLookDef, effectsSignature, gradeSignature, lookDefCacheSize, memoLookDef, mergedPreviewGrading } from "./look-defs";

describe("look defs", () => {
  it("memoises per id and stays bounded", () => {
    const a = memoLookDef("x", () => ({ id: "x", kind: "look", type: "t" }));
    expect(memoLookDef("x", () => ({ id: "x", kind: "look", type: "other" }))).toBe(a);
    for (let i = 0; i < 600; i++) memoLookDef(`bulk-${i}`, () => ({ id: `bulk-${i}`, kind: "look", type: "t" }));
    expect(lookDefCacheSize()).toBeLessThanOrEqual(256);
  });

  it("merges a change into the clip's current grade like apply does", () => {
    expect(mergedPreviewGrading({}, { temperature: -30 })).toEqual({ pipelineVersion: 2, temperature: -30 });
    expect(mergedPreviewGrading(undefined, { tint: 5 })).toEqual({ pipelineVersion: 2, tint: 5 });
    const graded = { exposure: 0.4 } as never;
    expect(mergedPreviewGrading(graded, { temperature: 20 })).toEqual({ exposure: 0.4, temperature: 20 });
  });

  it("keeps the clip's enabled effects in order, and the before def is the clip as it is", () => {
    const fx = clipEffectsForPreview([
      { type: "blur", enabled: true, params: { radius: 4 } },
      { type: "grain", enabled: false, params: { amount: 9 } },
      { type: "contrast", params: { value: 1.3 } },
    ]);
    expect(fx.map((e) => e.type)).toEqual(["blur", "contrast"]);
    const none = currentLookDef([], {});
    expect(none.effects).toBeUndefined();
    expect(none.grading).toBeUndefined();
    const graded = currentLookDef(fx, { exposure: 0.4 } as never);
    expect(graded.effects).toEqual(fx);
    expect(graded.grading).toEqual({ exposure: 0.4 });
    expect(currentLookDef(fx, { exposure: 0.4 } as never).id).toBe(graded.id);
    expect(currentLookDef(fx, { exposure: 0.5 } as never).id).not.toBe(graded.id);
    expect(currentLookDef([], {}).id).not.toBe(graded.id);
    expect(effectsSignature(fx)).not.toBe(effectsSignature([]));
  });

  it("signs a grade by content, sampling LUT tables", () => {
    const lut = (v: number) => ({ size: 2, data: new Float32Array(24).fill(v), intensity: 1 });
    expect(gradeSignature({ lut: lut(0.2) } as never)).toBe(gradeSignature({ lut: lut(0.2) } as never));
    expect(gradeSignature({ lut: lut(0.2) } as never)).not.toBe(gradeSignature({ lut: lut(0.7) } as never));
    expect(gradeSignature({})).not.toBe(gradeSignature(undefined));
  });
});
