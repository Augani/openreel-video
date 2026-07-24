import { describe, expect, it, vi } from "vitest";

vi.mock("polygon-clipping", () => ({
  default: {
    union: () => {
      throw new Error("forced library failure");
    },
    difference: () => {
      throw new Error("forced library failure");
    },
    intersection: () => {
      throw new Error("forced library failure");
    },
    xor: () => {
      throw new Error("forced library failure");
    },
  },
}));

import {
  MotionShapeBooleanError,
  mergeMotionShapeRings,
} from "./motion-shape-boolean";
import type { MotionVector2 } from "./types";

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
): MotionVector2[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

describe("mergeMotionShapeRings library failure", () => {
  it("rethrows a typed MotionShapeBooleanError carrying the mode", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(50, 50, 100, 100)];

    try {
      mergeMotionShapeRings([a, b], "union");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MotionShapeBooleanError);
      if (error instanceof MotionShapeBooleanError) {
        expect(error.mode).toBe("union");
        expect(error.message).toContain("forced library failure");
      }
    }
  });
});
