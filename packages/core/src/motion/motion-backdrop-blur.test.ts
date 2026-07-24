import { describe, expect, it } from "vitest";
import {
  buildMotionCanvasFilter,
  buildMotionCssFilter,
  createMotionEffect,
  getMotionBackdropBlurRadius,
  getMotionEffectParameterDescriptors,
  isMotionPixelEffect,
} from "./motion-effects";

describe("backdrop-blur effect wiring", () => {
  it("creates a typed backdrop-blur preset with a radius parameter", () => {
    const backdrop = createMotionEffect("backdrop-blur", "backdrop-1");
    expect(backdrop).toMatchObject({
      id: "backdrop-1",
      type: "backdrop-blur",
      enabled: true,
      radius: 16,
    });
    expect(getMotionEffectParameterDescriptors(backdrop)).toEqual([
      { param: "radius", label: "Radius", min: 0, max: 100, step: 1, unit: "px" },
    ]);
  });

  it("is neither a CSS-filter effect nor a pixel-buffer effect", () => {
    const backdrop = createMotionEffect("backdrop-blur", "backdrop-1");
    expect(isMotionPixelEffect("backdrop-blur")).toBe(false);
    expect(buildMotionCanvasFilter([backdrop])).toBe("none");
    expect(buildMotionCssFilter([backdrop])).toBeUndefined();
  });

  it("reads the strongest enabled backdrop-blur radius from a stack", () => {
    const weak = { ...createMotionEffect("backdrop-blur", "b1"), radius: 8 };
    const strong = { ...createMotionEffect("backdrop-blur", "b2"), radius: 24 };
    const disabled = {
      ...createMotionEffect("backdrop-blur", "b3"),
      radius: 80,
      enabled: false,
    };
    expect(getMotionBackdropBlurRadius([weak, strong, disabled])).toBe(24);
  });

  it("returns zero radius for empty or missing effect stacks", () => {
    expect(getMotionBackdropBlurRadius([])).toBe(0);
    expect(getMotionBackdropBlurRadius(undefined)).toBe(0);
  });
});
