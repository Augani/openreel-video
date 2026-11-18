import { describe, expect, it } from "vitest";
import { wrapMotionTextLines } from "./motion-text-wrap";

const monospace = (charWidth: number) => (text: string): number =>
  text.length * charWidth;

describe("wrapMotionTextLines", () => {
  it("returns explicit lines unchanged when maxWidth is zero", () => {
    expect(wrapMotionTextLines("alpha beta gamma", 0, monospace(10))).toEqual([
      "alpha beta gamma",
    ]);
  });

  it("wraps a long line greedily by words", () => {
    const result = wrapMotionTextLines(
      "alpha beta gamma delta",
      120,
      monospace(10),
    );
    expect(result).toEqual(["alpha beta", "gamma delta"]);
  });

  it("preserves explicit newline breaks and wraps within each segment", () => {
    const result = wrapMotionTextLines(
      "alpha beta\ngamma delta epsilon",
      120,
      monospace(10),
    );
    expect(result).toEqual(["alpha beta", "gamma delta", "epsilon"]);
  });

});
