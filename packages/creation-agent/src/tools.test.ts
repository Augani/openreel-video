import { describe, expect, it } from "vitest";
import {
  executeCreationTool,
  getCreationTool,
  listCreationTools,
  toMcpCreationTools,
} from "./index";

describe("creation tools", () => {
  it("lists product cinematic and validation tools", () => {
    expect(listCreationTools().map((tool) => tool.name)).toEqual([
      "create_product_cinematic_scene",
      "validate_creation_scene",
    ]);
    expect(toMcpCreationTools()[0]?.inputSchema.type).toBe("object");
  });

  it("creates a semantic editable phone cinematic scene", async () => {
    const result = await executeCreationTool("create_product_cinematic_scene", {
      name: "Agent phone intro",
      includeInternals: true,
      includeCallouts: true,
      duration: 6,
    });

    expect(result.ok).toBe(true);
    expect(result.scene?.assets[0]?.productParts?.some((part) => part.role === "chip")).toBe(true);
    expect(result.scene?.animations.some((animation) => animation.id === "anim-product-exploded-view")).toBe(true);
    expect(result.summary).toContain("product part");
  });

  it("validates scenes returned by the product tool", async () => {
    const created = await executeCreationTool("create_product_cinematic_scene", {});
    const validation = await getCreationTool("validate_creation_scene")!.handler({
      scene: created.scene,
    });
    expect(validation.ok).toBe(true);
    expect((validation.data as { issues: unknown[] }).issues).toEqual([]);
  });
});
