import { describe, expect, it } from "vitest";
import type { MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type { Keyframe } from "../types/timeline";
import {
  moveMotionLayerKeyframe,
  redistributeRovingKeyframeTimes,
  setMotionKeyframeRoving,
} from "./motion-keyframes";

const kf = (
  id: string,
  time: number,
  value: unknown,
  roving = false,
): Keyframe => ({
  id,
  time,
  property: "transform.position.x",
  value,
  easing: "linear",
  ...(roving ? { roving: true } : {}),
});

const makeLayer = (keyframes: readonly Keyframe[]): MotionLayer => ({
  id: "layer-1",
  type: "text",
  name: "Title",
  startTime: 0,
  duration: 10,
  visible: true,
  locked: false,
  transform: { ...DEFAULT_MOTION_TRANSFORM },
  keyframes: [...keyframes],
  text: "Hello",
  style: { fontFamily: "Inter", fontSize: 72, color: "#ffffff" },
});

const byId = (keyframes: readonly Keyframe[], id: string): Keyframe => {
  const found = keyframes.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing keyframe ${id}`);
  return found;
};

describe("redistributeRovingKeyframeTimes", () => {
  it("places roving keyframes at constant-speed times between anchors", () => {
    const result = redistributeRovingKeyframeTimes([
      kf("a", 0, 0),
      kf("m1", 0.4, 100, true),
      kf("m2", 2.6, 200, true),
      kf("b", 3, 300),
    ]);
    expect(byId(result, "m1").time).toBeCloseTo(1, 6);
    expect(byId(result, "m2").time).toBeCloseTo(2, 6);
    expect(byId(result, "a").time).toBeCloseTo(0, 6);
    expect(byId(result, "b").time).toBeCloseTo(3, 6);
  });

  it("uses cumulative absolute value delta including non-monotonic runs", () => {
    const result = redistributeRovingKeyframeTimes([
      kf("a", 0, 0),
      kf("m1", 1, 100, true),
      kf("b", 4, 0),
    ]);
    expect(byId(result, "m1").time).toBeCloseTo(2, 6);
  });

  it("distributes uniformly when the run has zero total delta", () => {
    const result = redistributeRovingKeyframeTimes([
      kf("a", 0, 50),
      kf("m1", 0.1, 50, true),
      kf("m2", 0.2, 50, true),
      kf("m3", 0.3, 50, true),
      kf("b", 4, 50),
    ]);
    expect(byId(result, "m1").time).toBeCloseTo(1, 6);
    expect(byId(result, "m2").time).toBeCloseTo(2, 6);
    expect(byId(result, "m3").time).toBeCloseTo(3, 6);
  });

  it("ignores a roving flag on the first and last keyframe defensively", () => {
    const result = redistributeRovingKeyframeTimes([
      kf("a", 0, 0, true),
      kf("m1", 0.5, 100, true),
      kf("b", 3, 300, true),
    ]);
    expect(byId(result, "a").time).toBeCloseTo(0, 6);
    expect(byId(result, "b").time).toBeCloseTo(3, 6);
    expect(byId(result, "m1").time).toBeCloseTo(1, 6);
  });

  it("treats non-numeric values as zero delta", () => {
    const result = redistributeRovingKeyframeTimes([
      kf("a", 0, "x"),
      kf("m1", 0.1, "y", true),
      kf("m2", 0.2, "z", true),
      kf("b", 3, "w"),
    ]);
    expect(byId(result, "m1").time).toBeCloseTo(1, 6);
    expect(byId(result, "m2").time).toBeCloseTo(2, 6);
  });

  it("leaves lists without roving keyframes unchanged", () => {
    const input = [kf("a", 0, 0), kf("b", 1, 100), kf("c", 2, 200)];
    const result = redistributeRovingKeyframeTimes(input);
    expect(result.map((entry) => entry.time)).toEqual([0, 1, 2]);
  });
});

describe("setMotionKeyframeRoving", () => {
  it("sets roving on a middle keyframe and re-derives its time", () => {
    const layer = makeLayer([
      kf("a", 0, 0),
      kf("m", 0.5, 100),
      kf("b", 3, 300),
    ]);
    const next = setMotionKeyframeRoving(
      layer,
      "transform.position.x",
      "m",
      true,
    );
    expect(byId(next.keyframes, "m").roving).toBe(true);
    expect(byId(next.keyframes, "m").time).toBeCloseTo(1, 6);
  });

  it("is a no-op when targeting an endpoint keyframe", () => {
    const layer = makeLayer([
      kf("a", 0, 0),
      kf("m", 1, 100),
      kf("b", 3, 300),
    ]);
    const next = setMotionKeyframeRoving(
      layer,
      "transform.position.x",
      "a",
      true,
    );
    expect(next).toBe(layer);
    expect(byId(next.keyframes, "a").roving).toBeUndefined();
  });

  it("clears roving when disabled", () => {
    const layer = makeLayer([
      kf("a", 0, 0),
      kf("m", 1, 100, true),
      kf("b", 3, 300),
    ]);
    const next = setMotionKeyframeRoving(
      layer,
      "transform.position.x",
      "m",
      false,
    );
    expect(byId(next.keyframes, "m").roving).toBeUndefined();
  });
});

describe("roving integration with keyframe ops", () => {
  it("shifts roving times when an anchor moves", () => {
    const layer = makeLayer([
      kf("a", 0, 0),
      kf("m1", 1, 100, true),
      kf("m2", 2, 200, true),
      kf("b", 3, 300),
    ]);
    const moved = moveMotionLayerKeyframe(layer, "b", 6);
    expect(byId(moved.keyframes, "b").time).toBeCloseTo(6, 6);
    expect(byId(moved.keyframes, "m1").time).toBeCloseTo(2, 6);
    expect(byId(moved.keyframes, "m2").time).toBeCloseTo(4, 6);
  });
});
