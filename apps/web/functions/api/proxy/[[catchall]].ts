/**
 * Cloudflare Pages Function: API proxy for third-party services.
 *
 * Routes requests from the browser to ElevenLabs, OpenAI, and Anthropic
 * so that API keys never leave the same origin in production.
 *
 * URL pattern: /api/proxy/<service>/<path>
 *   e.g. POST /api/proxy/elevenlabs/text-to-speech/abc123
 *        POST /api/proxy/openai/chat/completions
 *        POST /api/proxy/anthropic/messages
 *
 * The API key is passed via the `x-proxy-api-key` header and translated
 * to the correct service-specific header before forwarding.
 */

interface ServiceConfig {
  baseUrl: string;
  allowedPaths: RegExp;
  authHeaders: (key: string) => Record<string, string>;
}

const SERVICE_CONFIG: Record<string, ServiceConfig> = {
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io/v1",
    allowedPaths: /^(voices|models|text-to-speech\/[\w-]+)$/,
    authHeaders: (key) => ({ "xi-api-key": key }),
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    allowedPaths: /^(chat\/completions|models)$/,
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    allowedPaths: /^(messages)$/,
    authHeaders: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  },
};

const ALLOWED_ORIGINS = [
  "https://openreel.pages.dev",
  "https://openreel-preview.pages.dev",
  "http://localhost:5173",
  "http://localhost:4173",
];

const MAX_REQUEST_BODY_BYTES = 1_048_576; // 1 MB
const UPSTREAM_TIMEOUT_MS = 25_000;

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-proxy-api-key",
    Vary: "Origin",
  };
}

function jsonError(
  message: string,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export const onRequest: PagesFunction = async (context) => {
  const corsHeaders = getCorsHeaders(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const pathParts = context.params.catchall as string[];
  if (!pathParts || pathParts.length < 1) {
    return jsonError("Missing service in URL path", 400, corsHeaders);
  }

  const service = pathParts[0];
  const remainingPath = pathParts.slice(1).join("/");

  if (remainingPath.includes("..") || remainingPath.includes("//")) {
    return jsonError("Invalid path", 400, corsHeaders);
  }

  const config = SERVICE_CONFIG[service];
  if (!config) {
    return jsonError(`Unknown service: ${service}`, 400, corsHeaders);
  }

  if (remainingPath && !config.allowedPaths.test(remainingPath)) {
    return jsonError("Path not allowed for this service", 403, corsHeaders);
  }

  const apiKey = context.request.headers.get("x-proxy-api-key");
  if (!apiKey) {
    return jsonError("Missing x-proxy-api-key header", 401, corsHeaders);
  }

  if (
    context.request.method === "POST" &&
    context.request.headers.has("Content-Length")
  ) {
    const contentLength = parseInt(
      context.request.headers.get("Content-Length") ?? "0",
      10,
    );
    if (contentLength > MAX_REQUEST_BODY_BYTES) {
      return jsonError("Request body too large", 413, corsHeaders);
    }
  }

  const originalUrl = new URL(context.request.url);
  const targetUrl = remainingPath
    ? `${config.baseUrl}/${remainingPath}${originalUrl.search}`
    : `${config.baseUrl}${originalUrl.search}`;

  const upstreamHeaders = new Headers();
  const contentType = context.request.headers.get("Content-Type");
  if (contentType) {
    upstreamHeaders.set("Content-Type", contentType);
  }
  for (const [key, value] of Object.entries(config.authHeaders(apiKey))) {
    upstreamHeaders.set(key, value);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method: context.request.method,
      headers: upstreamHeaders,
      body: context.request.method !== "GET" ? context.request.body : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "Upstream request timed out"
        : "Failed to reach upstream service";
    return jsonError(message, 502, corsHeaders);
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    responseHeaders.set(key, value);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
};
