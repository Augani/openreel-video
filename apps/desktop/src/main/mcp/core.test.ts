import { describe, it, expect } from "vitest";
import {
  LATEST_PROTOCOL_VERSION,
  MCP_INSTRUCTIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
  handleMcpMessage,
  negotiateProtocolVersion,
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

describe("protocol negotiation", () => {
  it("supports the latest revision and echoes any supported one", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) expect(negotiateProtocolVersion(v)).toBe(v);
  });

  it("answers a newer-than-known client with our latest, not the oldest", () => {
    expect(negotiateProtocolVersion("2099-01-01")).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("answers an unknown revision between two known ones with the highest older supported one", () => {
    expect(negotiateProtocolVersion("2025-04-01")).toBe("2025-03-26");
  });

  it("falls back to the oldest for a malformed or ancient version", () => {
    expect(negotiateProtocolVersion("nonsense")).toBe("2024-11-05");
    expect(negotiateProtocolVersion("2020-01-01")).toBe("2024-11-05");
  });

  it("uses our latest when the client sends no version", () => {
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("initialize negotiates over the wire", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } },
      provider(),
      SERVER_INFO,
    );
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe("initialize instructions and client tracking", () => {
  it("returns the windowless workflow instructions", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, provider(), SERVER_INFO);
    const instructions = (res?.result as { instructions: string }).instructions;
    expect(instructions).toBe(MCP_INSTRUCTIONS);
    for (const word of [
      "get_app_state",
      "create_project",
      "open_project_file",
      "import_media_from_path",
      "get_export_options",
      "export_video",
      "outputPath",
      "get_render_status",
      "list_export_jobs",
      "CONFIRMATION_REQUIRED",
      "OUTSIDE_ALLOWED_ROOTS",
    ]) {
      expect(instructions).toContain(word);
    }
  });

  it("reports clientInfo to the onInitialize hook", async () => {
    const seen: unknown[] = [];
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.0" } },
      },
      provider(),
      SERVER_INFO,
      { onInitialize: (info) => seen.push(info) },
    );
    expect(seen).toEqual([{ name: "claude-code", version: "2.1.0", protocolVersion: "2025-06-18" }]);
  });

  it("still counts an initialize that carries no clientInfo", async () => {
    const seen: Array<{ name: string }> = [];
    await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, provider(), SERVER_INFO, {
      onInitialize: (info) => seen.push(info),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe("Unknown client");
  });
});

describe("tools/call result shape", () => {
  const call = async (result: Awaited<ReturnType<McpToolProvider["callTool"]>>) => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } },
      provider({ callTool: async () => result }),
      SERVER_INFO,
    );
    return res?.result as {
      isError: boolean;
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };
  };

  it("mirrors an object result.data as structuredContent next to the text block", async () => {
    const r = await call({ ok: true, summary: "Added", data: { id: "c1", n: 2 } });
    expect(r.structuredContent).toEqual({ id: "c1", n: 2 });
    expect(r.content[0].text).toContain("c1");
  });

  it("wraps array data so structuredContent stays a JSON object", async () => {
    const r = await call({ ok: true, summary: "Listed", data: [1, 2] });
    expect(r.structuredContent).toEqual({ result: [1, 2] });
  });

  it("omits structuredContent when there is no data", async () => {
    const r = await call({ ok: true, summary: "Done" });
    expect(r.structuredContent).toBeUndefined();
  });

  it("adds a default hint to coded errors and keeps isError", async () => {
    const r = await call({ ok: false, summary: "No project", error: { code: "NO_PROJECT", message: "No project is open" } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("create_project");
    expect(r.structuredContent).toMatchObject({ error: { code: "NO_PROJECT" } });
  });

  it("prefers a tool-supplied hint", async () => {
    const r = await call({ ok: false, summary: "x", error: { code: "NOT_FOUND", message: "m", hint: "use list_media" } });
    expect(r.content[0].text).toContain("use list_media");
  });
});

describe("errors as tool results", () => {
  const callThrowing = async (error: unknown) => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "x" } },
      provider({
        callTool: async () => {
          throw error;
        },
      }),
      SERVER_INFO,
    );
    return res;
  };

  it("turns a no-window failure into an isError result, not -32603", async () => {
    const res = await callThrowing(Object.assign(new Error("No editor window is open"), { code: "NO_WINDOW" }));
    expect(res?.error).toBeUndefined();
    const result = res?.result as { isError: boolean; content: Array<{ text: string }>; structuredContent: { error: { code: string } } };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("NO_WINDOW");
    expect(result.content[0].text).toContain("Hint:");
  });

  it("turns a timeout into an isError result", async () => {
    const res = await callThrowing(Object.assign(new Error("timed out after 120000ms"), { code: "TIMEOUT" }));
    expect((res?.result as { isError: boolean }).isError).toBe(true);
    expect(JSON.stringify(res?.result)).toContain("TIMEOUT");
  });

  it("maps an uncoded throw to INTERNAL_ERROR", async () => {
    const res = await callThrowing(new Error("renderer exploded"));
    expect(JSON.stringify(res?.result)).toContain("INTERNAL_ERROR");
    expect(res?.error).toBeUndefined();
  });
});
