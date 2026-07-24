import { describe, it, expect } from "vitest";
import type { Mesh } from "../geometry";
import {
  additivePose,
  blendPoses,
  composeTRS,
  computeBoneWorldMatrices,
  createSkinBinding,
  evaluatePose,
  identityMat4,
  invertMat4,
  makeBone,
  multiplyMat4,
  proceduralIdleClip,
  proceduralWalkClip,
  proceduralWaveClip,
  sampleSkeletalAnimation,
  skinMesh,
  solveTwoBoneIk,
  transformPoint,
  type SkeletalClip,
  type Skeleton,
} from "./index";

describe("rig matrix math", () => {
  it("inverts a composed transform back to identity", () => {
    const m = composeTRS({ x: 2, y: -3, z: 1 }, { x: 0, y: 45, z: 0 }, { x: 1, y: 1, z: 1 });
    const product = multiplyMat4(m, invertMat4(m));
    const identity = identityMat4();
    for (let i = 0; i < 16; i += 1) {
      expect(product[i]!).toBeCloseTo(identity[i]!, 6);
    }
  });

  it("translates a point", () => {
    const m = composeTRS({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(transformPoint(m, { x: 1, y: 2, z: 3 })).toEqual({ x: 6, y: 2, z: 3 });
  });
});

describe("rig skinning", () => {
  const skeleton: Skeleton = {
    bones: [makeBone("root", -1), makeBone("upper", 0, { position: { x: 0, y: 1, z: 0 } })],
  };

  it("computes hierarchical world matrices", () => {
    const world = computeBoneWorldMatrices(skeleton);
    expect(transformPoint(world[1]!, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("deforms a strip mesh with linear blend skinning", () => {
    const mesh: Mesh = {
      positions: Float32Array.from([0, 0, 0, 0, 2, 0, 0, 1, 0]),
      normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: Float32Array.from([0, 0, 0, 0, 0, 0]),
      indices: Uint32Array.from([0, 1, 2]),
    };
    const binding = createSkinBinding([0, 1, 1], [1, 1, 1], 1);
    const posed = skinMesh(mesh, binding, skeleton, { upper: { rotation: { x: 0, y: 0, z: 90 } } });

    expect(posed.positions[0]).toBeCloseTo(0, 5);
    expect(posed.positions[1]).toBeCloseTo(0, 5);

    expect(posed.positions[3]).toBeCloseTo(-1, 5);
    expect(posed.positions[4]).toBeCloseTo(1, 5);

    expect(posed.positions[6]).toBeCloseTo(0, 5);
    expect(posed.positions[7]).toBeCloseTo(1, 5);
  });
});

describe("rig animation", () => {
  const clip: SkeletalClip = {
    name: "wave",
    duration: 1,
    tracks: [
      {
        bone: "upper",
        keyframes: [
          { time: 0, rotation: { x: 0, y: 0, z: 0 } },
          { time: 1, rotation: { x: 0, y: 0, z: 90 } },
        ],
      },
    ],
  };

  it("interpolates a bone rotation between keyframes", () => {
    const pose = evaluatePose(clip, 0.5);
    expect(pose.upper?.rotation?.z).toBeCloseTo(45, 5);
  });

  it("clamps to the first and last keyframe outside the range", () => {
    expect(evaluatePose(clip, -1).upper?.rotation?.z).toBeCloseTo(0, 5);
    expect(evaluatePose(clip, 5).upper?.rotation?.z).toBeCloseTo(90, 5);
  });

  it("samples an animation into per-frame poses", () => {
    const poses = sampleSkeletalAnimation(clip, 30);
    expect(poses.length).toBe(31);
    expect(poses[0]?.upper?.rotation?.z).toBeCloseTo(0, 5);
    expect(poses[30]?.upper?.rotation?.z).toBeCloseTo(90, 5);
  });

  it("blends and adds poses", () => {
    const a = { upper: { rotation: { x: 0, y: 0, z: 0 } } };
    const b = { upper: { rotation: { x: 0, y: 0, z: 90 } } };
    expect(blendPoses(a, b, 0.5).upper?.rotation?.z).toBeCloseTo(45, 5);
    expect(additivePose(b, { upper: { rotation: { x: 0, y: 0, z: 10 } } }).upper?.rotation?.z).toBeCloseTo(
      100,
      5,
    );
  });
});

describe("rig two-bone IK", () => {
  it("places the elbow at the midpoint when reaching straight", () => {
    const result = solveTwoBoneIk({
      root: { x: 0, y: 2, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      upperLength: 1,
      lowerLength: 1,
    });
    expect(result.reachable).toBe(true);
    expect(result.elbow.x).toBeCloseTo(0, 5);
    expect(result.elbow.y).toBeCloseTo(1, 5);
  });

  it("keeps both bone lengths when bending toward the pole", () => {
    const root = { x: 0, y: 2, z: 0 };
    const target = { x: 1.4, y: 2, z: 0 };
    const result = solveTwoBoneIk({
      root,
      target,
      upperLength: 1,
      lowerLength: 1,
      poleHint: { x: 0, y: 1, z: 0 },
    });
    const upper = Math.hypot(
      result.elbow.x - root.x,
      result.elbow.y - root.y,
      result.elbow.z - root.z,
    );
    const lower = Math.hypot(
      target.x - result.elbow.x,
      target.y - result.elbow.y,
      target.z - result.elbow.z,
    );
    expect(upper).toBeCloseTo(1, 4);
    expect(lower).toBeCloseTo(1, 4);
  });

  it("flags an out-of-reach target as not reachable", () => {
    const result = solveTwoBoneIk({
      root: { x: 0, y: 0, z: 0 },
      target: { x: 5, y: 0, z: 0 },
      upperLength: 1,
      lowerLength: 1,
    });
    expect(result.reachable).toBe(false);
  });
});

describe("procedural animation clips", () => {
  it("generates a wave clip raising and oscillating the arm", () => {
    const clip = proceduralWaveClip({
      upperArmBone: "upperarm.R",
      forearmBone: "forearm.R",
      side: "right",
    });
    expect(clip.name).toBe("wave");
    const upper = clip.tracks.find((track) => track.bone === "upperarm.R");
    expect(upper).toBeTruthy();
    const lastRotation = upper!.keyframes[upper!.keyframes.length - 1]!.rotation!.z;
    expect(lastRotation).toBeLessThan(0);
    const posed = evaluatePose(clip, clip.duration);
    expect(posed["upperarm.R"]?.rotation?.z).toBeLessThan(0);
  });

  it("generates idle and walk clips with the expected bone tracks", () => {
    const idle = proceduralIdleClip({ spineBone: "spine", headBone: "head" });
    expect(idle.tracks.map((track) => track.bone).sort()).toEqual(["head", "spine"]);

    const walk = proceduralWalkClip({
      leftThighBone: "thigh.L",
      rightThighBone: "thigh.R",
      leftArmBone: "upperarm.L",
      rightArmBone: "upperarm.R",
    });
    const leftThigh = walk.tracks.find((track) => track.bone === "thigh.L")!;
    const rightThigh = walk.tracks.find((track) => track.bone === "thigh.R")!;
    const quarter = walk.duration * 0.25;
    const left = leftThigh.keyframes.reduce((closest, frame) =>
      Math.abs(frame.time - quarter) < Math.abs(closest.time - quarter) ? frame : closest,
    );
    const right = rightThigh.keyframes.reduce((closest, frame) =>
      Math.abs(frame.time - quarter) < Math.abs(closest.time - quarter) ? frame : closest,
    );
    expect(Math.sign(left.rotation!.x)).not.toBe(Math.sign(right.rotation!.x));
  });
});
