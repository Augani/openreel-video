import { makeClientFromSend, withRetry, LLMHttpError, parseRetryAfterMs, type LLMClient } from "@openreel/agent";
import type { AIProvider } from "../../stores/ai-connection-store";

export interface DirectConnection { provider: AIProvider; baseUrl: string; model: string; apiKey: string; signal?: AbortSignal }
export function validateAIEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Use an HTTPS base URL, or HTTP on localhost, without credentials, query parameters or fragments.");
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages)\/?$/, "");
  return url.href.replace(/\/+$/, "");
}
/** Dev only: route the env-configured endpoint (VITE_AI_BASE_URL) through the Vite proxy so gateways without CORS headers work. */
function devProxiedBaseUrl(baseUrl: string): string {
  const envBase = import.meta.env.VITE_AI_BASE_URL?.trim();
  if (!import.meta.env.DEV || !envBase || typeof window === "undefined") return baseUrl;
  try {
    const target = new URL(baseUrl);
    if (target.origin !== new URL(envBase).origin) return baseUrl;
    return `${window.location.origin}/__ai-proxy${target.pathname.replace(/\/$/, "")}`;
  } catch {
    return baseUrl;
  }
}
export function makeDirectBYOKClient(options: DirectConnection): LLMClient {
  const baseUrl = validateAIEndpoint(options.baseUrl);
  if (!options.model.trim()) throw new Error("Enter a model ID that supports tools.");
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw new Error("Invalid API key.");
  const provider = options.provider === "anthropic" ? "anthropic" : "openai";
  const send = withRetry(async (body: unknown) => {
    options.signal?.throwIfAborted();
    let res: Response;
    try {
      res = await fetch(`${devProxiedBaseUrl(baseUrl)}${provider === "anthropic" ? "/messages" : "/chat/completions"}`, { method: "POST", redirect: "error", credentials: "omit", headers: { "Content-Type": "application/json", ...(provider === "anthropic" ? { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) }, body: JSON.stringify(body), signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error("The model endpoint could not be reached. Check its URL and browser CORS support. No proxy or security bypass is used.");
    }
    // Never include upstream response bodies: providers can echo credentials.
    if (!res.ok) throw new LLMHttpError(`Model endpoint returned HTTP ${res.status}. Check the key, model ID and provider settings.`, res.status, parseRetryAfterMs(res.headers.get("retry-after")));
    let raw: unknown;
    try { raw = await res.json(); } catch { throw new Error("The endpoint returned invalid JSON. Check the API adapter and endpoint."); }
    if (!raw || typeof raw !== "object" || (provider === "openai" && !("choices" in raw)) || (provider === "anthropic" && !("content" in raw))) throw new Error("The endpoint returned an unsupported response. Choose the correct API adapter and a tool-capable model.");
    return raw;
  }, { signal: options.signal, retries: 2 });
  return makeClientFromSend({ provider, model: options.model.trim(), maxTokens: 4096, send });
}
