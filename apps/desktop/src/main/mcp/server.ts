import { app } from "electron";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { startHttpServer, type RunningHttpServer } from "./http-server";
import { installRendererBridge, teardownRendererBridge } from "./renderer-bridge";
import type { McpToolProvider, ServerInfo } from "./core";
import { endpointFilePath, MCP_PROTOCOL_PATH, type McpEndpoint } from "../../shared/mcp";

export interface McpStatus {
  readonly running: boolean;
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly shimPath: string;
  readonly endpointFile: string;
}

interface McpState {
  running: RunningHttpServer;
  // Mutable holder so rotateMcpToken takes effect on the running server, which
  // reads the token live via getToken().
  tokenHolder: { value: string };
  provider: McpToolProvider;
}

let state: McpState | null = null;

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function serverInfo(): ServerInfo {
  return {
    name: "openreel",
    version: app.getVersion(),
  };
}

function shimPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "mcp-shim", "index.js")
    : path.join(__dirname, "../mcp-shim/index.js");
}

function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_PROTOCOL_PATH}`;
}

function writeEndpointFile(endpoint: McpEndpoint): void {
  const file = endpointFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(endpoint, null, 2), { mode: 0o600 });
  // mode in writeFileSync only applies on create; enforce 0600 if it pre-existed.
  try {
    chmodSync(file, 0o600);
  } catch {
    // best-effort
  }
}

function removeEndpointFile(): void {
  try {
    rmSync(endpointFilePath(), { force: true });
  } catch {
    // best-effort cleanup
  }
}

export async function startMcpServer(): Promise<void> {
  if (state) return;
  const tokenHolder = { value: generateToken() };
  const provider = installRendererBridge();
  const running = await startHttpServer({
    getToken: () => tokenHolder.value,
    provider,
    serverInfo: serverInfo(),
    port: Number(process.env.OPENREEL_MCP_PORT ?? 0),
  });
  state = { running, tokenHolder, provider };
  writeEndpointFile({
    url: endpointUrl(running.port),
    port: running.port,
    token: tokenHolder.value,
  });
}

export async function stopMcpServer(): Promise<void> {
  const current = state;
  state = null;
  teardownRendererBridge();
  removeEndpointFile();
  if (current) {
    await new Promise<void>((resolve) => current.running.server.close(() => resolve()));
  }
}

export function getMcpStatus(): McpStatus {
  return {
    running: state !== null,
    url: state ? endpointUrl(state.running.port) : "",
    port: state ? state.running.port : 0,
    token: state ? state.tokenHolder.value : "",
    shimPath: shimPath(),
    endpointFile: endpointFilePath(),
  };
}

export async function rotateMcpToken(): Promise<McpStatus> {
  if (!state) return getMcpStatus();
  state.tokenHolder.value = generateToken();
  writeEndpointFile({
    url: endpointUrl(state.running.port),
    port: state.running.port,
    token: state.tokenHolder.value,
  });
  return getMcpStatus();
}

function loopbackRpc(
  port: number,
  token: string,
  message: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(message);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: MCP_PROTOCOL_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

export async function testMcpConnection(): Promise<{
  ok: boolean;
  message?: string;
  toolCount?: number;
}> {
  if (!state) return { ok: false, message: "MCP server is not running" };
  try {
    const response = (await loopbackRpc(state.running.port, state.tokenHolder.value, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    })) as { result?: { tools?: unknown[] }; error?: { message: string } } | null;
    if (response?.error) return { ok: false, message: response.error.message };
    const toolCount = response?.result?.tools?.length ?? 0;
    return { ok: true, toolCount };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
