import { describe, it, expect } from "vitest";
import {
  handleMcpMessage,
  type McpToolProvider,
  type ServerInfo,
} from "./core";

const SERVER_INFO: ServerInfo = { name: "openreel", version: "1.2.3" };

function provider(overrides: Partial<McpToolProvider> = {}): McpToolProvider {
  return {
    listTools: async () => [
      { name: "list_clips", description: "List clips", inputSchema: { type: "object" } },
    ],
    callTool: async () => ({ ok: true, summary: "done" }),
    ...overrides,
  };
}

describe("handleMcpMessage", () => {
  it("answers initialize with the requested protocol version and serverInfo", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      provider(),
      SERVER_INFO,
    );
    expect(res?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: SERVER_INFO,
      capabilities: { tools: {} },
    });
  });

  it("returns null for notifications (no id)", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      provider(),
      SERVER_INFO,
    );
    expect(res).toBeNull();
  });

  it("answers ping with an empty result", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "ping" },
      provider(),
      SERVER_INFO,
    );
    expect(res).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("lists tools from the provider", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      provider(),
      SERVER_INFO,
    );
    expect((res?.result as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it("calls a tool and wraps an ok result as text content", async () => {
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "add_text", arguments: { text: "hi" } },
      },
      provider({ callTool: async () => ({ ok: true, summary: "Added", data: { id: "c1" } }) }),
      SERVER_INFO,
    );
    const result = res?.result as { content: Array<{ text: string }>; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Added");
    expect(result.content[0].text).toContain("c1");
  });

  it("emits an MCP image content block alongside text when the result has an image", async () => {
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "render_motion_frame", arguments: { compositionId: "c1" } },
      },
      provider({
        callTool: async () => ({
          ok: true,
          summary: "Rendered frame",
          data: { width: 1920, height: 1080 },
          image: { dataUrl: "data:image/png;base64,SGVsbG8=", mimeType: "image/png" },
        }),
      }),
      SERVER_INFO,
    );
    const result = res?.result as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.content[0].type).toBe("text");
    const image = result.content.find((block) => block.type === "image");
    expect(image).toBeDefined();
    expect(image?.data).toBe("SGVsbG8=");
    expect(image?.data?.startsWith("data:")).toBe(false);
    expect(image?.mimeType).toBe("image/png");
  });

  it("marks a failed tool result as isError", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "x" } },
      provider({
        callTool: async () => ({
          ok: false,
          summary: "No project open",
          error: { code: "TOOL_ERROR", message: "No project is open" },
        }),
      }),
      SERVER_INFO,
    );
    const result = res?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("TOOL_ERROR");
  });

  it("rejects tools/call without a name", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: {} },
      provider(),
      SERVER_INFO,
    );
    expect(res?.error?.code).toBe(-32602);
  });

  it("returns method-not-found for unknown methods with an id", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 7, method: "resources/list" },
      provider(),
      SERVER_INFO,
    );
    expect(res?.error?.code).toBe(-32601);
  });

  it("converts provider throws into an internal error response", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 8, method: "tools/list" },
      provider({
        listTools: async () => {
          throw new Error("renderer gone");
        },
      }),
      SERVER_INFO,
    );
    expect(res?.error).toEqual({ code: -32603, message: "renderer gone" });
  });
});
