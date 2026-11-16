import { describe, expect, it } from "vitest";
import { getVolumeAutomationPointsForRange } from "./clip-volume-automation";

describe("clip volume automation", () => {
  it("continues the scheduled ramp before the first saved point after a seek", () => {
    expect(getVolumeAutomationPointsForRange([{ time: 4, value: 0 }], 1, 1, 1)).toEqual([
      { time: 0, value: .75 }, { time: 1, value: .5 },
    ]);
  });
  it("uses the last coincident value and preserves distinct subframe points", () => {
    const points = [{ time: 1, value: 1 }, { time: 1, value: .25 }, { time: 1.00001, value: .75 }];
    expect(getVolumeAutomationPointsForRange(points, 1, .5, .8)).toEqual([
      { time: 0, value: .25 }, { time: .000010000000000065512, value: .75 }, { time: .5, value: .75 },
    ]);
  });
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
