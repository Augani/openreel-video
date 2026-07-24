import { describe, it, expect } from "vitest";

import { clampSize } from "./useResizable";

describe("clampSize", () => {
  it("returns min when value is below min", () => {
    expect(clampSize(100, 220, 520)).toBe(220);
  });

  it("returns max when value is above max", () => {
    expect(clampSize(900, 220, 520)).toBe(520);
  });

  it("returns the value when within bounds", () => {
    expect(clampSize(360, 220, 520)).toBe(360);
  });

  it("returns the boundary value at the edges", () => {
    expect(clampSize(220, 220, 520)).toBe(220);
    expect(clampSize(520, 220, 520)).toBe(520);
  });

  it("handles negative ranges along the y axis", () => {
    expect(clampSize(-10, 0, 640)).toBe(0);
    expect(clampSize(320, 160, 640)).toBe(320);
  });
});
