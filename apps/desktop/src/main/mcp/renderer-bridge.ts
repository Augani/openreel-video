import { ipcMain, type WebContents } from "electron";
import { CHANNELS } from "../../shared/channels";
import type { McpToolDef, McpToolResult, McpToolProvider } from "./core";
import {
  createDispatcher,
  McpBridgeError,
  type Dispatcher,
  type BridgeRequest,
  type BridgeResponse,
} from "./dispatcher";
import { ensureEditorWindow, getEditorWindow } from "./editor-window";

let bridge: Dispatcher | null = null;
let responseListener: ((event: unknown, response: BridgeResponse) => void) | null =
  null;
let readyListener: ((event: { sender: WebContents }) => void) | null = null;
/** The webContents whose renderer has installed its MCP listener; requests wait until then. */
let readyContents: WebContents | null = null;
/** Requests waiting for the editor renderer. Removed when they expire so a late call never runs. */
let queued: BridgeRequest[] = [];
/** Names of tools the registry flags `expensive`, learned from tools/list (never a hardcoded list). */
let expensiveTools: Set<string> | null = null;
/** In-flight prime of `expensiveTools`, shared by concurrent first calls. */
let priming: Promise<void> | null = null;

export const LONG_RUNNING_TIMEOUT_MS = 30 * 60_000;
export const STANDARD_CALL_TIMEOUT_MS = 120_000;
const LIST_TOOLS_TIMEOUT_MS = 30_000;
/** Longest a first tools/call waits for the expensive-flag prime before using the standard budget. */
export const PRIME_WAIT_MS = 3_000;

function rememberExpensive(tools: McpToolDef[]): void {
  expensiveTools = new Set(
    tools.filter((t) => t._meta?.["openreel/expensive"] === true).map((t) => t.name),
  );
}

/** Wires the dispatcher to the live editor window over IPC. Idempotent. */
export function installRendererBridge(): McpToolProvider {
  if (!bridge) {
    bridge = createDispatcher({
      onExpire: (callId) => {
        queued = queued.filter((r) => r.callId !== callId);
      },
      send: (request) => {
        // Prefer the tracked editor window; on macOS the app can be alive with none, so make a hidden one.
        const win = getEditorWindow() ?? ensureEditorWindow();
        if (!win) throw new McpBridgeError("NO_WINDOW", "No editor window is open and none could be created");
        // A page that has not installed its listener yet (window just created, renderer still
        // booting) would drop this message: hold it until the renderer announces readiness.
        if (readyContents !== win.webContents || win.webContents.isDestroyed()) {
          queued.push(request);
          return;
        }
        win.webContents.send(CHANNELS.mcpRequest, request);
      },
    });
    readyListener = (event) => {
      const win = getEditorWindow();
      if (!win || win.webContents !== event.sender) return;
      readyContents = event.sender;
      // A reload/navigation starts a new page with no listener: wait for its announcement again.
      const sender = event.sender;
      const onNavigate = (_navigation: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
        // Hash changes (welcome -> editor route) are same-document and keep the listener.
        if (isInPlace || !isMainFrame) return;
        sender.removeListener("did-start-navigation", onNavigate);
        if (readyContents === sender) readyContents = null;
      };
      sender.on("did-start-navigation", onNavigate);
      const pending = queued;
      queued = [];
      for (const request of pending) event.sender.send(CHANNELS.mcpRequest, request);
    };
    ipcMain.on(CHANNELS.mcpReady, readyListener as never);
    responseListener = (_event, response) => bridge?.handleResponse(response);
    ipcMain.on(CHANNELS.mcpResponse, responseListener);
  }

  /**
   * Picks the call budget from the `expensive` flag. When the cache is cold we prime it with one
   * shared listTools request (concurrent first calls reuse it). The caller waits at most
   * PRIME_WAIT_MS for it: that wait is extra latency that does NOT count against the call's own
   * budget (the budget starts when the real request is sent). If the prime is slower than that
   * (cold start, no window yet) the call proceeds with the standard budget and the prime keeps
   * running in the background to fill the cache for later calls.
   */
  const timeoutFor = async (name: string): Promise<number> => {
    if (expensiveTools === null) {
      if (!priming) {
        const current: Promise<void> = bridge!
          .request("listTools", {}, LIST_TOOLS_TIMEOUT_MS)
          .then((tools) => rememberExpensive((tools as McpToolDef[] | undefined) ?? []))
          .catch(() => undefined)
          .finally(() => {
            if (priming === current) priming = null;
          });
        priming = current;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        priming,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PRIME_WAIT_MS);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }
    return expensiveTools?.has(name) ? LONG_RUNNING_TIMEOUT_MS : STANDARD_CALL_TIMEOUT_MS;
  };

  return {
    async listTools(): Promise<McpToolDef[]> {
      const result = ((await bridge!.request("listTools", {}, LIST_TOOLS_TIMEOUT_MS)) as McpToolDef[] | undefined) ?? [];
      rememberExpensive(result);
      return result;
    },
    async callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<McpToolResult> {
      const timeoutMs = await timeoutFor(name);
      const result = await bridge!.request("callTool", { name, args }, timeoutMs);
      return result as McpToolResult;
    },
  };
}

/**
 * Tool calls for watch folders. They carry `origin: "watch-folders"` so the renderer runs them without
 * the agent confirmation gate (the folders are set up by the user in Settings).
 */
export function createWatchFolderToolCaller(): {
  hasEditor(): boolean;
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
} {
  installRendererBridge();
  return {
    hasEditor: () => getEditorWindow() !== null,
    async call(name, args) {
      const result = await bridge!.request("callTool", { name, args, origin: "watch-folders" }, LONG_RUNNING_TIMEOUT_MS);
      return result as McpToolResult;
    },
  };
}

/** Number of requests waiting for the renderer. Exposed for tests and diagnostics. */
export function queuedRequestCount(): number {
  return queued.length;
}

export function teardownRendererBridge(): void {
  if (responseListener) {
    ipcMain.removeListener(CHANNELS.mcpResponse, responseListener);
    responseListener = null;
  }
  if (readyListener) {
    ipcMain.removeListener(CHANNELS.mcpReady, readyListener as never);
    readyListener = null;
  }
  readyContents = null;
  queued = [];
  expensiveTools = null;
  priming = null;
  bridge?.rejectAll("MCP server shutting down");
  bridge = null;
}
