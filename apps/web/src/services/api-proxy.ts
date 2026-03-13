/**
 * API proxy utility for third-party service calls.
 *
 * In development: calls third-party APIs directly (for convenience).
 * In production: routes through Cloudflare Pages Functions proxy so
 * API keys never leave the same origin.
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

export type ApiService = keyof typeof DIRECT_CONFIG;

/**
 * Fetch from a third-party API, automatically routing through the proxy
 * in production builds.
 *
 * @param service - Target service (elevenlabs, openai, anthropic)
 * @param path - API path including leading slash, e.g. "/models" or "/text-to-speech/voiceId"
 * @param apiKey - Decrypted API key for the service
 * @param options - Standard RequestInit (method, body, extra headers, etc.)
 */
export async function apiFetch(
  service: ApiService,
  path: string,
  apiKey: string,
  options: globalThis.RequestInit = {},
): Promise<Response> {
  const extraHeaders = (options.headers ?? {}) as Record<string, string>;

  if (isDev) {
    const config = DIRECT_CONFIG[service];
    const url = `${config.baseUrl}${path}`;
    return fetch(url, {
      ...options,
      headers: {
        ...config.authHeaders(apiKey),
        ...extraHeaders,
      },
    });
  }

  // Production: route through same-origin proxy
  const url = `/api/proxy/${service}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "x-proxy-api-key": apiKey,
      ...extraHeaders,
    },
  });
}
