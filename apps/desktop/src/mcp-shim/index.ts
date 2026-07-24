#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { endpointFilePath, type McpEndpoint } from "../shared/mcp";

interface RpcMessage {
  id?: string | number | null;
  method?: string;
}

export type RpcPoster = (message: RpcMessage) => Promise<unknown>;

function readEndpoint(): McpEndpoint {
  const file = endpointFilePath();
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as Partial<McpEndpoint>;
  if (!parsed.url || !parsed.token) {
    throw new Error(`Invalid MCP endpoint file at ${file}`);
  }
  return { url: parsed.url, port: parsed.port ?? 0, token: parsed.token };
}

function postRpc(endpoint: McpEndpoint, message: RpcMessage): Promise<unknown> {
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
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
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

function main(): void {
  let endpoint: McpEndpoint;
  try {
    endpoint = readEndpoint();
  } catch (error) {
    process.stderr.write(
      `openreel-mcp: ${error instanceof Error ? error.message : String(error)}\n` +
        "Is the OpenReel desktop app running?\n",
    );
    process.exit(1);
  }

  const post: RpcPoster = (message) => postRpc(endpoint, message);
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
