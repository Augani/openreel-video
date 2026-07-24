import { describe, expect, it } from "vitest";
import { getTrackDragAutoScrollDelta } from "./track-drag-auto-scroll";

describe("getTrackDragAutoScrollDelta", () => {
  const viewportTop = 100;
  const viewportBottom = 500;
  const maxScrollTop = 800;

  it("scrolls upward continuously inside the top edge zone", () => {
    expect(
      getTrackDragAutoScrollDelta(
        120,
        viewportTop,
        viewportBottom,
        400,
        maxScrollTop,
      ),
    ).toBeLessThan(0);
  });

  it("scrolls downward inside the bottom edge zone", () => {
    expect(
      getTrackDragAutoScrollDelta(
        480,
        viewportTop,
        viewportBottom,
        400,
        maxScrollTop,
      ),
    ).toBeGreaterThan(0);
  });

  it("accelerates as the pointer gets closer to an edge", () => {
    const near = getTrackDragAutoScrollDelta(
      160,
      viewportTop,
      viewportBottom,
      400,
      maxScrollTop,
    );
    const atEdge = getTrackDragAutoScrollDelta(
      100,
      viewportTop,
      viewportBottom,
      400,
      maxScrollTop,
    );

    expect(Math.abs(atEdge)).toBeGreaterThan(Math.abs(near));
  });

  it("does not scroll in the center or beyond the scroll bounds", () => {
    expect(
      getTrackDragAutoScrollDelta(
        300,
        viewportTop,
        viewportBottom,
        400,
        maxScrollTop,
      ),
    ).toBe(0);
    expect(
      getTrackDragAutoScrollDelta(
        100,
        viewportTop,
        viewportBottom,
        0,
        maxScrollTop,
      ),
    ).toBe(0);
    expect(
      getTrackDragAutoScrollDelta(
        500,
        viewportTop,
        viewportBottom,
        maxScrollTop,
        maxScrollTop,
      ),
    ).toBe(0);
  });
});
