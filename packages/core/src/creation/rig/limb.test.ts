import { describe, it, expect } from "vitest";
import { isMeshValid } from "../geometry";
import { buildSkinnedLimb, limbWavePose } from "./limb";
import { skinMesh } from "./skin";

describe("skinned limb", () => {
  it("builds a valid tube limb with one weight pair per vertex", () => {
    const limb = buildSkinnedLimb({ length: 2, radius: 0.15, segments: 8, radialSegments: 8 });
    expect(isMeshValid(limb.mesh)).toBe(true);
    expect(limb.skeleton.bones.length).toBe(9);
    const vertexCount = limb.mesh.positions.length / 3;
    expect(limb.binding.boneIndices.length).toBe(vertexCount * 2);
    expect(limb.binding.weights.length).toBe(vertexCount * 2);
  });

  it("keeps the limb near its rest shape under the identity pose", () => {
    const limb = buildSkinnedLimb({ length: 2, segments: 8 });
    const rest = skinMesh(limb.mesh, limb.binding, limb.skeleton);
    let maxDelta = 0;
    for (let i = 0; i < limb.mesh.positions.length; i += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(rest.positions[i]! - limb.mesh.positions[i]!));
    }
    expect(maxDelta).toBeLessThan(1e-4);
  });

  it("bends smoothly: the tip deflects more than the base", () => {
    const limb = buildSkinnedLimb({ length: 2, segments: 8, radialSegments: 8 });
    const pose: Record<string, { rotation: { x: number; y: number; z: number } }> = {};
    for (let i = 1; i <= limb.segments; i += 1) {
      pose[`limb${i}`] = { rotation: { x: 0, y: 0, z: 20 } };
    }
    const bent = skinMesh(limb.mesh, limb.binding, limb.skeleton, pose);
    const vertexCount = limb.mesh.positions.length / 3;
    let baseDelta = 0;
    let baseCount = 0;
    let tipDelta = 0;
    let tipCount = 0;
    for (let v = 0; v < vertexCount; v += 1) {
      const y0 = limb.mesh.positions[v * 3 + 1]!;
      const dx = Math.abs(bent.positions[v * 3]! - limb.mesh.positions[v * 3]!);
      if (y0 < 0.3) {
        baseDelta += dx;
        baseCount += 1;
      } else if (y0 > 1.7) {
        tipDelta += dx;
        tipCount += 1;
      }
    }
    const baseAvg = baseCount > 0 ? baseDelta / baseCount : 0;
    const tipAvg = tipCount > 0 ? tipDelta / tipCount : 0;
    expect(baseAvg).toBeLessThan(0.05);
    expect(tipAvg).toBeGreaterThan(0.3);
    expect(isMeshValid(bent)).toBe(true);
  });

  it("produces a traveling-wave pose that varies along the chain and over time", () => {
    const a = limbWavePose(8, 0);
    const b = limbWavePose(8, 0.5);
    expect(Object.keys(a)).toHaveLength(8);
    expect(a.limb4).not.toEqual(b.limb4);
  });
});
