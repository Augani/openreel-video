import { describe, expect, it } from "vitest";
import { listTools, toMcpTools } from "./registry";
import { toMcpToolsAnnotated } from "./mcp-tools";

describe("toMcpToolsAnnotated", () => {
  it("lists the same tools as toMcpTools, in the same order", () => {
    expect(toMcpToolsAnnotated().map((t) => t.name)).toEqual(toMcpTools().map((t) => t.name));
  });

  it("maps registry flags onto MCP annotations", () => {
    const byName = new Map(toMcpToolsAnnotated().map((t) => [t.name, t]));
    for (const def of listTools()) {
      const tool = byName.get(def.name)!;
      expect(tool.annotations.readOnlyHint).toBe(def.readOnly);
      expect(tool.annotations.idempotentHint).toBe(def.readOnly);
      expect(tool.annotations.destructiveHint).toBe(def.readOnly ? false : def.destructive);
      expect(tool.annotations.openWorldHint).toBe(false);
      expect(tool.annotations.title).toBe(def.title);
      expect(tool._meta["openreel/expensive"]).toBe(def.expensive);
    }
  });

  it("has at least one read-only and one destructive tool", () => {
    const tools = toMcpToolsAnnotated();
    expect(tools.some((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(tools.some((t) => t.annotations.destructiveHint)).toBe(true);
  });
});
