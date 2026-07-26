import {
  withRetry,
  makeClientFromSend,
  llmHttpError,
  parseRetryAfterMs,
} from "@openreel/agent";
import type { LLMClient, LLMSend } from "@openreel/agent";

export type LlmProvider = "anthropic" | "openai" | "gemini";

// Gemini embeds the model in the URL path rather than the request body.
const ENDPOINTS: Record<LlmProvider, (model?: string) => string> = {
  anthropic: () => "https://api.anthropic.com/v1/messages",
  openai: () => "https://api.openai.com/v1/chat/completions",
  gemini: (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
  if (provider === "gemini") {
    return {
      "x-goog-api-key": apiKey,
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
 * per-request for the Authorization/x-goog-api-key header only and is never
 * stored or logged — preserving the BYOK no-persist guarantee on the server side.
 */
export function makeNodeLLMSend(
  provider: LlmProvider,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  model?: string,
): LLMSend {
  if (!apiKey) {
    throw new Error(`Missing API key for provider '${provider}'`);
  }
  return async (body: unknown): Promise<unknown> => {
    const res = await fetchFn(ENDPOINTS[provider](model), {
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
  const send = withRetry(makeNodeLLMSend(opts.provider, opts.apiKey, opts.fetchFn, opts.model));
  return makeClientFromSend({
    provider: opts.provider,
    model: opts.model,
    maxTokens: opts.maxTokens,
    send,
  });
}
