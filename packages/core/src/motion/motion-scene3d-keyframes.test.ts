import { describe, expect, it } from "vitest";
import {
  isMotionAnimatableProperty,
  parseMotionSceneCameraKeyframeProperty,
  parseMotionSceneObjectKeyframeProperty,
} from "./motion-keyframes";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";
import type { Keyframe } from "../types/timeline";

describe("scene3d keyframe property paths", () => {
  it("accepts camera + object scene properties as animatable", () => {
    expect(isMotionAnimatableProperty("scene.camera.position.z")).toBe(true);
    expect(isMotionAnimatableProperty("scene.camera.target.x")).toBe(true);
    expect(isMotionAnimatableProperty("scene.camera.fov")).toBe(true);
    expect(
      isMotionAnimatableProperty("scene.object.a1b2-c3d4.rotation.y"),
    ).toBe(true);
    expect(
      isMotionAnimatableProperty("scene.object.a1b2-c3d4.lid.angle"),
    ).toBe(true);
    expect(isMotionAnimatableProperty("scene.object.a1b2.scale.z")).toBe(true);
  });

  it("rejects malformed scene properties", () => {
    expect(isMotionAnimatableProperty("scene.camera.position.w")).toBe(false);
    expect(isMotionAnimatableProperty("scene.object.a1b2.bogus")).toBe(false);
    expect(isMotionAnimatableProperty("scene.object..position.x")).toBe(false);
    expect(isMotionAnimatableProperty("scene.camera.fov.x")).toBe(false);
  });

  it("parses the object id out of a dotted sub-path", () => {
    const parsed = parseMotionSceneObjectKeyframeProperty(
      "scene.object.uuid-with-dashes.position.z",
    );
    expect(parsed).toEqual({
      objectId: "uuid-with-dashes",
      property: "position.z",
    });
    expect(parseMotionSceneCameraKeyframeProperty("scene.camera.target.y")).toEqual(
      { property: "target.y" },
    );
  });

  it("interpolates a scene camera channel at time with the existing evaluator", () => {
    const keyframes: Keyframe[] = [
      { id: "k0", time: 0, property: "scene.camera.position.z", value: 24, easing: "linear" },
      { id: "k1", time: 2, property: "scene.camera.position.z", value: 8, easing: "linear" },
    ];
    const at0 = evaluateMotionPropertyValueAtTime({
      keyframes,
      property: "scene.camera.position.z",
      localTime: 0,
      fallback: 14,
      duration: 6,
    });
    const at1 = evaluateMotionPropertyValueAtTime({
      keyframes,
      property: "scene.camera.position.z",
      localTime: 1,
      fallback: 14,
      duration: 6,
    });
    const at2 = evaluateMotionPropertyValueAtTime({
      keyframes,
      property: "scene.camera.position.z",
      localTime: 2,
      fallback: 14,
      duration: 6,
    });
    expect(at0).toBeCloseTo(24);
    expect(at1).toBeCloseTo(16);
    expect(at2).toBeCloseTo(8);
  });

  it("falls back to the provided base when no keyframes match the object channel", () => {
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      property: "scene.object.ball.scale.x",
      localTime: 1,
      fallback: 1,
      duration: 6,
    });
    expect(value).toBe(1);
  });
});
