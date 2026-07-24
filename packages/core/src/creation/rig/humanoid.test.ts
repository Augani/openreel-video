import { describe, it, expect } from "vitest";
import { isMeshValid } from "../geometry";
import { buildSkinnedHumanoid, humanoidAnimationPose, humanoidWavePose } from "./humanoid";
import { skinMesh } from "./skin";

const HEIGHT = 2;

function averageY(positions: ArrayLike<number>, indices: readonly number[]): number {
  let sum = 0;
  for (const v of indices) sum += positions[v * 3 + 1]!;
  return indices.length > 0 ? sum / indices.length : 0;
}

describe("skinned humanoid", () => {
  it("builds a valid merged humanoid mesh with one weight pair per vertex", () => {
    const human = buildSkinnedHumanoid({ height: HEIGHT });
    expect(isMeshValid(human.mesh)).toBe(true);
    expect(human.skeleton.bones.length).toBe(17);
    const vertexCount = human.mesh.positions.length / 3;
    expect(human.binding.boneIndices.length).toBe(vertexCount * 2);
    expect(human.boneNames).toContain("foreArmR");
  });

  it("keeps its rest shape under the identity pose", () => {
    const human = buildSkinnedHumanoid({ height: HEIGHT });
    const rest = skinMesh(human.mesh, human.binding, human.skeleton);
    let maxDelta = 0;
    for (let i = 0; i < human.mesh.positions.length; i += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(rest.positions[i]! - human.mesh.positions[i]!));
    }
    expect(maxDelta).toBeLessThan(1e-4);
  });

  it("raises the right arm when the wave pose is applied (skinned, not rigid)", () => {
    const human = buildSkinnedHumanoid({ height: HEIGHT });
    const restPositions = human.mesh.positions;
    const rightArm: number[] = [];
    for (let v = 0; v < restPositions.length / 3; v += 1) {
      if (restPositions[v * 3]! > 0.2 * HEIGHT) rightArm.push(v);
    }
    expect(rightArm.length).toBeGreaterThan(0);
    const restAvgY = averageY(restPositions, rightArm);
    const waved = skinMesh(human.mesh, human.binding, human.skeleton, humanoidWavePose(0));
    expect(isMeshValid(waved)).toBe(true);
    expect(averageY(waved.positions, rightArm)).toBeGreaterThan(restAvgY + 0.1 * HEIGHT);
  });

  it("oscillates the forearm over time", () => {
    const a = humanoidWavePose(0);
    const b = humanoidWavePose(0.25);
    expect(a.foreArmR).not.toEqual(b.foreArmR);
  });

  it("dispatches distinct poses per animation and falls back to wave", () => {
    const walk = humanoidAnimationPose("walk", 0.3);
    const wave = humanoidAnimationPose("wave", 0.3);
    expect(walk.thighR).toBeDefined();
    expect(wave.thighR).toBeUndefined();
    expect(walk.thighR).not.toEqual(walk.thighL);
    expect(humanoidAnimationPose("idle", 0.3).head).toBeDefined();
    expect(humanoidAnimationPose("point", 1).shoulderR?.rotation?.x).toBeLessThan(0);
    expect(humanoidAnimationPose("bogus" as never, 0.3).foreArmR).toBeDefined();
  });

  it("deforms the legs under the walk animation", () => {
    const human = buildSkinnedHumanoid({ height: HEIGHT });
    const rest = human.mesh.positions;
    const walk = skinMesh(human.mesh, human.binding, human.skeleton, humanoidAnimationPose("walk", 0.25));
    expect(isMeshValid(walk)).toBe(true);
    let legDelta = 0;
    for (let v = 0; v < rest.length / 3; v += 1) {
      if (rest[v * 3 + 1]! < -0.3 * HEIGHT) {
        legDelta = Math.max(legDelta, Math.abs(walk.positions[v * 3 + 2]! - rest[v * 3 + 2]!));
      }
    }
    expect(legDelta).toBeGreaterThan(0.1);
  });
});
