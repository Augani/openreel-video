export interface McpToolDef {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export interface McpToolResultImage {
  readonly dataUrl: string;
  readonly mimeType?: string;
}

export interface McpToolResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly error?: { code: string; message: string; hint?: string };
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

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

/** Newest MCP revision this server implements (Streamable HTTP POST transport, tools, annotations, structuredContent). */
export const LATEST_PROTOCOL_VERSION = "2025-11-25";
/** Oldest revision still answered; used when a client sends no usable version. */
const OLDEST_PROTOCOL_VERSION = "2024-11-05";
/** Newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/**
 * Picks the highest revision both sides speak. A client advertises one version
 * (the newest it supports). If we implement it we echo it. If it is newer than
 * anything we know, we answer with our latest and the client decides whether to
 * continue. If it is older than anything we know, or malformed, we answer with
 * the oldest we still serve.
 */
export function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested !== "string") return LATEST_PROTOCOL_VERSION;
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  // MCP revisions are ISO dates, so lexical comparison orders them.
  if (/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    if (requested > LATEST_PROTOCOL_VERSION) return LATEST_PROTOCOL_VERSION;
    // Between two known revisions: the highest we support that is not newer.
    const lower = SUPPORTED_PROTOCOL_VERSIONS.find((v) => v < requested);
    if (lower) return lower;
  }
  return OLDEST_PROTOCOL_VERSION;
}

export const MCP_INSTRUCTIONS = [
  "OpenReel is a desktop video editor. You can drive it with no visible window; the app does not need to be open in front of the user.",
  "",
  "Typical workflow:",
  "1. Call get_app_state to see whether a project is open and which paths you may touch.",
  "2. Create a project with create_project, or open one with open_project_file.",
  "3. Bring media in with import_media_from_path (absolute file or folder paths).",
  "4. Edit with the typed tools. Call get_capabilities for valid enums and ranges. Prefer batch_actions for many small edits.",
  "5. Call get_export_options, then export_video with an outputPath.",
  "6. Exports are long running: poll get_render_status or list_export_jobs instead of waiting on one call.",
  "",
  "Confirmation policy: destructive or expensive tools (tool annotations destructiveHint, or _meta openreel/expensive) can be refused with CONFIRMATION_REQUIRED when the user turned off 'Allow agents to delete and export without asking' in Settings > MCP. Tell the user and stop; do not retry in a loop.",
  "",
  "File access: paths must be absolute and inside the allowed folders (Movies, Music, Pictures, Documents, Downloads, Desktop, the project folder, plus any the user added in Settings > MCP). Others fail with OUTSIDE_ALLOWED_ROOTS.",
  "",
  "Errors: failures come back as tool results with isError true and a code (NO_PROJECT, NO_WINDOW, NOT_FOUND, OUTSIDE_ALLOWED_ROOTS, UNSUPPORTED_TYPE, UNREADABLE, UNSUPPORTED, INVALID_PARAMS, TIMEOUT, CONFIRMATION_REQUIRED, TOOL_ERROR, UNAVAILABLE, RENDERER_ERROR, INTERNAL_ERROR) and a hint that names the fix.",
].join("\n");

