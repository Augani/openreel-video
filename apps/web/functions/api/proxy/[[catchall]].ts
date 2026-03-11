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
  authHeaders: (key: string) => Record<string, string>;
}

const SERVICE_CONFIG: Record<string, ServiceConfig> = {
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io/v1",
    authHeaders: (key) => ({ "xi-api-key": key }),
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    authHeaders: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  },
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-proxy-api-key",
};

export const onRequest: PagesFunction = async (context) => {
  // Handle CORS preflight
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const pathParts = context.params.catchall as string[];
  if (!pathParts || pathParts.length < 1) {
    return new Response(JSON.stringify({ error: "Missing service in URL path" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const service = pathParts[0];
  const remainingPath = pathParts.slice(1).join("/");

  const config = SERVICE_CONFIG[service];
  if (!config) {
    return new Response(JSON.stringify({ error: `Unknown service: ${service}` }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const apiKey = context.request.headers.get("x-proxy-api-key");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing x-proxy-api-key header" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const targetUrl = remainingPath
    ? `${config.baseUrl}/${remainingPath}`
    : config.baseUrl;

  // Build headers for the upstream request
  const upstreamHeaders = new Headers();
  const contentType = context.request.headers.get("Content-Type");
  if (contentType) {
    upstreamHeaders.set("Content-Type", contentType);
  }
  for (const [key, value] of Object.entries(config.authHeaders(apiKey))) {
    upstreamHeaders.set(key, value);
  }

  const upstreamResponse = await fetch(targetUrl, {
    method: context.request.method,
    headers: upstreamHeaders,
    body: context.request.method !== "GET" ? context.request.body : undefined,
  });

  // Forward the response, adding CORS headers
  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(key, value);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
};
