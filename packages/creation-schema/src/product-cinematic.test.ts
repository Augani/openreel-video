import { describe, expect, it } from "vitest";
import {
  createPhoneProductCinematicScene,
  summarizeCreationScene,
  validateCreationScene,
} from "./index";

describe("createPhoneProductCinematicScene", () => {
  it("creates an editable semantic product scene with internals and animation", () => {
    const scene = createPhoneProductCinematicScene({
      name: "Phone launch intro",
      duration: 7,
      includeInternals: true,
      includeCallouts: true,
    });

    const product = scene.assets[0];
    expect(scene.duration).toBe(7);
    expect(product.kind).toBe("product");
    expect(product.productParts?.map((part) => part.role)).toContain("chip");
    expect(product.productParts?.map((part) => part.role)).toContain("battery");
    expect(product.productParts?.every((part) => !!part.explodedTransform)).toBe(true);
    expect(scene.callouts.length).toBeGreaterThanOrEqual(4);
    expect(scene.animations.some((animation) => animation.id === "anim-product-exploded-view")).toBe(true);
    expect(summarizeCreationScene(scene)).toContain("product part");
    expect(validateCreationScene(scene).filter((entry) => entry.severity === "error")).toEqual([]);
  });

  it("can build a simpler shell-only product when internals are disabled", () => {
    const scene = createPhoneProductCinematicScene({ includeInternals: false, includeCallouts: false });
    const roles = scene.assets[0]?.productParts?.map((part) => part.role) ?? [];
    expect(roles).toContain("screen");
    expect(roles).toContain("camera-module");
    expect(roles).not.toContain("chip");
    expect(scene.callouts).toEqual([]);
    expect(validateCreationScene(scene).filter((entry) => entry.severity === "error")).toEqual([]);
  });
});
