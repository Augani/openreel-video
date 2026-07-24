import { describe, expect, it } from "vitest";
import { getClipFadeEnvelopePoints } from "./clip-fade-envelope";

describe("clip fade envelopes", () => {
  it("keeps fade timing clip-local when rendering a middle chunk", () => {
    expect(getClipFadeEnvelopePoints({ clipOffset: 4, rangeDuration: 2, clipDuration: 10, fadeIn: 2, fadeOut: 2 })).toEqual([
      { time: 0, value: 1 },
      { time: 2, value: 1 },
    ]);
  });

  it("returns the correct partial fade when playback begins inside it", () => {
    expect(getClipFadeEnvelopePoints({ clipOffset: 1, rangeDuration: 2, clipDuration: 10, fadeIn: 2 })).toEqual([
      { time: 0, value: 0.5 },
      { time: 1, value: 1 },
      { time: 2, value: 1 },
    ]);
  });

  it("schedules a clip-end fade relative to the requested range", () => {
    expect(getClipFadeEnvelopePoints({ clipOffset: 7, rangeDuration: 3, clipDuration: 10, fadeOut: 2 })).toEqual([
      { time: 0, value: 1 },
      { time: 1, value: 1 },
      { time: 3, value: 0 },
    ]);
  });
});
