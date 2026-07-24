import { describe, it, expect } from "vitest";
import { evaluateMaterialGraph, type MaterialGraph } from "./graph";

describe("material graph evaluation", () => {
  it("mixes two colors at a factor and resolves output PBR", () => {
    const graph: MaterialGraph = {
      output: "out",
      nodes: [
        { id: "red", type: "color", params: { color: "#ff0000" } },
        { id: "blue", type: "color", params: { color: "#0000ff" } },
        { id: "half", type: "scalar", params: { value: 0.5 } },
        { id: "mixed", type: "mix", inputs: ["red", "blue", "half"] },
        { id: "metal", type: "scalar", params: { value: 0.8 } },
        { id: "rough", type: "scalar", params: { value: 0.3 } },
        { id: "out", type: "output", inputs: ["mixed", "metal", "rough"] },
      ],
    };
    const result = evaluateMaterialGraph(graph);
    expect(result.baseColor).toBe("#800080");
    expect(result.metallic).toBeCloseTo(0.8, 5);
    expect(result.roughness).toBeCloseTo(0.3, 5);
  });

  it("falls back to params on the output node", () => {
    const graph: MaterialGraph = {
      output: "out",
      nodes: [
        {
          id: "out",
          type: "output",
          params: { baseColor: "#3b82f6", metallic: 0.2, roughness: 0.6, emissive: "#111111" },
        },
      ],
    };
    const result = evaluateMaterialGraph(graph);
    expect(result.baseColor).toBe("#3b82f6");
    expect(result.metallic).toBeCloseTo(0.2, 5);
    expect(result.emissive).toBe("#111111");
  });

  it("multiplies a color by a scalar and tolerates cycles", () => {
    const graph: MaterialGraph = {
      output: "out",
      nodes: [
        { id: "white", type: "color", params: { color: "#ffffff" } },
        { id: "dim", type: "scalar", params: { value: 0.5 } },
        { id: "gray", type: "multiply", inputs: ["white", "dim"] },
        { id: "loop", type: "mix", inputs: ["loop", "white"] },
        { id: "out", type: "output", inputs: ["gray"] },
      ],
    };
    const result = evaluateMaterialGraph(graph);
    expect(result.baseColor).toBe("#808080");
  });
});
