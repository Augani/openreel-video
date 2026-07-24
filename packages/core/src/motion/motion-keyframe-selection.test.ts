import { describe, expect, it } from "vitest";
import { DEFAULT_MOTION_TRANSFORM, type MotionComposition } from "./types";
import {
  duplicateMotionKeyframes,
  offsetMotionKeyframes,
} from "./motion-keyframe-selection";

function composition(): MotionComposition {
  return {
    id: "group-keyframes",
    name: "Group keyframes",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "transparent",
    layers: [
      {
        id: "layer-1",
        type: "shape",
        name: "Shape",
        startTime: 0,
        duration: 4,
        visible: true,
        locked: false,
        transform: DEFAULT_MOTION_TRANSFORM,
        keyframes: [
          { id: "layer-a", property: "transform.position.x", time: 1, value: 10, easing: "ease" },
          { id: "layer-b", property: "transform.position.x", time: 3, value: 20, easing: "ease" },
          { id: "collision", property: "transform.position.x", time: 3.5, value: 99, easing: "ease" },
        ],
        masks: [
          {
            id: "mask-1",
            name: "Path Mask",
            enabled: true,
            shape: "path",
            mode: "add",
            inverted: false,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            rotation: 0,
            pathPoints: [
              { x: -50, y: -50 },
              { x: 50, y: -50 },
              { x: 0, y: 50 },
            ],
            pathKeyframes: [
              {
                id: "mask-a",
                property: "mask.mask-1.path",
                time: 1.5,
                value: "M -50 -50 L 50 -50 L 0 50 Z",
                easing: "ease",
              },
            ],
          },
        ],
        shapeType: "rectangle",
        width: 100,
        height: 100,
        style: {
          fill: { type: "solid", color: "#fff", opacity: 1 },
          stroke: { color: "#fff", width: 0, opacity: 1 },
        },
      },
    ],
    camera: {
      enabled: true,
      position: { x: 960, y: 540 },
      zoom: 100,
      rotation: 0,
      perspective: 1200,
      keyframes: [
        { id: "camera-a", property: "camera.zoom", time: 0.5, value: 100, easing: "ease" },
      ],
    },
    lights: [
      {
        id: "light-1",
        name: "Point",
        type: "point",
        enabled: true,
        color: "#fff",
        intensity: 1,
        position: { x: 960, y: 540 },
        radius: 800,
        falloff: 1,
        angle: 45,
        castsShadow: false,
        shadowOpacity: 0.35,
        shadowSoftness: 24,
        keyframes: [
          { id: "light-a", property: "light.intensity", time: 2, value: 1, easing: "ease" },
        ],
      },
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("offsetMotionKeyframes", () => {
  it("moves a mixed selection by one shared delta", () => {
    const result = offsetMotionKeyframes(
      composition(),
      ["layer-a", "mask-a", "camera-a", "light-a"],
      0.75,
    );

    expect(result.appliedDelta).toBe(0.75);
    expect(result.composition.layers[0].keyframes.find((keyframe) => keyframe.id === "layer-a")?.time).toBe(1.75);
    expect(result.composition.layers[0].masks?.[0]?.pathKeyframes?.[0]?.time).toBe(2.25);
    expect(result.composition.camera?.keyframes?.[0]?.time).toBe(1.25);
    expect(result.composition.lights?.[0]?.keyframes?.[0]?.time).toBe(2.75);
  });

  it("clamps the group together so spacing is preserved", () => {
    const result = offsetMotionKeyframes(
      composition(),
      ["layer-a", "layer-b", "camera-a"],
      -2,
    );

    expect(result.appliedDelta).toBe(-0.5);
    const times = result.composition.layers[0].keyframes
      .filter((keyframe) => keyframe.id === "layer-a" || keyframe.id === "layer-b")
      .map((keyframe) => keyframe.time);
    expect(times).toEqual([0.5, 2.5]);
    expect(result.composition.camera?.keyframes?.[0]?.time).toBe(0);
  });

  it("replaces unselected same-property collisions with the moved key", () => {
    const result = offsetMotionKeyframes(composition(), ["layer-b"], 0.5);
    const keyframes = result.composition.layers[0].keyframes;

    expect(keyframes.some((keyframe) => keyframe.id === "collision")).toBe(false);
    expect(keyframes.find((keyframe) => keyframe.id === "layer-b")?.time).toBe(3.5);
  });
});

describe("duplicateMotionKeyframes", () => {
  it("copies a mixed selection to the target time while preserving spacing", () => {
    let id = 0;
    const result = duplicateMotionKeyframes(
      composition(),
      ["layer-a", "mask-a", "camera-a", "light-a"],
      1,
      () => `copy-${++id}`,
    );

    expect(result.appliedDelta).toBe(0.5);
    expect(result.duplicatedKeyframeIds).toEqual([
      "copy-1",
      "copy-2",
      "copy-3",
      "copy-4",
    ]);
    expect(
      result.composition.layers[0].keyframes.find((keyframe) => keyframe.id === "copy-1")?.time,
    ).toBe(1.5);
    expect(
      result.composition.layers[0].masks?.[0]?.pathKeyframes?.find(
        (keyframe) => keyframe.id === "copy-2",
      )?.time,
    ).toBe(2);
    expect(
      result.composition.camera?.keyframes?.find((keyframe) => keyframe.id === "copy-3")?.time,
    ).toBe(1);
    expect(
      result.composition.lights?.[0]?.keyframes?.find(
        (keyframe) => keyframe.id === "copy-4",
      )?.time,
    ).toBe(2.5);
  });

  it("clamps copied keyframes as a group and replaces target collisions", () => {
    const result = duplicateMotionKeyframes(
      composition(),
      ["layer-b"],
      8,
      () => "layer-copy",
    );

    expect(result.appliedDelta).toBe(1);
    expect(
      result.composition.layers[0].keyframes.find(
        (keyframe) => keyframe.id === "layer-copy",
      )?.time,
    ).toBe(4);
  });

  it("aligns layer-local keyframes using their absolute composition time", () => {
    const source = composition();
    const shifted: MotionComposition = {
      ...source,
      duration: 8,
      layers: source.layers.map((layer) => ({
        ...layer,
        startTime: 2,
      })),
    };
    const result = duplicateMotionKeyframes(
      shifted,
      ["layer-a"],
      5,
      () => "absolute-copy",
    );

    expect(result.appliedDelta).toBe(2);
    expect(
      result.composition.layers[0].keyframes.find(
        (keyframe) => keyframe.id === "absolute-copy",
      )?.time,
    ).toBe(3);
  });
});
