import { getKeyStore } from "./keychain";

export type CloudService = "elevenlabs" | "openai" | "anthropic";

interface ServiceConfig {
  baseUrl: string;
  authHeaders: (key: string) => Record<string, string>;
}

// Mirror of apps/web/src/services/api-proxy.ts DIRECT_CONFIG. apps/desktop cannot import apps/web,
// so this is a deliberate duplication — keep it in sync if the web config changes.
export const DIRECT_CONFIG: Record<CloudService, ServiceConfig> = {
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

export function buildUpstreamRequest(
  service: CloudService,
  path: string,
  key: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
): UpstreamRequest {
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
}): Promise<CloudFetchResult> {
  const key = await getKeyStore().get(args.service);
  if (!key) {
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
