import { getKeyStore } from "./keychain";

export type CloudService =
  | "elevenlabs"
  | "openai"
  | "anthropic"
  | "openai-compatible"
  | "anthropic-compatible";

interface ServiceConfig {
  baseUrl: string;
  authHeaders: (key: string) => Record<string, string>;
}

// Mirror of apps/web/src/services/api-proxy.ts DIRECT_CONFIG. apps/desktop cannot import apps/web,
// so this is a deliberate duplication — keep it in sync if the web config changes.
export const DIRECT_CONFIG: Record<
  Exclude<CloudService, "openai-compatible" | "anthropic-compatible">,
  ServiceConfig
> = {
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
    authHeaders: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
};

export interface UpstreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function normalizeCompatibleBaseUrl(input: string | undefined): string {
  const value = input?.trim() ?? "";
  if (!value) throw new Error("Missing compatible API base URL");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Compatible endpoint must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Compatible endpoint cannot contain credentials, query, or fragment");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  pathname = pathname.replace(/\/(?:chat\/completions|messages|models)$/i, "");
  url.pathname = pathname;
  return url.toString().replace(/\/$/, "");
}

export function buildUpstreamRequest(
  service: CloudService,
  path: string,
  key: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    baseUrl?: string;
  },
): UpstreamRequest {
  if (
    service === "openai-compatible" ||
    service === "anthropic-compatible"
  ) {
    const allowedPaths =
      service === "openai-compatible"
        ? ["/chat/completions", "/models"]
        : ["/messages", "/models"];
    if (!allowedPaths.includes(path)) {
      throw new Error(`Unsupported ${service} API path`);
    }
    const safeHeaders = Object.fromEntries(
      Object.entries(options.headers ?? {}).filter(
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
      if (key) authHeaders.Authorization = `Bearer ${key}`;
    } else {
      authHeaders["anthropic-version"] = "2023-06-01";
      if (key) {
        authHeaders["x-api-key"] = key;
        authHeaders.Authorization = `Bearer ${key}`;
      }
    }
    return {
      url: `${normalizeCompatibleBaseUrl(options.baseUrl)}${path}`,
      method: options.method ?? "GET",
      headers: {
        ...safeHeaders,
        ...authHeaders,
      },
      body: options.body,
    };
  }

  const cfg = DIRECT_CONFIG[service];
  return {
    url: `${cfg.baseUrl}${path}`,
    method: options.method ?? "GET",
    // auth headers win over any renderer-supplied header of the same name
    headers: { ...(options.headers ?? {}), ...cfg.authHeaders(key) },
    body: options.body,
  };
}

export interface CloudFetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export async function cloudFetch(args: {
  service: CloudService;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  baseUrl?: string;
}): Promise<CloudFetchResult> {
  const key = (await getKeyStore().get(args.service)) ?? "";
  if (!key && !args.service.endsWith("-compatible")) {
    return {
      status: 401,
      statusText: `No API key stored for ${args.service}`,
      headers: {},
      body: new ArrayBuffer(0),
    };
  }
  const req = buildUpstreamRequest(args.service, args.path, key, args);
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const body = await res.arrayBuffer();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { status: res.status, statusText: res.statusText, headers, body };
}
