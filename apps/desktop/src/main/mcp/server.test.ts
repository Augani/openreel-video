import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getVersion: () => "test", isPackaged: false },
  ipcMain: { on: () => undefined, removeListener: () => undefined },
}));

vi.mock("./renderer-bridge", () => ({
  installRendererBridge: () => ({
    listTools: async () => [{ name: "list_clips", description: "", inputSchema: { type: "object" } }],
    callTool: async () => ({ ok: true, summary: "ok" }),
  }),
  teardownRendererBridge: () => undefined,
}));

import { getMcpStatus, startMcpServer, stopMcpServer, testMcpConnection, rotateMcpToken } from "./server";
import { getMcpClientStatus, recordInitialize, resetClientTrackerForTests, CLIENT_ACTIVE_WINDOW_MS } from "./client-tracker";

describe("MCP server self-probe", () => {
  let dir: string;
  let clock = 1_000_000;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "openreel-mcp-"));
    process.env.OPENREEL_MCP_ENDPOINT_FILE = path.join(dir, "mcp-endpoint.json");
    clock = 1_000_000;
    resetClientTrackerForTests(() => clock);
    await startMcpServer();
  });

  afterEach(async () => {
    await stopMcpServer();
    delete process.env.OPENREEL_MCP_ENDPOINT_FILE;
    resetClientTrackerForTests();
  });

  it("testMcpConnection does not make a stale client look connected", async () => {
    recordInitialize({ name: "claude-code", version: "1" });
    clock += CLIENT_ACTIVE_WINDOW_MS + 1;
    expect(getMcpClientStatus().connected).toBe(false);
    const result = await testMcpConnection();
    expect(result.ok).toBe(true);
    expect(getMcpClientStatus().connected).toBe(false);
  });

  it("writes the endpoint file atomically (no temp files left, always valid JSON)", async () => {
    const file = process.env.OPENREEL_MCP_ENDPOINT_FILE!;
    for (let i = 0; i < 5; i++) {
      await rotateMcpToken();
      expect(JSON.parse(readFileSync(file, "utf8")).token).toBe(getMcpStatus().token);
    }
    expect(readdirSync(dir)).toEqual(["mcp-endpoint.json"]);
  });
});
