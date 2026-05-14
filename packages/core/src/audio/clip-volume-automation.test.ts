import { describe, expect, it } from "vitest";
import { getVolumeAutomationPointsForRange } from "./clip-volume-automation";

describe("clip volume automation", () => {
  it("trims automation to a clip range and interpolates the start and end", () => {
    const points = getVolumeAutomationPointsForRange(
      [
        { time: 0.5, value: 0.4 },
        { time: 1, value: 1 },
      ],
      0.75,
      0.2,
      1,
    );

    expect(points).toEqual([
      { time: 0, value: 0.7 },
      { time: 0.2, value: 0.94 },
    ]);
  });

  it("keeps in-range keyframes and preserves the base volume before the first point", () => {
    const points = getVolumeAutomationPointsForRange(
      [
        { time: 0.4, value: 0.5 },
        { time: 0.9, value: 1 },
      ],
      0,
      0.6,
      0.8,
    );

    expect(points).toEqual([
      { time: 0, value: 0.8 },
      { time: 0.4, value: 0.5 },
      { time: 0.6, value: 0.7 },
    ]);
  });
});