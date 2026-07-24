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

  it("returns explicit lines unchanged when maxWidth is negative", () => {
    expect(wrapMotionTextLines("alpha beta", -50, monospace(10))).toEqual([
      "alpha beta",
    ]);
  });

  it("never splits when maxWidth is not finite", () => {
    expect(
      wrapMotionTextLines("alpha beta", Number.POSITIVE_INFINITY, monospace(10)),
    ).toEqual(["alpha beta"]);
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

  it("keeps an over-long single word on its own line", () => {
    const result = wrapMotionTextLines(
      "supercalifragilistic short",
      80,
      monospace(10),
    );
    expect(result).toEqual(["supercalifragilistic", "short"]);
  });

  it("preserves empty explicit lines", () => {
    expect(wrapMotionTextLines("alpha\n\nbeta", 200, monospace(10))).toEqual([
      "alpha",
      "",
      "beta",
    ]);
  });

  it("does not lose words when everything fits on one line", () => {
    expect(wrapMotionTextLines("a b c", 1000, monospace(10))).toEqual(["a b c"]);
  });
});
