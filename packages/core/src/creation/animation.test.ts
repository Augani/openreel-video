import { describe, expect, it } from "vitest";
import { evaluateCreationSceneAtTime } from "./animation";
import { IDENTITY_TRANSFORM } from "./schema/common";
import type { CreationScene } from "./schema/types";

function scene(): CreationScene {
  return {
    id: "scene-animated",
    name: "Animated Scene",
    duration: 4,
    frameRate: 30,
    objects: [
      {
        id: "object-box",
        name: "Box",
        assetId: "asset-box",
        materialId: "mat-box",
        transform: IDENTITY_TRANSFORM,
        visible: true,
        selectable: true,
        tags: [],
      },
    ],
    cameras: [
      {
        id: "camera-main",
        name: "Camera",
        position: { x: 0, y: 1, z: 5 },
        target: { x: 0, y: 0, z: 0 },
        fov: 40,
      },
    ],
    activeCameraId: "camera-main",
    lights: [],
    animations: [
      {
        id: "clip-1",
        name: "Move object and camera",
        duration: 4,
        tracks: [
          {
            id: "track-position",
            targetId: "object-box",
            channel: "position",
            keyframes: [
              { time: 1, value: { x: 0, y: 0, z: 0 }, easing: "linear" },
              { time: 3, value: { x: 4, y: 2, z: -2 }, easing: "linear" },
            ],
          },
          {
            id: "track-camera-position",
            targetId: "camera-main",
            channel: "camera.position",
            keyframes: [
              { time: 0, value: { x: 0, y: 1, z: 5 }, easing: "linear" },
              { time: 2, value: { x: 2, y: 3, z: 7 }, easing: "linear" },
            ],
          },
          {
            id: "track-camera-fov",
            targetId: "camera-main",
            channel: "camera.fov",
            keyframes: [
              { time: 0, value: 40, easing: "linear" },
              { time: 2, value: 20, easing: "linear" },
            ],
          },
        ],
      },
    ],
    environment: { kind: "studio", backgroundColor: "#020617" },
    renderBindings: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("evaluateCreationSceneAtTime", () => {
  it("keeps base object transforms before the first keyframe", () => {
    const evaluated = evaluateCreationSceneAtTime(scene(), 0.5);

    expect(evaluated.objects[0]?.transform.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("interpolates object and camera tracks at a requested time", () => {
    const evaluated = evaluateCreationSceneAtTime(scene(), 2);

    expect(evaluated.objects[0]?.transform.position).toEqual({
      x: 2,
      y: 1,
      z: -1,
    });
    expect(evaluated.cameras[0]?.position).toEqual({ x: 2, y: 3, z: 7 });
    expect(evaluated.cameras[0]?.fov).toBe(20);
  });

  it("holds the final keyframe after the track ends", () => {
    const evaluated = evaluateCreationSceneAtTime(scene(), 4);

    expect(evaluated.objects[0]?.transform.position).toEqual({
      x: 4,
      y: 2,
      z: -2,
    });
  });

  it("samples keyframes correctly when an agent sends them out of order", () => {
    const base = scene();
    const [clip] = base.animations;
    const [track] = clip?.tracks ?? [];
    const draft: CreationScene = {
      ...base,
      animations:
        clip && track
          ? [
              {
                ...clip,
                tracks: [
                  {
                    ...track,
                    keyframes: [...track.keyframes].reverse(),
                  },
                ],
              },
            ]
          : base.animations,
    };

    const evaluated = evaluateCreationSceneAtTime(draft, 2);

    expect(evaluated.objects[0]?.transform.position).toEqual({
      x: 2,
      y: 1,
      z: -1,
    });
  });
});
