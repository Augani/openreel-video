import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_ERROR_HINTS, MCP_INSTRUCTIONS, SUPPORTED_PROTOCOL_VERSIONS } from "./core";
import { NOT_RUNNING_MESSAGE } from "../../mcp-shim/index";

const doc = readFileSync(path.resolve(__dirname, "../../../../../docs/MCP-SETUP.md"), "utf8");
const FIX = "docs/MCP-SETUP.md is out of date with the server. Update it (docs/ is gitignored: use `git add -f`).";

describe("docs/MCP-SETUP.md drift", () => {
  it("names every protocol revision the server speaks", () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(doc.includes(version), `${FIX} Missing protocol ${version}.`).toBe(true);
    }
  });

  it("documents every client-facing error code", () => {
    for (const code of Object.keys(MCP_ERROR_HINTS)) {
      expect(doc.includes(`\`${code}\``), `${FIX} Missing error code ${code}.`).toBe(true);
    }
  });

  it("quotes the shim's not-running message and the --doctor flag", () => {
    expect(doc.includes(NOT_RUNNING_MESSAGE)).toBe(true);
    expect(doc.includes("--doctor")).toBe(true);
  });

  it("keeps the instructions error list and the hint table in step", () => {
    const named = MCP_INSTRUCTIONS.match(/\b[A-Z]+(?:_[A-Z]+)+\b/g) ?? [];
    for (const code of new Set(named)) {
      if (code === "OUTSIDE_ALLOWED_ROOTS" || MCP_ERROR_HINTS[code]) continue;
      expect.fail(`Instructions name ${code} but it has no default hint.`);
    }
    for (const code of Object.keys(MCP_ERROR_HINTS)) {
      expect(MCP_INSTRUCTIONS.includes(code), `Instructions do not list ${code}.`).toBe(true);
    }
  });
});
