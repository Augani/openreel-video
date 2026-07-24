import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startHttpServer, type RunningHttpServer } from "./http-server";
import type { McpToolProvider } from "./core";

const TOKEN = "secret-token";

const provider: McpToolProvider = {
  listTools: async () => [
    { name: "list_clips", description: "List clips", inputSchema: { type: "object" } },
  ],
  callTool: async (name) => ({ ok: true, summary: `called ${name}` }),
};

let running: RunningHttpServer;
let base: string;
let currentToken = TOKEN;

async function rpc(body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(base, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeAll(async () => {
  currentToken = TOKEN;
  running = await startHttpServer({
    getToken: () => currentToken,
    provider,
    serverInfo: { name: "openreel", version: "test" },
    port: 0,
  });
  base = `http://127.0.0.1:${running.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => running.server.close(() => resolve()));
});

describe("MCP HTTP server", () => {
  it("rejects requests without a token (401)", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong token (401)", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "wrong");
    expect(res.status).toBe(401);
  });

  it("rejects non-POST methods (405)", async () => {
    const res = await fetch(base, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(405);
  });

  it("returns tools for an authorized tools/list", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, TOKEN);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { tools: unknown[] } };
    expect(json.result.tools).toHaveLength(1);
  });

  it("executes an authorized tools/call", async () => {
    const res = await rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_clips" } },
      TOKEN,
    );
    const json = (await res.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(json.result.isError).toBe(false);
    expect(json.result.content[0].text).toContain("called list_clips");
  });

  it("returns 202 with no body for a notification", async () => {
    const res = await rpc(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      TOKEN,
    );
    expect(res.status).toBe(202);
  });

  it("honors a rotated token: old token 401s, new token 200s", async () => {
    currentToken = "rotated-token";
    try {
      const oldRes = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/list" }, TOKEN);
      expect(oldRes.status).toBe(401);
      const newRes = await rpc(
        { jsonrpc: "2.0", id: 10, method: "tools/list" },
        "rotated-token",
      );
      expect(newRes.status).toBe(200);
    } finally {
      currentToken = TOKEN;
    }
  });

  it("rejects an empty body with 400", async () => {
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(400);
  });

  it("returns -32700 for malformed JSON", async () => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: number } };
    expect(json.error.code).toBe(-32700);
  });

  it("handles a JSON-RPC batch, dropping notification replies", async () => {
    const res = await rpc(
      [
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ],
      TOKEN,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ id: number }>;
    expect(Array.isArray(json)).toBe(true);
    expect(json.map((r) => r.id).sort()).toEqual([1, 2]);
  });
});
