import { BrowserWindow, ipcMain } from "electron";
import { CHANNELS } from "../../shared/channels";
import type { McpToolDef, McpToolResult, McpToolProvider } from "./core";
import {
  createDispatcher,
  type Dispatcher,
  type BridgeResponse,
} from "./dispatcher";

let bridge: Dispatcher | null = null;
let responseListener: ((event: unknown, response: BridgeResponse) => void) | null =
  null;

/**
 * Tools that render/encode/upload or run a remote job legitimately take far
 * longer than a normal editing call. They get a generous timeout so long
 * exports aren't killed by the default bridge limit.
 */
const LONG_RUNNING_TOOLS = new Set<string>([
  "export_video",
  "export_audio",
  "render_motion_frame",
  "render_creation_preview",
  "transcribe",
  "detect_highlights",
  "remove_background",
  "upscale",
  "generate_music",
  "inpaint",
  "sync_motion_to_audio",
]);
const LONG_RUNNING_TIMEOUT_MS = 30 * 60_000;
const STANDARD_CALL_TIMEOUT_MS = 120_000;

function targetWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  return win ?? null;
}

/** Wires the dispatcher to the live editor window over IPC. Idempotent. */
export function installRendererBridge(): McpToolProvider {
  if (!bridge) {
    bridge = createDispatcher({
      send: (request) => {
        const win = targetWindow();
        if (!win) throw new Error("No editor window is open");
        win.webContents.send(CHANNELS.mcpRequest, request);
      },
    });
    responseListener = (_event, response) => bridge?.handleResponse(response);
    ipcMain.on(CHANNELS.mcpResponse, responseListener);
  }

  return {
    async listTools(): Promise<McpToolDef[]> {
      const result = await bridge!.request("listTools", {}, 10_000);
      return (result as McpToolDef[]) ?? [];
    },
    async callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<McpToolResult> {
      const timeoutMs = LONG_RUNNING_TOOLS.has(name)
        ? LONG_RUNNING_TIMEOUT_MS
        : STANDARD_CALL_TIMEOUT_MS;
      const result = await bridge!.request("callTool", { name, args }, timeoutMs);
      return result as McpToolResult;
    },
  };
}

export function teardownRendererBridge(): void {
  if (responseListener) {
    ipcMain.removeListener(CHANNELS.mcpResponse, responseListener);
    responseListener = null;
  }
  bridge?.rejectAll("MCP server shutting down");
  bridge = null;
}
