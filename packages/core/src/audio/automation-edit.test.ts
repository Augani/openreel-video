import { describe, expect, it } from "vitest";
import {
  deletePoint,
  dbToVolume,
  insertPoint,
  movePoint,
  scaleRange,
  simplify,
  volumeToDb,
} from "./automation-edit";
import type { AutomationPoint } from "../types/timeline";

const strictlyIncreasing = (points: readonly AutomationPoint[]) =>
  points.every((p, i) => i === 0 || p.time > points[i - 1].time);

describe("insertPoint", () => {
  it("keeps points sorted and unique in time", () => {
    let points: AutomationPoint[] = [];
    for (const [t, v] of [[2, 1], [0.5, 0.5], [1, 2], [0.5, 0.25], [3, 1]] as const) points = insertPoint(points, t, v);
    expect(points.map((p) => p.time)).toEqual([0.5, 1, 2, 3]);
    expect(strictlyIncreasing(points)).toBe(true);
    // The last point wins at a coincident time.
    expect(points[0].value).toBe(0.25);
  });

  it("clamps the value and the time into range and never mutates its input", () => {
    const input: AutomationPoint[] = [{ time: 1, value: 1 }];
    const frozen = structuredClone(input);
    const result = insertPoint(input, -5, 99);
    expect(input).toEqual(frozen);
    expect(result[0]).toEqual({ time: 0, value: 4 });
    expect(insertPoint(result, 1, -3)[1]).toEqual({ time: 1, value: 0 });
  });

  it("ignores a non-finite point", () => {
    expect(insertPoint([{ time: 1, value: 1 }], Number.NaN, 1)).toEqual([{ time: 1, value: 1 }]);
  });
});

describe("movePoint", () => {
  const base: AutomationPoint[] = [{ time: 1, value: 1 }, { time: 2, value: 1 }, { time: 3, value: 1 }];

  it("is clamped strictly between its neighbours", () => {
    const right = movePoint(base, 1, 10, 0);
    expect(right[1].time).toBeGreaterThan(2);
    expect(right[1].time).toBeLessThan(3);
    const left = movePoint(base, 1, -10, 0);
    expect(left[1].time).toBeGreaterThan(1);
    expect(strictlyIncreasing(right)).toBe(true);
    expect(strictlyIncreasing(left)).toBe(true);
  });

  it("never goes negative in time or above the clip end", () => {
    expect(movePoint(base, 0, -50, 0)[0].time).toBe(0);
    expect(movePoint(base, 2, 50, 0, { maxTime: 4 })[2].time).toBe(4);
  });

  it("keeps the value in the volume range", () => {
    expect(movePoint(base, 1, 0, 100)[1].value).toBe(4);
    expect(movePoint(base, 1, 0, -100)[1].value).toBe(0);
  });

  it("optionally snaps to 0 dB", () => {
    const moved = movePoint(base, 1, 0, dbToVolume(0.4) - 1, { snapUnityDb: 1 });
    expect(moved[1].value).toBe(1);
    const far = movePoint(base, 1, 0, dbToVolume(3) - 1, { snapUnityDb: 1 });
    expect(far[1].value).not.toBe(1);
    expect(movePoint(base, 1, 0, dbToVolume(0.4) - 1)[1].value).not.toBe(1);
  });

  it("leaves the lane alone for an index that is not a point", () => {
    expect(movePoint(base, 7, 1, 1)).toEqual(base);
  });
});

describe("deletePoint", () => {
  it("removes one point and keeps the rest", () => {
    expect(deletePoint([{ time: 1, value: 1 }, { time: 2, value: 0.5 }], 0)).toEqual([{ time: 2, value: 0.5 }]);
  });
  it("leaves an empty lane (a flat clip volume) when the last point goes", () => {
    expect(deletePoint([{ time: 1, value: 1 }], 0)).toEqual([]);
    expect(deletePoint([{ time: 1, value: 1 }], 5)).toEqual([{ time: 1, value: 1 }]);
  });
});

describe("scaleRange", () => {
  const points: AutomationPoint[] = [{ time: 0, value: 1 }, { time: 1, value: 0.5 }, { time: 2, value: 0.5 }, { time: 3, value: 1 }];
  it("affects only points inside the range", () => {
    const result = scaleRange(points, 1, 2, -6);
    expect(result[0]).toEqual(points[0]);
    expect(result[3]).toEqual(points[3]);
    expect(volumeToDb(result[1].value)).toBeCloseTo(volumeToDb(0.5) - 6, 6);
    expect(volumeToDb(result[2].value)).toBeCloseTo(volumeToDb(0.5) - 6, 6);
  });
  it("clamps at the ceiling and keeps silence silent when lowering", () => {
    expect(scaleRange([{ time: 1, value: 3 }], 0, 2, 20)[0].value).toBe(4);
    expect(scaleRange([{ time: 1, value: 0 }], 0, 2, -6)[0].value).toBe(0);
  });
});

describe("simplify", () => {
  const sampled: AutomationPoint[] = Array.from({ length: 41 }, (_, i) => ({
    time: i * 0.1,
    value: 1 + 0.5 * Math.sin(i * 0.25),
  }));
  const valueAt = (points: readonly AutomationPoint[], t: number) => {
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i].time) {
        const a = points[i - 1];
        const b = points[i];
        return a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time);
      }
    }
    return points[points.length - 1].value;
  };

  it("keeps both endpoints and the error stays below epsilon", () => {
    const epsilon = 0.05;
    const result = simplify(sampled, epsilon);
    expect(result.length).toBeLessThan(sampled.length);
    expect(result[0]).toEqual(sampled[0]);
    expect(result[result.length - 1]).toEqual(sampled[sampled.length - 1]);
    for (const point of sampled) expect(Math.abs(valueAt(result, point.time) - point.value)).toBeLessThanOrEqual(epsilon);
  });

  it("collapses a straight line to its endpoints and ignores tiny inputs", () => {
    const line = [0, 1, 2, 3].map((t) => ({ time: t, value: 0.5 + t * 0.1 }));
    expect(simplify(line, 0.001)).toEqual([line[0], line[3]]);
    expect(simplify([{ time: 1, value: 1 }], 0.1)).toEqual([{ time: 1, value: 1 }]);
  });
});
