import {
  withRetry,
  makeClientFromSend,
  llmHttpError,
  parseRetryAfterMs,
} from "@openreel/agent";
import type { LLMClient, LLMSend } from "@openreel/agent";

export type LlmProvider = "anthropic" | "openai" | "atlascloud";

const ENDPOINTS: Record<LlmProvider, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  atlascloud: "https://api.atlascloud.ai/v1/chat/completions",
};

function authHeaders(
  provider: LlmProvider,
  apiKey: string,
): Record<string, string> {
  if (provider === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Builds a fetch-based transport for the agent LLM clients. The API key is used
 * per-request for the Authorization header only and is never stored or logged —
 * preserving the BYOK no-persist guarantee on the server side.
 */
export function makeNodeLLMSend(
  provider: LlmProvider,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): LLMSend {
  if (!apiKey) {
    throw new Error(`Missing API key for provider '${provider}'`);
  }
  return async (body: unknown): Promise<unknown> => {
    const res = await fetchFn(ENDPOINTS[provider], {
      method: "POST",
      headers: authHeaders(provider, apiKey),
      body: JSON.stringify(body),
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

export interface NodeLLMOptions {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly maxTokens?: number;
  readonly fetchFn?: typeof fetch;
}

export function makeNodeLLMClient(opts: NodeLLMOptions): LLMClient {
  const send = withRetry(makeNodeLLMSend(opts.provider, opts.apiKey, opts.fetchFn));
  return makeClientFromSend({
    provider: opts.provider,
    model: opts.model,
    maxTokens: opts.maxTokens,
    send,
  });
}
