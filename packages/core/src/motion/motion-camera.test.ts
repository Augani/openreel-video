import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionTransform } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  applyMotionCameraToTransform,
  buildMotionCameraDepthOfFieldCanvasFilter,
  createDefaultMotionCamera,
  findMotionCameraKeyframeAtTime,
  getMotionCameraAtTime,
  getMotionCameraDepthOfFieldBlur,
  getMotionCameraPropertyDescriptor,
  getMotionCameraWorldDelta,
  hasActiveMotionCamera,
  moveMotionCameraKeyframe,
  normalizeMotionCamera,
  removeMotionCameraKeyframe,
  removeMotionCameraPropertyKeyframes,
  setMotionCameraDepthOfFieldEnabled,
  upsertMotionCameraKeyframe,
} from "./motion-camera";

const makeComposition = (
  camera?: MotionComposition["camera"],
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
  createdAt: 0,
  modifiedAt: 0,
  camera,
});

describe("motion camera", () => {
  it("normalizes a default scene camera from composition dimensions", () => {
    const composition = makeComposition();
    const camera = createDefaultMotionCamera(composition);

    expect(camera).toMatchObject({
      enabled: true,
      position: { x: 960, y: 540, z: 0 },
      zoom: 1,
      rotation: 0,
      perspective: 1000,
      depthOfField: {
        enabled: false,
        focusDistance: 0,
        aperture: 1,
        maxBlur: 24,
      },
    });
    expect(normalizeMotionCamera(composition).enabled).toBe(false);
    expect(hasActiveMotionCamera(composition)).toBe(false);
  });

  it("applies camera pan, zoom, depth, and rotation as a view transform", () => {
    const composition = makeComposition({
      enabled: true,
      position: { x: 1060, y: 640, z: 200 },
      zoom: 2,
      rotation: 15,
      perspective: 1400,
    });
    const transform: MotionTransform = {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: 1160, y: 690, z: 500 },
      scale: { x: 1.5, y: 0.5 },
      rotation: 45,
    };

    const viewed = applyMotionCameraToTransform(composition, transform);

    expect(viewed.position.x).toBeCloseTo(1179.067, 2);
    expect(viewed.position.y).toBeCloseTo(584.829, 2);
    expect(viewed.position.z).toBe(300);
    expect(viewed.scale).toEqual({ x: 3, y: 1 });
    expect(viewed.rotation).toBe(30);
    expect(viewed.perspective).toBe(1400);
    expect(getMotionCameraWorldDelta(composition, { x: 20, y: -10 })).toEqual({
      x: 10,
      y: -5,
    });
  });

  it("evaluates and edits camera property keyframes", () => {
    const baseCamera = createDefaultMotionCamera(makeComposition());
    const camera = upsertMotionCameraKeyframe(
      upsertMotionCameraKeyframe(baseCamera, "camera.zoom", 0, {
        value: 1,
        easing: "linear",
        idFactory: () => "zoom-start",
      }),
      "camera.zoom",
      2,
      {
        value: 2,
        easing: "linear",
        idFactory: () => "zoom-end",
      },
    );
    const composition = makeComposition(camera);

    expect(getMotionCameraAtTime(composition, 1).zoom).toBe(1.5);
    expect(
      applyMotionCameraToTransform(
        composition,
        {
          ...DEFAULT_MOTION_TRANSFORM,
          position: { x: 1060, y: 540, z: 0 },
        },
        1,
      ).position.x,
    ).toBe(1110);

    const activeKeyframe = findMotionCameraKeyframeAtTime(
      camera,
      "camera.zoom",
      2,
    );
    expect(activeKeyframe?.id).toBe("zoom-end");
    expect(
      removeMotionCameraKeyframe(camera, "zoom-end").keyframes?.map(
        (keyframe) => keyframe.id,
      ),
    ).toEqual(["zoom-start"]);
    expect(
      moveMotionCameraKeyframe(camera, "zoom-end", 1.25, 5).keyframes?.map(
        (keyframe) => [keyframe.id, keyframe.time],
      ),
    ).toEqual([
      ["zoom-start", 0],
      ["zoom-end", 1.25],
    ]);
    expect(getMotionCameraPropertyDescriptor("camera.zoom").label).toBe(
      "Camera Zoom",
    );
    expect(
      removeMotionCameraPropertyKeyframes(camera, "camera.zoom").keyframes,
    ).toEqual([]);
  });

  it("evaluates depth of field focus pulls and derives blur filters", () => {
    const baseCamera = setMotionCameraDepthOfFieldEnabled(
      {
        ...createDefaultMotionCamera(makeComposition()),
        perspective: 1000,
      },
      true,
    );
    const camera = upsertMotionCameraKeyframe(
      upsertMotionCameraKeyframe(baseCamera, "camera.focusDistance", 0, {
        value: 0,
        easing: "linear",
        idFactory: () => "focus-near",
      }),
      "camera.focusDistance",
      2,
      {
        value: 500,
        easing: "linear",
        idFactory: () => "focus-far",
      },
    );
    const composition = makeComposition({
      ...camera,
      depthOfField: {
        enabled: true,
        focusDistance: 0,
        aperture: 2,
        maxBlur: 20,
      },
    });
    const focusedTransform: MotionTransform = {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: 960, y: 540, z: 250 },
    };
    const defocusedTransform: MotionTransform = {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x: 960, y: 540, z: 750 },
    };

    expect(getMotionCameraAtTime(composition, 1).depthOfField).toMatchObject({
      enabled: true,
      focusDistance: 250,
      aperture: 2,
      maxBlur: 20,
    });
    expect(
      getMotionCameraDepthOfFieldBlur(composition, focusedTransform, 1),
    ).toBeCloseTo(0);
    expect(
      getMotionCameraDepthOfFieldBlur(composition, defocusedTransform, 1),
    ).toBeCloseTo(20);
    expect(
      buildMotionCameraDepthOfFieldCanvasFilter(
        composition,
        defocusedTransform,
        1,
      ),
    ).toBe("blur(20px)");
    expect(getMotionCameraPropertyDescriptor("camera.focusDistance").label).toBe(
      "Focus Distance",
    );
  });
});
