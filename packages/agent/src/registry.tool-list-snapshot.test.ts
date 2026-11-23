import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { toAnthropicTools, toMcpTools, toolDefs } from "./registry";
import snapshot from "./tool-list.snapshot.json";

/**
 * The model-visible tool list (names, order, domain, title, description, input schema and the
 * read-only / destructive / expensive flags) is pinned as per-tool hashes. The registry splits its
 * domain groups into lazily loaded chunks; this proves that did not change what the model sees.
 * An intentional tool change updates the snapshot with:
 *   SNAP_OUT=$PWD/src/tool-list.snapshot.json npx vitest run src/registry.tool-list-snapshot.test.ts -t regenerate
 */
const hash = (v: unknown): string => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

describe("tool list snapshot", () => {
  it("lists every tool, in order, with unchanged definitions", () => {
    const defs = toolDefs();
    const actual = defs.map((d) => `${d.name}:${hash(d).slice(0, 16)}`);
    expect(defs.length).toBe(snapshot.count);
    expect(actual).toEqual(snapshot.tools);
    expect(hash(defs)).toBe(snapshot.total);
  });

  it("serves the same definitions through the MCP and Anthropic formats", () => {
    const names = toolDefs().map((d) => d.name);
    expect(toMcpTools().map((t) => t.name)).toEqual(names);
    expect(toAnthropicTools().map((t) => t.name)).toEqual(names);
  });

  it.runIf(Boolean(process.env.SNAP_OUT))("regenerate", async () => {
    const fs = await import("node:fs");
    const defs = toolDefs();
    fs.writeFileSync(
      process.env.SNAP_OUT!,
      JSON.stringify({ count: defs.length, total: hash(defs), tools: defs.map((d) => `${d.name}:${hash(d).slice(0, 16)}`) }, null, 1) + "\n",
    );
  });
});
