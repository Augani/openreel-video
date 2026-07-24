import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { handleMcpMessage, type McpToolProvider, type ServerInfo, type JsonRpcMessage } from "./core";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

class BodyTooLargeError extends Error {}

export interface HttpServerOptions {
  /** Read live so a rotated token takes effect without restarting the server. */
  readonly getToken: () => string;
  readonly provider: McpToolProvider;
  readonly serverInfo: ServerInfo;
  readonly host?: string;
  readonly port?: number;
}

export interface RunningHttpServer {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function tokenMatches(provided: string | null, expected: string): boolean {
  if (provided === null || expected.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handleRpcPayload(
  raw: string,
  provider: McpToolProvider,
  serverInfo: ServerInfo,
): Promise<unknown> {
  const parsed = JSON.parse(raw) as JsonRpcMessage | JsonRpcMessage[];
  if (Array.isArray(parsed)) {
    const responses = await Promise.all(
      parsed.map((m) => handleMcpMessage(m, provider, serverInfo)),
    );
    return responses.filter((r) => r !== null);
  }
  return handleMcpMessage(parsed, provider, serverInfo);
}

export function startHttpServer(
  options: HttpServerOptions,
): Promise<RunningHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      if (!tokenMatches(bearerToken(req), options.getToken())) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = await readBody(req);
        if (!body) {
          sendJson(res, 400, { error: "Empty request body" });
          return;
        }
        const response = await handleRpcPayload(
          body,
          options.provider,
          options.serverInfo,
        );
        if (response === null || (Array.isArray(response) && response.length === 0)) {
          res.writeHead(202).end();
          return;
        }
        sendJson(res, 200, response);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          if (!res.headersSent) sendJson(res, 413, { error: "Request body too large" });
          return;
        }
        // SyntaxError = malformed JSON → JSON-RPC parse error; anything else is a
        // generic bad request.
        const isParse = error instanceof SyntaxError;
        const message = error instanceof Error ? error.message : "Bad request";
        sendJson(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: isParse ? -32700 : -32600, message },
        });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, host });
    });
  });
}
