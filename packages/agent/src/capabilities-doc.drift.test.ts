import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateCapabilityMarkdown } from "./gen-docs";
import { listTools, toMcpTools } from "./registry";

const DOCS = path.resolve(__dirname, "../../../docs");
const REGENERATE = "Run `pnpm --filter @openreel/agent docs:capabilities` and commit docs/AGENT-CAPABILITIES.md (docs/ is gitignored: use `git add -f`).";

describe("docs/AGENT-CAPABILITIES.md drift", () => {
  const file = path.join(DOCS, "AGENT-CAPABILITIES.md");

  it("exists", () => {
    expect(existsSync(file), REGENERATE).toBe(true);
  });

  it("matches what the registry generates right now", () => {
    const committed = readFileSync(file, "utf8");
    const generated = generateCapabilityMarkdown();
    expect(committed === generated, `The committed capability reference is stale. ${REGENERATE}`).toBe(true);
  });

  it("states the same tool count the registry exposes over MCP", () => {
    const committed = readFileSync(file, "utf8");
    const match = /exposes \*\*(\d+) tools\*\*/.exec(committed);
    expect(match, "Header with the tool count is missing").not.toBeNull();
    const documented = Number(match![1]);
    expect(documented, REGENERATE).toBe(listTools().length);
    expect(toMcpTools()).toHaveLength(documented);
  });
});

describe("docs/AGENT-GUIDE.md", () => {
  it("does not hardcode a tool count (it goes stale; the generated reference is the source)", () => {
    const guide = readFileSync(path.join(DOCS, "AGENT-GUIDE.md"), "utf8");
    expect(/\b\d{2,4}\s+tools\b/i.test(guide)).toBe(false);
  });
});
