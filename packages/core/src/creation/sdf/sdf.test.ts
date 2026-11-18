import { describe, it, expect } from "vitest";
import type { CreationRecipeNode } from "../schema/types";
import { computeMeshStats, isMeshValid } from "../geometry";
import {
  bakeSdfGraph,
  buildSdfGraph,
  marchingTetrahedra,
  sphereSdf,
} from "./index";

function sdfNode(
  id: string,
  parameters: CreationRecipeNode["parameters"],
): CreationRecipeNode {
  return { id, type: "sdf", name: id, inputs: [], parameters };
}

function booleanNode(
  id: string,
  inputs: readonly string[],
  parameters: CreationRecipeNode["parameters"],
): CreationRecipeNode {
  return { id, type: "boolean", name: id, inputs, parameters };
}

describe("marching tetrahedra", () => {
  it("extracts a closed sphere surface near the iso radius", () => {
    const mesh = marchingTetrahedra(
      sphereSdf(1),
      { min: { x: -1.5, y: -1.5, z: -1.5 }, max: { x: 1.5, y: 1.5, z: 1.5 } },
      20,
    );
    const stats = computeMeshStats(mesh);
    expect(stats.triangleCount).toBeGreaterThan(0);
    expect(isMeshValid(mesh)).toBe(true);
    let onSurface = 0;
    const vertexCount = mesh.positions.length / 3;
    for (let i = 0; i < vertexCount; i += 1) {
      const radius = Math.hypot(
        mesh.positions[i * 3]!,
        mesh.positions[i * 3 + 1]!,
        mesh.positions[i * 3 + 2]!,
      );
      if (Math.abs(radius - 1) < 0.12) onSurface += 1;
    }
    expect(onSurface).toBe(vertexCount);
  });
});

describe("sdf recipe graph", () => {

  it("returns null when no sdf/boolean node is present", () => {
    expect(
      buildSdfGraph([
        { id: "p", type: "primitive", name: "p", inputs: [], parameters: { kind: "box" } },
      ]),
    ).toBeNull();
  });

  it("resolves a boolean subtract graph (carved interior)", () => {
    const nodes: CreationRecipeNode[] = [
      sdfNode("body", { shape: "box", half: { x: 1, y: 1, z: 1 } }),
      sdfNode("hole", { shape: "sphere", radius: 0.5 }),
      booleanNode("cut", ["body", "hole"], { operation: "subtract" }),
    ];
    const graph = buildSdfGraph(nodes);
    expect(graph).not.toBeNull();
    expect(graph!.sdf({ x: 0, y: 0, z: 0 })).toBeGreaterThan(0);
    expect(graph!.sdf({ x: 0.9, y: 0, z: 0 })).toBeLessThan(0);
    expect(graph!.min.x).toBeCloseTo(-1, 6);
    expect(graph!.max.x).toBeCloseTo(1, 6);
  });

  it("bakes a boolean subtract graph into a valid closed mesh", () => {
    const nodes: CreationRecipeNode[] = [
      sdfNode("body", { shape: "box", half: { x: 1, y: 1, z: 1 } }),
      sdfNode("hole", { shape: "sphere", radius: 0.6 }),
      booleanNode("cut", ["body", "hole"], { operation: "subtract" }),
    ];
    const mesh = bakeSdfGraph(nodes, 24);
    expect(mesh).not.toBeNull();
    expect(isMeshValid(mesh!)).toBe(true);
    expect(computeMeshStats(mesh!).triangleCount).toBeGreaterThan(0);
  });
});
