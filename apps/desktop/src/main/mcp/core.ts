export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpToolResultImage {
  readonly dataUrl: string;
  readonly mimeType?: string;
}

export interface McpToolResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly error?: { code: string; message: string };
  readonly image?: McpToolResultImage;
}

export interface McpToolProvider {
  listTools(): Promise<McpToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
]);

function isNotification(msg: JsonRpcMessage): boolean {
  return msg.id === undefined || msg.id === null;
}

type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const MCP_DATA_URL_PREFIX = /^data:([^;,]+)?(?:;[^,]*)?,/;

function stripMcpDataUrlPrefix(dataUrl: string): {
  data: string;
  mimeType: string;
} {
  const match = MCP_DATA_URL_PREFIX.exec(dataUrl);
  if (match) {
    return {
      data: dataUrl.slice(match[0].length),
      mimeType: match[1] || "image/png",
    };
  }
  return { data: dataUrl, mimeType: "image/png" };
}

function toolResultContent(result: McpToolResult): {
  content: McpContentBlock[];
  isError: boolean;
} {
  let text: string;
  if (result.ok) {
    text =
      result.data !== undefined
        ? `${result.summary}\n\n${JSON.stringify(result.data, null, 2)}`
        : result.summary;
  } else {
    text = result.error
      ? `${result.summary} (${result.error.code}: ${result.error.message})`
      : result.summary;
  }
  const content: McpContentBlock[] = [{ type: "text", text }];
  if (result.image) {
    const { data, mimeType } = stripMcpDataUrlPrefix(result.image.dataUrl);
    content.push({
      type: "image",
      data,
      mimeType: result.image.mimeType ?? mimeType,
    });
  }
  return { content, isError: !result.ok };
}

/**
 * Handles a single MCP JSON-RPC message against a tool provider. Returns the
 * JSON-RPC response, or null for notifications (which take no reply).
 */
export async function handleMcpMessage(
  message: JsonRpcMessage,
  provider: McpToolProvider,
  serverInfo: ServerInfo,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const reply = (result: unknown): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    result,
  });
  const fail = (code: number, msg: string): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    error: { code, message: msg },
  });

  try {
    switch (message.method) {
      case "initialize": {
        const requested = message.params?.protocolVersion;
        // Echo the client's version only if we support it; otherwise negotiate
        // down to our default rather than blindly reflecting an unknown string.
        const protocolVersion =
          typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
            ? requested
            : DEFAULT_PROTOCOL_VERSION;
        return reply({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
        });
      }
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;
      case "ping":
        return reply({});
      case "tools/list": {
        const tools = await provider.listTools();
        return reply({ tools });
      }
      case "tools/call": {
        const name = message.params?.name;
        if (typeof name !== "string" || name.length === 0) {
          return fail(-32602, "Invalid params: missing tool name");
        }
        const rawArgs = message.params?.arguments;
        const args =
          rawArgs && typeof rawArgs === "object"
            ? (rawArgs as Record<string, unknown>)
            : {};
        const result = await provider.callTool(name, args);
        return reply(toolResultContent(result));
      }
      default:
        if (isNotification(message)) return null;
        return fail(-32601, `Method not found: ${message.method ?? "(none)"}`);
    }
  } catch (error) {
    if (isNotification(message)) return null;
    const msg = error instanceof Error ? error.message : "Internal error";
    return fail(-32603, msg);
  }
}
