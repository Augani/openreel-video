import { describe, expect, it } from "vitest";
import type { Keyframe } from "@openreel/core";
import { effectInstanceKeyframeProperty } from "@openreel/core/video/effect-instance-keyframes";
import { cornerPinPercentAt, planCornerPinMove } from "./corner-pin-edit";

const key = (param: string, time: number, value: number): Keyframe => ({ id: `${param}-${time}`, property: effectInstanceKeyframeProperty("fx1", param), time, value, easing: "linear" });
const effect = { id: "fx1", params: { x0: 10, y0: 10, x1: 90, y1: 10, x2: 90, y2: 90, x3: 10, y3: 90 } };
let n = 0;
const id = () => `new-${n++}`;

describe("corner pin monitor editing", () => {
  it("reads stored corners and interpolates keyframed ones", () => {
    const keyframes = [key("x1", 0, 90), key("x1", 2, 50)];
    const at = cornerPinPercentAt(keyframes, effect, 1);
    expect(at[0]).toBe(10); expect(at[2]).toBeCloseTo(70); expect(at[3]).toBe(10);
    expect(cornerPinPercentAt([], { id: "fx1", params: {} }, 0)).toEqual([0, 0, 100, 0, 100, 100, 0, 100]);
  });
  it("writes a static corner into the effect parameters and clamps to the allowed range", () => {
    const plan = planCornerPinMove({ keyframes: [] }, effect, 2, 95.123, 400, 0, id);
    expect(plan.keyframes).toBeNull();
    expect(plan.params).toEqual({ x2: 95.12, y2: 200 });
  });
  it("writes a keyframe at the playhead for an animated coordinate and keeps the others static", () => {
    const keyframes = [key("x1", 0, 90), key("x1", 2, 50)];
    const plan = planCornerPinMove({ keyframes }, effect, 1, 60, 20, 1, id);
    expect(plan.params).toEqual({ y1: 20 });
    expect(plan.keyframes).toHaveLength(3);
    expect(plan.keyframes!.find((k) => k.time === 1)).toMatchObject({ property: effectInstanceKeyframeProperty("fx1", "x1"), value: 60 });
    // Editing an existing keyframe time replaces it instead of adding another.
    const again = planCornerPinMove({ keyframes: plan.keyframes! }, effect, 1, 65, 20, 1, id);
    expect(again.keyframes).toHaveLength(3);
  });
});
