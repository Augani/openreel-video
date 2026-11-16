#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { endpointFilePath, MCP_PROBE_HEADER, type McpEndpoint } from "../shared/mcp";

interface RpcMessage {
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcPoster = (message: RpcMessage) => Promise<unknown>;

export const NOT_RUNNING_MESSAGE = "OpenReel isn't running. Start the app and retry.";

/** Carries the HTTP status so the retry layer can tell a stale token from a real failure. */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
    this.name = "HttpStatusError";
  }
}

/** Thrown when the endpoint file is missing, so callers can show the "not running" message. */
export class EndpointMissingError extends Error {
  constructor() {
    super(NOT_RUNNING_MESSAGE);
    this.name = "EndpointMissingError";
  }
}

/** The endpoint file exists but is empty or partial (it is being rewritten). Worth one retry. */
export class EndpointUnreadableError extends Error {
  constructor(file: string) {
    super(`Invalid MCP endpoint file at ${file}`);
    this.name = "EndpointUnreadableError";
  }
}

export function readEndpoint(): McpEndpoint {
  const file = endpointFilePath();
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EndpointMissingError();
    throw error;
  }
  let parsed: Partial<McpEndpoint>;
  try {
    parsed = JSON.parse(raw) as Partial<McpEndpoint>;
  } catch {
    throw new EndpointUnreadableError(file);
  }
  if (!parsed.url || !parsed.token) {
    throw new EndpointUnreadableError(file);
  }
  return { url: parsed.url, port: parsed.port ?? 0, token: parsed.token };
}

