import { describe, it, expect } from "vitest";
import { generateCapabilityMarkdown } from "./gen-docs";
import { toolDefs } from "./registry";

describe("generateCapabilityMarkdown", () => {
  it("renders a markdown doc covering the registry and manifest", () => {
    const md = generateCapabilityMarkdown();
    expect(md).toContain("# OpenReel Agent — Capability Reference");
    expect(md).toContain(`**${toolDefs().length} tools**`);
    expect(md).toContain("list_clips");
    expect(md).toContain("execute_action");
    expect(md).toContain("Capability manifest");
    expect(md).toMatch(/```json[\s\S]*```/);
  });
});