/** Default fix suggestions per error code, used when a tool did not supply a `hint`. */
export const MCP_ERROR_HINTS: Readonly<Record<string, string>> = {
  NO_PROJECT: "Call create_project or open_project_file first, then retry.",
  NO_WINDOW: "OpenReel could not start its editor surface. Restart the OpenReel app and retry.",
  NOT_FOUND: "Check the id or path with a list_* tool or get_app_state, then retry.",
  OUTSIDE_ALLOWED_ROOTS: "Use a path inside the allowed folders (see get_app_state), or ask the user to add the folder in Settings > MCP.",
  UNSUPPORTED_TYPE: "Use a supported media type. See get_capabilities for accepted formats.",
  UNREADABLE: "The file exists but could not be read. Check permissions and that it is not open for writing elsewhere.",
  UNSUPPORTED: "Use get_export_options or get_capabilities to see valid alternatives.",
  INVALID_PARAMS: "Fix the arguments to match the tool's inputSchema and retry.",
  TIMEOUT: "The editor did not answer in time. Long jobs keep running: poll get_render_status or list_export_jobs, or retry once the editor is idle.",
  CONFIRMATION_REQUIRED: "Ask the user to enable 'Allow agents to delete and export without asking' in Settings > MCP.",
  TOOL_ERROR: "Check the arguments with get_capabilities and the project state with get_editor_state, then retry.",
  RENDERER_ERROR: "The editor reported an error while running the tool. Read the message, check the project state with get_editor_state, then retry once.",
  UNAVAILABLE: "OpenReel is shutting down or restarting. Wait a few seconds and retry.",
  INTERNAL_ERROR: "Retry once. If it persists, call get_app_state and restart OpenReel.",
};

function defaultHint(code: string): string | undefined {
  return MCP_ERROR_HINTS[code];
}

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

interface McpToolCallResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolResultContent(result: McpToolResult): McpToolCallResult {
  let text: string;
  if (result.ok) {
    text =
      result.data !== undefined
        ? `${result.summary}\n\n${JSON.stringify(result.data, null, 2)}`
        : result.summary;
  } else {
    const hint = result.error ? (result.error.hint ?? defaultHint(result.error.code)) : undefined;
    text = result.error
      ? `${result.summary} (${result.error.code}: ${result.error.message})${hint ? `\nHint: ${hint}` : ""}`
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
  const out: McpToolCallResult = { content, isError: !result.ok };
  if (result.ok) {
    // structuredContent must be a JSON object; wrap arrays and scalars so the field is always valid.
    if (result.data !== undefined) {
      out.structuredContent = isPlainObject(result.data) ? result.data : { result: result.data };
    }
  } else if (result.error) {
    const hint = result.error.hint ?? defaultHint(result.error.code);
    out.structuredContent = {
      error: {
        code: result.error.code,
        message: result.error.message,
        ...(hint ? { hint } : {}),
      },
    };
  }
  return out;
}

/** Converts a thrown bridge failure (no window, timeout, shutdown) into a tool-level error result. */
function thrownToToolResult(error: unknown): McpToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const rawCode = isPlainObject(error) || error instanceof Error ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]*$/.test(rawCode) ? rawCode : "INTERNAL_ERROR";
  return { ok: false, summary: message, error: { code, message } };
}

export interface McpMessageHooks {
  /** Called for every `initialize` with the client's self-reported identity. */
  readonly onInitialize?: (info: { name: string; version?: string; protocolVersion: string }) => void;
}

/**
 * Handles a single MCP JSON-RPC message against a tool provider. Returns the
 * JSON-RPC response, or null for notifications (which take no reply).
 */
export async function handleMcpMessage(
  message: JsonRpcMessage,
  provider: McpToolProvider,
  serverInfo: ServerInfo,
  hooks: McpMessageHooks = {},
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
        const protocolVersion = negotiateProtocolVersion(message.params?.protocolVersion);
        const clientInfo = message.params?.clientInfo;
        if (isPlainObject(clientInfo) && typeof clientInfo.name === "string" && clientInfo.name) {
          hooks.onInitialize?.({
            name: clientInfo.name.slice(0, 120),
            version: typeof clientInfo.version === "string" ? clientInfo.version.slice(0, 60) : undefined,
            protocolVersion,
          });
        } else {
          hooks.onInitialize?.({ name: "Unknown client", protocolVersion });
        }
        return reply({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions: MCP_INSTRUCTIONS,
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
        let result: McpToolResult;
        try {
          result = await provider.callTool(name, args);
        } catch (error) {
          // No window, timeout, shutdown: the model can act on a tool error, but not on a protocol error.
          result = thrownToToolResult(error);
        }
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
