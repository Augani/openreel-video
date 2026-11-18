import { app, BrowserWindow } from "electron";
import { LATEST_PROTOCOL_VERSION } from "./core";
import { getEditorWindow } from "./editor-window";

/**
 * Highest MCP protocol version the server speaks, reported by get_app_state. Keep equal to the newest
 * entry of SUPPORTED_PROTOCOL_VERSIONS in core.ts.
 */
/** The newest MCP revision the server negotiates (single source of truth: core.ts). */
export const MCP_LATEST_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

export interface McpAppInfo {
  appVersion: string;
  platform: string;
  /** Open (not destroyed) BrowserWindows, hidden ones included. */
  windowCount: number;
  /** True when the editor window exists (visible or not). */
  editorWindow: boolean;
  protocolVersion: string;
}

export function getMcpAppInfo(): McpAppInfo {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    windowCount: windows.length,
    editorWindow: getEditorWindow() !== null,
    protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
  };
}
