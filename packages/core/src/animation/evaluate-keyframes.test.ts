import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import { EASING_FUNCTIONS } from "./easing-functions";
import { evaluateKeyframesAt } from "./evaluate-keyframes";

describe("evaluateKeyframesAt", () => {
  it("evaluates numeric keyframes by property at a fixed time", () => {
    const keyframes: Keyframe[] = [
      {
        id: "opacity-a",
        time: 0,
        property: "transform.opacity",
        value: 0,
        easing: "linear",
      },
      {
        id: "opacity-b",
        time: 1,
        property: "transform.opacity",
        value: 1,
        easing: "linear",
      },
      {
        id: "rotation-a",
        time: 0,
        property: "transform.rotation",
        value: 0,
        easing: "linear",
      },
      {
        id: "rotation-b",
        time: 1,
        property: "transform.rotation",
        value: 90,
        easing: "linear",
      },
    ];

    const values = evaluateKeyframesAt(keyframes, 0.5);

    expect(values.get("transform.opacity")).toBeCloseTo(0.5, 6);
    expect(values.get("transform.rotation")).toBeCloseTo(45, 6);
  });

  it("ignores non-numeric values", () => {
    const values = evaluateKeyframesAt(
      [
        {
          id: "text-a",
          time: 0,
          property: "text.value",
          value: "A",
          easing: "linear",
        },
      ],
      0,
    );

    expect(values.size).toBe(0);
  });

  it("honors the full named easing catalog during interpolation", () => {
    const keyframes: Keyframe[] = [
      {
        id: "scale-a",
        time: 0,
        property: "transform.scale.x",
        value: 0,
        easing: "easeOutBack",
      },
      {
        id: "scale-b",
        time: 1,
        property: "transform.scale.x",
        value: 100,
        easing: "linear",
      },
    ];

    const values = evaluateKeyframesAt(keyframes, 0.5);

    expect(values.get("transform.scale.x")).toBeCloseTo(
      EASING_FUNCTIONS.easeOutBack(0.5) * 100,
      6,
    );
    expect(values.get("transform.scale.x")).not.toBeCloseTo(50, 6);
  });

  it("supports hold keyframes for stepped property changes", () => {
    const keyframes: Keyframe[] = [
      {
        id: "state-a",
        time: 0,
        property: "shape.stroke.width",
        value: 2,
        easing: "hold",
      },
      {
        id: "state-b",
        time: 1,
        property: "shape.stroke.width",
        value: 12,
        easing: "linear",
      },
    ];

    expect(evaluateKeyframesAt(keyframes, 0.5).get("shape.stroke.width")).toBe(2);
    expect(evaluateKeyframesAt(keyframes, 0.999).get("shape.stroke.width")).toBe(2);
    expect(evaluateKeyframesAt(keyframes, 1).get("shape.stroke.width")).toBe(12);
  });
});
