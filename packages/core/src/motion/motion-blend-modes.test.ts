import { describe, expect, it } from "vitest";
import { BLEND_MODES } from "../video/types";
import {
  MOTION_BLEND_MODE_OPTIONS,
  buildMotionCssBlendMode,
  getMotionCanvasBlendMode,
} from "./motion-blend-modes";

describe("motion blend modes", () => {
  it("maps normal blend mode to source-over and no CSS override", () => {
    expect(getMotionCanvasBlendMode(undefined)).toBe("source-over");
    expect(getMotionCanvasBlendMode("normal")).toBe("source-over");
    expect(buildMotionCssBlendMode(undefined)).toBeUndefined();
    expect(buildMotionCssBlendMode("normal")).toBeUndefined();
  });

  it("maps shared video blend modes to Canvas and CSS values", () => {
    expect(getMotionCanvasBlendMode("screen")).toBe("screen");
    expect(getMotionCanvasBlendMode("color-dodge")).toBe("color-dodge");
    expect(buildMotionCssBlendMode("screen")).toBe("screen");
    expect(buildMotionCssBlendMode("color-dodge")).toBe("color-dodge");
  });

  it("exposes readable blend mode option labels", () => {
    expect(MOTION_BLEND_MODE_OPTIONS).toContainEqual({
      id: "soft-light",
      name: "Soft Light",
    });
  });

  it("includes the additive Add family in BLEND_MODES", () => {
    expect(BLEND_MODES).toContain("add");
    expect(BLEND_MODES).toContain("linear-dodge");
  });

  it("maps the Add family to the Canvas2D lighter operation", () => {
    expect(getMotionCanvasBlendMode("add")).toBe("lighter");
    expect(getMotionCanvasBlendMode("linear-dodge")).toBe("lighter");
  });

  it("exposes readable labels for the Add family", () => {
    expect(MOTION_BLEND_MODE_OPTIONS).toContainEqual({
      id: "add",
      name: "Add",
    });
    expect(MOTION_BLEND_MODE_OPTIONS).toContainEqual({
      id: "linear-dodge",
      name: "Linear Dodge",
    });
  });
});
