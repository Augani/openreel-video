import {
  withRetry,
  makeClientFromSend,
  llmHttpError,
  parseRetryAfterMs,
} from "@openreel/agent";
import type { LLMClient } from "@openreel/agent";
import { apiFetch } from "../api-proxy";
import type { LlmProvider } from "../../stores/settings-store";

const PATHS: Record<LlmProvider, string> = {
  anthropic: "/messages",
  openai: "/chat/completions",
  atlascloud: "/chat/completions",
};

function makeSend(
  provider: LlmProvider,
  apiKey: string,
  signal?: AbortSignal,
) {
  return async (body: unknown): Promise<unknown> => {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const res = await apiFetch(provider, PATHS[provider], apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw llmHttpError(
        provider,
        res.status,
        text,
        parseRetryAfterMs(res.headers.get("retry-after")),
      );
    }
    return res.json();
  };
}

export interface BYOKClientOptions {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

/**
 * Builds an @openreel/agent LLMClient whose transport routes through the
 * existing BYOK apiFetch (same-origin Pages proxy in prod, keychain on desktop,
 * direct in dev) — keys never leave their existing path.
 */
export function makeBYOKClient(opts: BYOKClientOptions): LLMClient {
  const send = withRetry(makeSend(opts.provider, opts.apiKey, opts.signal), {
    signal: opts.signal,
  });
  return makeClientFromSend({
    provider: opts.provider,
    model: opts.model,
    maxTokens: opts.maxTokens,
    send,
  });
}
