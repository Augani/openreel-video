import { describe, expect, it } from "vitest";
import { describeToolPreview, formatSignedDelta } from "./timeline-tool-readout";

describe("timeline tool readout", () => {
  it("signs deltas and drops the sign at zero", () => {
    expect(formatSignedDelta(3 / 30, 30)).toBe("+00:00:00:03");
    expect(formatSignedDelta(-1.5, 30)).toBe("-00:00:01:15");
    expect(formatSignedDelta(0.001, 30)).toBe("00:00:00:00");
  });
  it("shows delta and duration for roll plus the adjusted neighbour", () => {
    const readout = describeToolPreview(
      "roll",
      { startTime: 0, duration: 4.1, delta: 0.1, neighbor: { trackId: "v", startTime: 4.1, duration: 3.9 } },
      30,
    );
    expect(readout.label).toBe("Roll +00:00:00:03 · 00:00:04:03");
    expect(readout.neighbors).toEqual(["00:00:03:27 · 00:00:04:03"]);
  });
  it("lists both neighbours of a slide", () => {
    const readout = describeToolPreview(
      "slide",
      {
        startTime: 4.5,
        duration: 4,
        delta: 0.5,
        neighbors: [
          { trackId: "v", startTime: 0, duration: 4.5 },
          { trackId: "v", startTime: 8.5, duration: 3.5 },
        ],
      },
      30,
    );
    expect(readout.label).toBe("Slide +00:00:00:15 · in 00:00:04:15");
    expect(readout.neighbors).toHaveLength(2);
  });
  it("shows slip source range and stretch speed", () => {
    expect(
      describeToolPreview("slip", { startTime: 0, duration: 4, delta: -1, inPoint: 1, outPoint: 5 }, 30).label,
    ).toBe("Slip -00:00:01:00 · 00:00:01:00 → 00:00:05:00");
    expect(
      describeToolPreview("stretch", { startTime: 0, duration: 8, delta: 4, speed: 0.5 }, 30).label,
    ).toBe("Rate · 50% · +00:00:04:00 · 00:00:08:00");
  });
});
