import { describe, it, expect } from "vitest";
import { isMeshValid, computeMeshStats } from "../geometry";
import { clothToMesh, createClothGrid, simulateCloth } from "./cloth";

describe("cloth simulation", () => {
  it("keeps pinned particles fixed while a horizontal cloth droops under gravity", () => {
    const cloth = createClothGrid({
      width: 2,
      height: 2,
      columns: 5,
      rows: 5,
      pin: "top",
      plane: "xz",
    });
    const tipIndex = (5 - 1) * 5 + Math.floor(5 / 2);
    const pinnedBefore = cloth.particles[0]!;
    const simulated = simulateCloth(cloth, { steps: 120, gravity: 9.8, iterations: 8 });
    const pinnedAfter = simulated.particles[0]!;
    const tipAfter = simulated.particles[tipIndex]!;

    expect(pinnedAfter.y).toBeCloseTo(pinnedBefore.y, 6);
    expect(pinnedAfter.z).toBeCloseTo(pinnedBefore.z, 6);
    expect(tipAfter.y).toBeLessThan(-0.1);
    expect(Number.isFinite(tipAfter.y)).toBe(true);
  });

  it("triangulates the cloth into a valid mesh", () => {
    const cloth = createClothGrid({ width: 2, height: 2, columns: 4, rows: 4, pin: "top" });
    const mesh = clothToMesh(cloth);
    expect(isMeshValid(mesh)).toBe(true);
    expect(computeMeshStats(mesh).triangleCount).toBe((4 - 1) * (4 - 1) * 2);
  });
});
