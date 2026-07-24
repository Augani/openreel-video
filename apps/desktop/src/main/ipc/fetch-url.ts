import { net } from "electron";

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export interface FetchUrlResult {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly body: ArrayBuffer;
  readonly error?: string;
}

function err(message: string, status = 0): FetchUrlResult {
  return { ok: false, status, statusText: message, contentType: "", body: new ArrayBuffer(0), error: message };
}

function isBlockedHost(hostname: string): boolean {
  if (process.env.OPENREEL_ALLOW_LOCAL_FETCH === "1") return false;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export async function fetchUrl(args: { url: string; maxBytes?: number }): Promise<FetchUrlResult> {
  const max = args.maxBytes ?? DEFAULT_MAX_BYTES;

  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    return err("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err(`Only http/https URLs are allowed (got ${parsed.protocol})`);
  }
  if (isBlockedHost(parsed.hostname)) {
    return err(`Refusing to fetch a private/loopback host (${parsed.hostname})`);
  }

  try {
    const res = await net.fetch(parsed.toString(), { method: "GET", redirect: "follow" });
    const contentType = res.headers.get("content-type") ?? "";
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > 0 && declared > max) {
      return err(`Resource too large: ${declared} bytes (max ${max})`, res.status);
    }
    const body = await res.arrayBuffer();
    if (body.byteLength > max) {
      return err(`Resource too large: ${body.byteLength} bytes (max ${max})`, res.status);
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType,
      body,
    };
  } catch (error) {
    return err(error instanceof Error ? error.message : "Fetch failed");
  }
}
