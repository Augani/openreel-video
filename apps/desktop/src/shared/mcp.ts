import os from "node:os";
import path from "node:path";

export interface McpEndpoint {
  readonly url: string;
  readonly port: number;
  readonly token: string;
}

/**
 * Stable, Electron-free location for the MCP endpoint descriptor the app writes
 * on launch and the stdio shim reads. Computed from the home dir so the main
 * process and the standalone shim agree without depending on Electron's
 * app.getPath. Overridable for tests / non-standard setups.
 */
export function endpointFilePath(): string {
  const override = process.env.OPENREEL_MCP_ENDPOINT_FILE;
  if (override && override.length > 0) return override;
  return path.join(os.homedir(), ".openreel", "mcp-endpoint.json");
}

export const MCP_PROTOCOL_PATH = "/mcp";

/**
 * Canonical MCP main↔renderer bridge contract. The desktop side (dispatcher,
 * preload, main) imports these; the web renderer (a separate package that can't
 * import apps/desktop) mirrors them in mcp-listener.ts / global.d.ts — keep the
 * two in sync.
 */
export interface McpBridgeRequest {
  callId: string;
  kind: "listTools" | "callTool";
  name?: string;
  args?: Record<string, unknown>;
}

export interface McpBridgeResponse {
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
