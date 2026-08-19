/**
 * API proxy utility for third-party service calls.
 *
 * In development: calls third-party APIs directly (for convenience).
 * In production: built-in services route through Cloudflare Pages Functions.
 * User-defined compatible endpoints are called directly to avoid
 * turning the hosted proxy into an arbitrary-destination relay.
 */

const isDev = import.meta.env.DEV;

const DIRECT_CONFIG = {
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io/v1",
    authHeaders: (key: string): Record<string, string> => ({
      "xi-api-key": key,
    }),
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    authHeaders: (key: string): Record<string, string> => ({
      Authorization: `Bearer ${key}`,
    }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    authHeaders: (key: string): Record<string, string> => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    }),
  },
} as const;

export type CompatibleApiService =
  | "openai-compatible"
  | "anthropic-compatible";
export type ApiService = keyof typeof DIRECT_CONFIG | CompatibleApiService;

export interface ApiFetchOptions extends globalThis.RequestInit {
  /** Required only for user-defined compatible requests. */
  readonly baseUrl?: string;
}

/**
 * Accept either a `/v1`-style base URL or a complete `/chat/completions` URL.
 * Credentials and query/hash fragments are rejected so secrets stay in the
 * dedicated encrypted key field and URL joining remains deterministic.
 */
export function normalizeCompatibleBaseUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("Enter a compatible API base URL.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid API URL, including http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The compatible endpoint must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Put credentials in the API key field, not in the endpoint URL.");
  }
  if (url.search || url.hash) {
    throw new Error("The compatible endpoint URL cannot include a query string or fragment.");
  }

  let pathname = url.pathname.replace(/\/+$/, "");
  pathname = pathname.replace(/\/(?:chat\/completions|messages|models)$/i, "");
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

/** Backwards-compatible export for callers that used the original name. */
export const normalizeOpenAICompatibleBaseUrl = normalizeCompatibleBaseUrl;

/**
 * Fetch from a third-party API, automatically routing through the proxy
 * in production builds.
 *
 * @param service - Target built-in service or a compatible endpoint
 * @param path - API path including leading slash, e.g. "/models" or "/text-to-speech/voiceId"
 * @param apiKey - Decrypted API key for the service
 * @param options - Standard RequestInit (method, body, extra headers, etc.)
 */
export async function apiFetch(
  service: ApiService,
  path: string,
  apiKey: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { baseUrl, ...requestOptions } = options;
  const extraHeaders = (options.headers ?? {}) as Record<string, string>;

  if (typeof window !== "undefined" && window.openreel?.platform === "desktop") {
    const result = await window.openreel.cloud.fetch(service, path, {
      method: options.method,
      headers: options.headers as Record<string, string> | undefined,
      body: typeof options.body === "string" ? options.body : undefined,
      baseUrl,
    });
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }

  if (
    service === "openai-compatible" ||
    service === "anthropic-compatible"
  ) {
    const allowedPaths =
      service === "openai-compatible"
        ? ["/chat/completions", "/models"]
        : ["/messages", "/models"];
    if (!allowedPaths.includes(path)) {
      throw new Error(`Unsupported ${service} API path.`);
    }
    const normalizedBaseUrl = normalizeCompatibleBaseUrl(baseUrl ?? "");
    const safeHeaders = Object.fromEntries(
      Object.entries(extraHeaders).filter(
        ([name]) =>
          ![
            "authorization",
            "x-api-key",
            "anthropic-version",
            "anthropic-dangerous-direct-browser-access",
          ].includes(name.toLowerCase()),
      ),
    );
    const authHeaders: Record<string, string> = {};
    if (service === "openai-compatible") {
      if (apiKey) authHeaders.Authorization = `Bearer ${apiKey}`;
    } else {
      authHeaders["anthropic-version"] = "2023-06-01";
      authHeaders["anthropic-dangerous-direct-browser-access"] = "true";
      if (apiKey) {
        authHeaders["x-api-key"] = apiKey;
        authHeaders.Authorization = `Bearer ${apiKey}`;
      }
    }
    return fetch(`${normalizedBaseUrl}${path}`, {
      ...requestOptions,
      headers: {
        ...safeHeaders,
        ...authHeaders,
      },
    });
  }

  if (isDev) {
    const config = DIRECT_CONFIG[service];
    const url = `${config.baseUrl}${path}`;
    return fetch(url, {
      ...requestOptions,
      headers: {
        ...config.authHeaders(apiKey),
        ...extraHeaders,
      },
    });
  }

  // Production: route through same-origin proxy
  const url = `/api/proxy/${service}${path}`;
  return fetch(url, {
    ...requestOptions,
    headers: {
      "x-proxy-api-key": apiKey,
      ...extraHeaders,
    },
  });
}
