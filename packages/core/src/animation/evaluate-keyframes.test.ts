import { describe, it, expect } from "vitest";
import { evaluateKeyframesAt } from "./evaluate-keyframes";
import type { Keyframe } from "../types/timeline";

const kf = (property: string, time: number, value: number): Keyframe => ({
  id: `${property}-${time}`, property, time, value, easing: "linear",
});

describe("evaluateKeyframesAt", () => {
  it("returns interpolated value per property at local time", () => {
    const kfs = [kf("transform.opacity", 0, 0), kf("transform.opacity", 2, 1), kf("effect.e1.radius", 0, 0), kf("effect.e1.radius", 1, 10)];
    const m = evaluateKeyframesAt(kfs, 1);
    expect(m.get("transform.opacity")).toBeCloseTo(0.5);
    expect(m.get("effect.e1.radius")).toBeCloseTo(10);
  });
  it("empty keyframes → empty map", () => {
    expect(evaluateKeyframesAt([], 1).size).toBe(0);
  });
});
