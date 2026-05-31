import { describe, it, expect } from "vitest";
import {
  getStaticDescriptor,
  deriveEffectDescriptor,
  COLOR_GRADE_SCALAR_PROPS,
} from "./keyframe-properties";

describe("keyframe-properties", () => {
  it("static descriptors expose canonical ranges + displayScale", () => {
    const opacity = getStaticDescriptor("transform.opacity");
    expect(opacity).toMatchObject({ min: 0, max: 1, displayScale: 100, unit: "%", family: "transform" });
    const posX = getStaticDescriptor("transform.position.x");
    expect(posX).toMatchObject({ displayScale: 1, family: "transform" });
    expect(getStaticDescriptor("transform.crop.width")?.family).toBe("crop");
    expect(getStaticDescriptor("audio.volume")).toMatchObject({ min: 0, max: 2, family: "audio" });
    expect(getStaticDescriptor("audio.pan")).toMatchObject({ min: -1, max: 1, family: "audio" });
  });

  it("derives an effect param descriptor from EFFECT_DEFINITIONS", () => {
    const d = deriveEffectDescriptor("eff123", "blur", "radius");
    expect(d).toMatchObject({ property: "effect.eff123.radius", min: 0, max: 100, step: 1, unit: "px", family: "effect" });
  });

  it("lists color-grade scalar props", () => {
    expect(COLOR_GRADE_SCALAR_PROPS).toEqual(["colorGrade.temperature", "colorGrade.tint"]);
  });
});
