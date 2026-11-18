import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import {
  COLOR_GRADE_KEYFRAME_PROPERTIES,
  getAnimatedColorGrading,
  hasAnimatedColorGrading,
} from "./animated-color-grading";
import { hasAnimatedVideoEffects } from "./animated-video-effects";
import { DEFAULT_TONE, DEFAULT_VIGNETTE } from "./color-grading-defaults";
import { getStaticDescriptor } from "../animation/keyframe-properties";
import { hueCurveHasKeyframes, hueCurvePointProperty, parseHueCurveProperty } from "./animated-color-grading";
import { createDefaultHueCurves, isNeutralHueCurves } from "./hue-curves";

const key = (property: string, time: number, value: number): Keyframe => ({
  id: `${property}-${time}`,
  time,
  property,
  value,
  easing: "linear",
});

describe("animated colour grading", () => {
  it("is inactive without colour keyframes and returns the stored grade untouched", () => {
    const colorGrading = { tone: { ...DEFAULT_TONE, shadows: 0.2 } };
    const clip = { keyframes: [key("opacity", 0, 1)], colorGrading };
    expect(hasAnimatedColorGrading(clip)).toBe(false);
    expect(getAnimatedColorGrading(clip, 1)).toBe(colorGrading);
  });

  it("interpolates a keyframed slider and keeps the other stored sliders", () => {
    const clip = {
      keyframes: [key("colorGrade.tone.shadows", 0, 0), key("colorGrade.tone.shadows", 2, 1)],
      colorGrading: { tone: { ...DEFAULT_TONE, whites: 0.3 }, temperature: 10 },
    };
    expect(hasAnimatedColorGrading(clip)).toBe(true);
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    const mid = getAnimatedColorGrading(clip, 1)!;
    expect(mid.tone?.shadows).toBeCloseTo(0.5, 5);
    expect(mid.tone?.whites).toBe(0.3);
    expect(mid.temperature).toBe(10);
  });

  it("animates vignette and white balance from neutral defaults", () => {
    const clip = {
      keyframes: [
        key("colorGrade.vignette.amount", 0, 0),
        key("colorGrade.vignette.amount", 1, -1),
        key("colorGrade.temperature", 0, 0),
        key("colorGrade.temperature", 1, 40),
      ],
      colorGrading: undefined,
    };
    const grade = getAnimatedColorGrading(clip, 0.5)!;
    expect(grade.vignette).toEqual({ ...DEFAULT_VIGNETTE, amount: -0.5 });
    expect(grade.temperature).toBeCloseTo(20, 5);
    expect(grade.tone).toBeUndefined();
  });

  it("registers every keyframable slider with a descriptor the editor can list", () => {
    for (const property of COLOR_GRADE_KEYFRAME_PROPERTIES) {
      const descriptor = getStaticDescriptor(property.id);
      expect(descriptor?.family).toBe("colorGrade");
      expect(descriptor?.min).toBe(property.min);
      expect(descriptor?.max).toBe(property.max);
      expect(descriptor?.defaultValue).toBe(property.defaultValue);
    }
  });

  describe("hue curve keyframes", () => {
    const stored = () => {
      const curves = createDefaultHueCurves();
      curves.hueVsSat = [
        { x: 0, y: 0.5 },
        { x: 0.3, y: 0.5 },
        { x: 1, y: 0.5 },
      ];
      return curves;
    };

    it("names a point's output property and parses it back", () => {
      const id = hueCurvePointProperty("hueVsHue", 2);
      expect(id).toBe("colorGrade.hueCurve.hueVsHue.2");
      expect(parseHueCurveProperty(id)).toEqual({ kind: "hueVsHue", index: 2 });
      expect(parseHueCurveProperty("colorGrade.hueCurve.nope.1")).toBeNull();
      expect(parseHueCurveProperty("colorGrade.tone.exposure")).toBeNull();
    });

    it("counts as animated colour grading and has a descriptor the keyframe tools accept", () => {
      const clip = { keyframes: [key("colorGrade.hueCurve.hueVsSat.1", 0, 0.5)] };
      expect(hasAnimatedColorGrading(clip)).toBe(true);
      expect(hasAnimatedVideoEffects(clip)).toBe(true);
      expect(hueCurveHasKeyframes(clip.keyframes, "hueVsSat")).toBe(true);
      expect(hueCurveHasKeyframes(clip.keyframes, "hueVsHue")).toBe(false);
      const descriptor = getStaticDescriptor("colorGrade.hueCurve.hueVsSat.1");
      expect(descriptor).toMatchObject({ family: "colorGrade", min: 0, max: 1, defaultValue: 0.5, label: "Hue vs Sat point 2" });
    });

    it("interpolates a keyframed point between keyframes and keeps x, the other points and the other curves", () => {
      const clip = {
        keyframes: [key("colorGrade.hueCurve.hueVsSat.1", 0, 0.5), key("colorGrade.hueCurve.hueVsSat.1", 2, 1)],
        colorGrading: { hueCurves: stored() },
      };
      const grade = getAnimatedColorGrading(clip, 1)!;
      expect(grade.hueCurves!.hueVsSat[1]).toEqual({ x: 0.3, y: 0.75 });
      expect(grade.hueCurves!.hueVsSat[0].y).toBe(0.5);
      expect(grade.hueCurves!.hueVsSat[2].y).toBe(0.5);
      expect(isNeutralHueCurves({ ...createDefaultHueCurves(), hueVsHue: grade.hueCurves!.hueVsHue })).toBe(true);
      // The stored grade is not mutated.
      expect(clip.colorGrading.hueCurves.hueVsSat[1].y).toBe(0.5);
      // Before the first / after the last keyframe the value holds.
      expect(getAnimatedColorGrading(clip, 5)!.hueCurves!.hueVsSat[1].y).toBe(1);
    });

    it("animates a curve that was never edited, from the flat default, and ignores an index past the last point", () => {
      const clip = {
        keyframes: [key("colorGrade.hueCurve.lumaVsSat.0", 0, 0.2), key("colorGrade.hueCurve.lumaVsSat.9", 0, 0.9)],
        colorGrading: undefined,
      };
      const grade = getAnimatedColorGrading(clip, 0)!;
      expect(grade.hueCurves!.lumaVsSat).toEqual([
        { x: 0, y: 0.2 },
        { x: 1, y: 0.5 },
      ]);
    });
  });
});
