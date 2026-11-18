import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "../src/main/mcp/core";

const dir = path.resolve(__dirname, "../src/main/mcp");

describe("get_app_state protocol version", () => {
  it("reports the newest version the server negotiates", () => {
    expect([...SUPPORTED_PROTOCOL_VERSIONS].sort().at(-1)).toBe(LATEST_PROTOCOL_VERSION);
    const info = fs.readFileSync(path.join(dir, "app-info.ts"), "utf8");
    // app-info must take the version from core.ts, not keep its own copy that can drift.
    expect(info).toMatch(/MCP_LATEST_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;/);
    expect(info).not.toMatch(/MCP_LATEST_PROTOCOL_VERSION = "\d{4}/);
  });
});
