import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** Shared pieces of the MCP Electron e2e suites (real Electron through Playwright `_electron`). */
export const desktopDir = path.resolve(__dirname, "..");
export const repoRoot = path.resolve(desktopDir, "../..");
export const builtMain = path.join(desktopDir, "dist/main/index.js");
export const builtShim = path.join(desktopDir, "dist/mcp-shim/index.js");
export const builtRenderer = path.join(repoRoot, "apps/web/dist/index.html");

export interface ElectronPage {
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
}

export interface ElectronApp {
  evaluate<T>(
    fn: (modules: {
      BrowserWindow: { getAllWindows(): Array<{ isDestroyed(): boolean; isVisible(): boolean; destroy(): void }> };
    }) => T,
  ): Promise<T>;
  firstWindow(): Promise<ElectronPage>;
  close(): Promise<void>;
}

export function loadPlaywright(): { _electron: { launch(options: Record<string, unknown>): Promise<ElectronApp> } } {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const dir = fs.readdirSync(pnpmDir).find((entry) => entry.startsWith("playwright@"));
  if (!dir) throw new Error("playwright is not installed in the workspace");
  return require(path.join(pnpmDir, dir, "node_modules/playwright"));
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Endpoint {
  url: string;
  token: string;
  port: number;
}

export function readEndpointFile(file: string): Endpoint | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Endpoint;
  } catch {
    return null;
  }
}

export async function waitForEndpoint(file: string, timeoutMs = 30_000, notToken?: string): Promise<Endpoint> {
  const start = Date.now();
  for (;;) {
    const endpoint = readEndpointFile(file);
    if (endpoint && endpoint.token !== notToken) return endpoint;
    if (Date.now() - start > timeoutMs) throw new Error(`MCP endpoint file did not appear: ${file}`);
    await sleep(25);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export async function rpc(endpoint: { url: string; token: string }, body: unknown): Promise<{ status: number; json: Json }> {
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

export function launchApp(work: string, endpointFile: string, extraEnv: Record<string, string> = {}): Promise<ElectronApp> {
  const { _electron } = loadPlaywright();
  return _electron.launch({
    args: [desktopDir, `--user-data-dir=${path.join(work, "ud")}`],
    env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile, ...extraEnv },
    timeout: 90_000,
  });
}

/** A running stdio shim: write JSON-RPC lines, read the next response line. */
export interface ShimProcess {
  request(message: Record<string, unknown>, timeoutMs?: number): Promise<Json>;
  kill(): void;
}

export function spawnShim(endpointFile: string): ShimProcess {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [builtShim], {
    env: { ...process.env, OPENREEL_MCP_ENDPOINT_FILE: endpointFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map<string | number, (value: Json) => void>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line) as { id?: string | number };
      if (message.id !== undefined) waiting.get(message.id)?.(message);
    }
  });
  let nextId = 1000;
  return {
    request(message, timeoutMs = 60_000) {
      const id = nextId++;
      return new Promise<Json>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`shim did not answer ${String(message.method)} within ${timeoutMs}ms`));
        }, timeoutMs);
        waiting.set(id, (value) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(value);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...message })}\n`);
      });
    },
    kill() {
      child.kill();
    },
  };
}
