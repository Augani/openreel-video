import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionTransform } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionCompositionLight,
  buildMotionLightingCanvasFilter,
  createMotionLight,
  findMotionLightKeyframeAtTime,
  getMotionLightAtTime,
  getMotionLightPropertyDescriptor,
  getMotionLightingForLayer,
  hasActiveMotionLights,
  moveMotionLightKeyframe,
  normalizeMotionLights,
  removeMotionCompositionLight,
  removeMotionLightPropertyKeyframes,
  toggleMotionCompositionLight,
  upsertMotionLightKeyframe,
} from "./motion-lights";

const makeComposition = (
  lights: MotionComposition["lights"] = [],
): MotionComposition => ({
  id: "motion-1",
  name: "Scene",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  lights,
  createdAt: 0,
  modifiedAt: 0,
});

const makeLayerTransform = (
  position: MotionTransform["position"],
): MotionTransform => ({
  ...DEFAULT_MOTION_TRANSFORM,
  position,
});

describe("motion lights", () => {
  it("creates and normalizes scene lights from composition dimensions", () => {
    const composition = makeComposition();
    const point = createMotionLight("point", composition, {
      id: "key",
      position: { x: 300, y: 200, z: 120 },
      radius: 0,
      falloff: 99,
      shadowOpacity: 9,
    });

    expect(point).toMatchObject({
      id: "key",
      type: "point",
      name: "Point Light",
      enabled: true,
      position: { x: 300, y: 200, z: 120 },
      radius: 1,
      falloff: 8,
      shadowOpacity: 1,
    });
    expect(hasActiveMotionLights(makeComposition())).toBe(false);
    expect(hasActiveMotionLights(makeComposition([point]))).toBe(true);
  });

  it("evaluates light keyframes deterministically", () => {
    const light = upsertMotionLightKeyframe(
      upsertMotionLightKeyframe(
        createMotionLight("point", makeComposition(), {
          intensity: 0,
        }),
        "light.intensity",
        0,
        { value: 0, easing: "linear", idFactory: () => "start" },
      ),
      "light.intensity",
      2,
      { value: 2, easing: "linear", idFactory: () => "end" },
    );

    expect(findMotionLightKeyframeAtTime(light, "light.intensity", 2)?.id).toBe(
      "end",
    );
    expect(getMotionLightAtTime(light, makeComposition(), 1).intensity).toBe(1);
  });

  it("moves and clears light property keyframes", () => {
    const light = upsertMotionLightKeyframe(
      upsertMotionLightKeyframe(
        createMotionLight("directional", makeComposition()),
        "light.angle",
        0,
        { value: 90, easing: "linear", idFactory: () => "angle-start" },
      ),
      "light.angle",
      3,
      { value: 180, easing: "linear", idFactory: () => "angle-end" },
    );
    const moved = moveMotionLightKeyframe(light, "angle-end", 2, 5);

    expect(getMotionLightPropertyDescriptor("light.angle").label).toBe("Angle");
    expect(moved.keyframes?.map((keyframe) => keyframe.time)).toEqual([0, 2]);
    expect(removeMotionLightPropertyKeyframes(moved, "light.angle").keyframes).toEqual(
      [],
    );
  });

  it("samples point lighting and shadow strength from layer position", () => {
    const composition = makeComposition([
      createMotionLight("point", makeComposition(), {
        id: "point",
        intensity: 1.2,
        position: { x: 500, y: 500, z: 0 },
        radius: 800,
        falloff: 1,
        castsShadow: true,
        shadowOpacity: 0.3,
      }),
    ]);

    const near = getMotionLightingForLayer(
      composition,
      makeLayerTransform({ x: 520, y: 540, z: 0 }),
      0,
    );
    const far = getMotionLightingForLayer(
      composition,
      makeLayerTransform({ x: 1800, y: 900, z: 0 }),
      0,
    );

    expect(near.brightness).toBeGreaterThan(far.brightness);
    expect(near.shadow?.offsetX).toBeGreaterThan(0);
    expect(near.shadow?.offsetY).toBeGreaterThan(0);
    expect(buildMotionLightingCanvasFilter(near)).toMatch(/^brightness\(/);
  });

  it("edits lights through composition helpers", () => {
    const composition = makeComposition();
    const light = createMotionLight("ambient", composition, {
      id: "ambient",
      intensity: 1,
    });
    const added = addMotionCompositionLight(composition, light);
    const disabled = toggleMotionCompositionLight(added, "ambient", false);
    const removed = removeMotionCompositionLight(disabled, "ambient");

    expect(normalizeMotionLights(added)).toHaveLength(1);
    expect(disabled.lights?.[0]?.enabled).toBe(false);
    expect(removed.lights).toEqual([]);
  });
});
