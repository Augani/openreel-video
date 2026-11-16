import { describe, expect, it } from "vitest";
import { MCP_INSTRUCTIONS } from "../../../apps/desktop/src/main/mcp/core";
import { toMcpToolsAnnotated } from "./mcp-tools";

/**
 * Tools the initialize `instructions` name that are owned by other work packages (WP-D/E) and
 * not on every branch yet. Delete an entry once its tool lands: the second test fails when an
 * entry is stale, so this list cannot rot. After the merge it must be empty.
 */
const PENDING_FROM_OTHER_PACKAGES: ReadonlySet<string> = new Set<string>([]);

const named = [...new Set(MCP_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
const registered = new Set(toMcpToolsAnnotated().map((t) => t.name));

describe("MCP initialize instructions drift", () => {
  it("only names tools that exist (or are explicitly pending from another package)", () => {
    const dangling = named.filter((n) => !registered.has(n) && !PENDING_FROM_OTHER_PACKAGES.has(n));
    expect(dangling, `MCP_INSTRUCTIONS names tools missing from the registry: ${dangling.join(", ")}`).toEqual([]);
  });

  it("has no stale entries in the pending list", () => {
    const stale = [...PENDING_FROM_OTHER_PACKAGES].filter((n) => registered.has(n) || !named.includes(n));
    expect(stale, `Remove from PENDING_FROM_OTHER_PACKAGES: ${stale.join(", ")}`).toEqual([]);
  });
});
