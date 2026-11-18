import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_TRANSFORM } from "@openreel/core";
import { textSelectionLayout } from "./text-selection-layout";

const style = { ...DEFAULT_TEXT_STYLE, strokeWidth: 0 };
describe("text selection layout", () => {
  it("starts at the text origin for a left-aligned lower third", () => {
    const box = textSelectionLayout(
      200,
      1,
      40,
      { ...style, textAlign: "left" },
      DEFAULT_TEXT_TRANSFORM,
    );
    expect(box).toMatchObject({
      left: 0,
      top: -20,
      width: 200,
      height: 40,
      rotated: { left: 0, right: 200, top: -20, bottom: 20 },
    });
  });
  it("provides the actual rotated edges used for canvas snapping", () => {
    const box = textSelectionLayout(
      200,
      1,
      40,
      { ...style, textAlign: "left" },
      { ...DEFAULT_TEXT_TRANSFORM, rotation: 90, scale: { x: 2, y: 0.5 } },
    );
    expect(box.rotated.left).toBeCloseTo(-10);
    expect(box.rotated.right).toBeCloseTo(10);
    expect(box.rotated.top).toBeCloseTo(0);
    expect(box.rotated.bottom).toBeCloseTo(400);
  });
  it("widens the box for negative tracking so the last glyph is not cut off", () => {
    const tight = textSelectionLayout(300, 1, 40, { ...style, textAlign: "center", letterSpacing: -4 }, DEFAULT_TEXT_TRANSFORM);
    const loose = textSelectionLayout(300, 1, 40, { ...style, textAlign: "center", letterSpacing: 0 }, DEFAULT_TEXT_TRANSFORM);
    expect(tight.width).toBe(loose.width + 8);
    expect(tight.left).toBe(loose.left - 4);
  });
});