export function postRpc(
  endpoint: McpEndpoint,
  message: RpcMessage,
  options: { probe?: boolean } = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.url);
    const body = JSON.stringify(message);
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${endpoint.token}`,
          ...(options.probe ? { [MCP_PROBE_HEADER]: "1" } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode === 202 || text.length === 0) {
            resolve(null);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new HttpStatusError(res.statusCode, text));
            return;
          }
          try {
            resolve(JSON.parse(text));
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

function isStaleEndpointError(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status === 401;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ECONNREFUSED";
}

function sameEndpoint(a: McpEndpoint, b: McpEndpoint): boolean {
  return a.url === b.url && a.token === b.token;
}

export interface RetryingPosterDeps {
  readonly readEndpoint: () => McpEndpoint;
  readonly post: (endpoint: McpEndpoint, message: RpcMessage) => Promise<unknown>;
  /** Pause before retrying against an unchanged endpoint (the app may still be starting). */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly retryDelayMs?: number;
}

/**
 * Builds a poster that caches the endpoint and re-reads the file after a failure, so a rotated token
 * or an app relaunch (new port, new token) is picked up without restarting the client. On
 * ECONNREFUSED or HTTP 401 it re-reads the file once and retries once; a partial file (mid-rewrite)
 * is re-read once too. A missing file means the app is not running.
 */
export function createRetryingPoster(deps: RetryingPosterDeps): RpcPoster {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = deps.retryDelayMs ?? 400;
  let cached: McpEndpoint | null = null;
  return async (message) => {
    const readOnce = async (): Promise<McpEndpoint> => {
      try {
        return deps.readEndpoint();
      } catch (error) {
        // A half-written file (rotation racing this request): wait briefly and read once more.
        if (!(error instanceof EndpointUnreadableError)) throw error;
        await sleep(Math.min(delay, 150));
        return deps.readEndpoint();
      }
    };
    const first = cached ?? (await readOnce());
    cached = first;
    try {
      return await deps.post(first, message);
    } catch (error) {
      if (!isStaleEndpointError(error)) throw error;
      // Re-read: the token may have rotated or the app relaunched on a new port.
      cached = null;
      const fresh = await readOnce();
      if (sameEndpoint(first, fresh)) await sleep(delay);
      cached = fresh;
      try {
        return await deps.post(fresh, message);
      } catch (retryError) {
        if (isStaleEndpointError(retryError)) {
          cached = null;
          const detail = retryError instanceof Error ? retryError.message : String(retryError);
          throw new Error(
            `${NOT_RUNNING_MESSAGE} Could not reach the OpenReel server at ${fresh.url} (${detail}).`,
          );
        }
        throw retryError;
      }
    }
  };
}

/**
 * Forwards one newline-delimited JSON-RPC line to the upstream poster and
 * returns the response line to emit (or null for notifications / blank lines).
 * Pure relative to `post` so it is unit-testable.
 */
export async function forwardLine(
  line: string,
  post: RpcPoster,
): Promise<string | null> {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let message: RpcMessage;
  try {
    message = JSON.parse(trimmed) as RpcMessage;
  } catch {
    return null;
  }
  const isNotification = message.id === undefined || message.id === null;
  try {
    const response = await post(message);
    if (response === null || response === undefined) return null;
    return JSON.stringify(response);
  } catch (error) {
    if (isNotification) return null;
    return JSON.stringify({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly lines: string[];
}

export interface DoctorDeps {
  readonly endpointFile: string;
  readonly readEndpoint: () => McpEndpoint;
  readonly post: (endpoint: McpEndpoint, message: RpcMessage) => Promise<unknown>;
  readonly nodeVersion: string;
}

/** Checks each link of the chain a client depends on and says which one is broken. */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const lines: string[] = [];
  const pass = (text: string): void => void lines.push(`ok    ${text}`);
  const fail = (text: string, fix: string): DoctorReport => {
    lines.push(`FAIL  ${text}`, `      Fix: ${fix}`);
    return { ok: false, lines };
  };

  const major = Number(deps.nodeVersion.replace(/^v/, "").split(".")[0]);
  if (Number.isFinite(major) && major < 18) {
    return fail(`Node ${deps.nodeVersion} is too old`, "Install Node 18 or newer.");
  }
  pass(`Node ${deps.nodeVersion}`);

  let endpoint: McpEndpoint;
  try {
    endpoint = deps.readEndpoint();
  } catch (error) {
    if (error instanceof EndpointMissingError) {
      return fail(`No endpoint file at ${deps.endpointFile}`, "Start the OpenReel desktop app, then run --doctor again.");
    }
    return fail(
      `Endpoint file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "Quit and relaunch OpenReel to rewrite it.",
    );
  }
  pass(`Endpoint file ${deps.endpointFile}`);
  pass(`Server address ${endpoint.url}`);

  try {
    const response = (await deps.post(endpoint, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "openreel-mcp-doctor", version: "1" },
      },
    })) as { result?: { protocolVersion?: string; serverInfo?: { version?: string } } } | null;
    const result = response?.result;
    if (!result) return fail("Server answered initialize with no result", "Relaunch OpenReel.");
    pass(`initialize OK (protocol ${result.protocolVersion ?? "?"}, app ${result.serverInfo?.version ?? "?"})`);
  } catch (error) {
    if (error instanceof HttpStatusError && error.status === 401) {
      return fail("Server rejected the token (HTTP 401)", "Relaunch OpenReel, or rotate the token in Settings > MCP.");
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED") {
      return fail(
        `Nothing is listening at ${endpoint.url}`,
        "The endpoint file is stale. Start OpenReel (it rewrites the file on launch).",
      );
    }
    return fail(`Could not reach the server: ${error instanceof Error ? error.message : String(error)}`, "Relaunch OpenReel.");
  }

  try {
    const response = (await deps.post(endpoint, { id: 2, method: "tools/list" })) as {
      result?: { tools?: unknown[] };
      error?: { message?: string };
    } | null;
    if (response?.error) {
      return fail(
        `tools/list failed: ${response.error.message ?? "unknown error"}`,
        "The editor window may still be starting. Wait a few seconds and run --doctor again.",
      );
    }
    pass(`tools/list OK (${response?.result?.tools?.length ?? 0} tools)`);
  } catch (error) {
    return fail(
      `tools/list failed: ${error instanceof Error ? error.message : String(error)}`,
      "Wait for OpenReel to finish starting, then run --doctor again.",
    );
  }
  return { ok: true, lines };
}

function main(): void {
  if (process.argv.includes("--doctor")) {
    void runDoctor({
      endpointFile: endpointFilePath(),
      readEndpoint,
      post: (endpoint, message) => postRpc(endpoint, message, { probe: true }),
      nodeVersion: process.version,
    }).then((report) => {
      process.stdout.write(`${report.lines.join("\n")}\n`);
      process.stdout.write(report.ok ? "\nEverything looks good.\n" : "\nOpenReel MCP is not ready.\n");
      process.exit(report.ok ? 0 : 1);
    });
    return;
  }

  // The endpoint is read per request, so the shim can start before the app does and survive
  // token rotation or an app restart. A missing file becomes a clear error on the first call.
  const post = createRetryingPoster({ readEndpoint, post: postRpc });
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    void forwardLine(line, post)
      .then((out) => {
        if (out !== null) process.stdout.write(`${out}\n`);
      })
      .catch((error) => {
        process.stderr.write(
          `openreel-mcp: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
  });
  rl.on("close", () => process.exit(0));
}

if (require.main === module) {
  main();
}
