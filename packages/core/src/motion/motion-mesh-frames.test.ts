import { describe, it, expect } from "vitest";
import { sampleMotionObjectMeshFrame } from "./motion-three-renderer";
import type { MotionObject3D } from "./types";

const TRI_INDICES = [0, 1, 2];

function framesObject(loop?: boolean): MotionObject3D {
  return {
    kind: "plane",
    meshFrames: {
      fps: 30,
      indices: TRI_INDICES,
      uvs: [0, 0, 1, 0, 1, 1],
      loop,
      frames: [
        [0, 0, 0, 1, 0, 0, 1, 1, 0],
        [0, 0, 1, 1, 0, 1, 1, 1, 1],
        [0, 0, 2, 1, 0, 2, 1, 1, 2],
      ],
    },
  };
}

describe("sampleMotionObjectMeshFrame", () => {
  it("returns the object unchanged when there are no mesh frames", () => {
    const object: MotionObject3D = { kind: "box", size: 1 };
    expect(sampleMotionObjectMeshFrame(object, 0.5)).toBe(object);
  });

  it("samples the frame for the current time into mesh and strips meshFrames", () => {
    const object = framesObject();
    const atZero = sampleMotionObjectMeshFrame(object, 0);
    expect(atZero.mesh?.positions[2]).toBe(0);
    expect(atZero.mesh?.indices).toEqual(TRI_INDICES);
    expect(atZero.meshFrames).toBeUndefined();

    const atSecond = sampleMotionObjectMeshFrame(object, 1 / 30);
    expect(atSecond.mesh?.positions[2]).toBe(1);
  });

  it("clamps to the last frame past the end when not looping", () => {
    const sampled = sampleMotionObjectMeshFrame(framesObject(false), 10);
    expect(sampled.mesh?.positions[2]).toBe(2);
  });

  it("wraps around when looping", () => {
    const object = framesObject(true);
    expect(sampleMotionObjectMeshFrame(object, 3 / 30).mesh?.positions[2]).toBe(0);
    expect(sampleMotionObjectMeshFrame(object, 4 / 30).mesh?.positions[2]).toBe(1);
  });
});
