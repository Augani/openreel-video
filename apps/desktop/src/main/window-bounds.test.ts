import { describe, expect, it } from "vitest";
import { initialWindowBounds } from "./window-bounds";

describe("initialWindowBounds", () => {
  it("fills the display's work area", () => {
    expect(initialWindowBounds({ x: 0, y: 25, width: 1728, height: 1092 })).toEqual({
      x: 0,
      y: 25,
      width: 1728,
      height: 1092,
      minWidth: 1024,
      minHeight: 700,
    });
  });

  it("fills a secondary display at a negative origin", () => {
    const b = initialWindowBounds({ x: -2560, y: -300, width: 2560, height: 1415 });
    expect(b).toMatchObject({ x: -2560, y: -300, width: 2560, height: 1415 });
  });

  it("keeps the minimum size within a small screen", () => {
    const b = initialWindowBounds({ x: 0, y: 0, width: 1000.6, height: 640.2 });
    expect(b).toMatchObject({ width: 1000, height: 640, minWidth: 1000, minHeight: 640 });
  });
});
