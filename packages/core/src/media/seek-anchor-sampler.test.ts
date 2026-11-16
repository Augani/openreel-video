import { describe, expect, it } from "vitest";
import { planAnchorTimes } from "./seek-anchor-sampler";

describe("planAnchorTimes", () => {
  it("samples every half second for short media", () => {
    const times = planAnchorTimes(60);
    expect(times).toHaveLength(120);
    expect(times[0]).toBe(0);
    expect(times[1]).toBe(0.5);
    expect(times[119]).toBe(59.5);
  });

  it("widens the spacing so long media stay within the anchor cap", () => {
    const times = planAnchorTimes(3000, { maxAnchors: 150 });
    expect(times.length).toBeLessThanOrEqual(150);
    expect(times[1] - times[0]).toBeCloseTo(20, 5);
    expect(times[times.length - 1]).toBeLessThan(3000);
  });

  it("returns nothing for empty or invalid durations", () => {
    expect(planAnchorTimes(0)).toEqual([]);
    expect(planAnchorTimes(Number.NaN)).toEqual([]);
    expect(planAnchorTimes(-3)).toEqual([]);
  });
});
