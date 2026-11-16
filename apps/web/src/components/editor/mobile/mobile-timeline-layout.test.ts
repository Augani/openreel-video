import { describe, expect, it } from "vitest";
import { phoneDecorationScroll } from "./mobile-timeline-layout";
import { getVisibleRepeatRange } from "../timeline/visible-repeat-range";

describe("phone timeline layout", () => {

  it("keeps every visible waveform/thumbnail segment covered between decoration updates", () => {
    let updates = 0;
    let previous = NaN;
    // A minute of smooth 24px/s scrolling at 60fps, including the leading inset.
    for (let frame = 0; frame <= 3600; frame++) {
      const scroll = -195 + frame * 24 / 60;
      const bucket = phoneDecorationScroll(scroll);
      if (bucket !== previous) updates++;
      previous = bucket;
      const range = getVisibleRepeatRange(0, 2400, bucket, 390, 800);
      const visibleStart = Math.max(0, scroll);
      const visibleEnd = Math.min(2400, scroll + 390);
      expect(range.start * 3).toBeLessThanOrEqual(visibleStart);
      expect(range.end * 3).toBeGreaterThanOrEqual(visibleEnd);
    }
    expect(updates).toBeLessThan(18);
  });
});
