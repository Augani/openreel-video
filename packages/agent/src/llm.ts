export interface LLMToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** Informational only — the loop drives control flow off toolUses, not this. */
export type LLMStopReason = "end_turn" | "tool_use" | "max_tokens";

export type LlmProviderName = "anthropic" | "openai";

export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LLMResponse {
  readonly text: string;
  readonly toolUses: LLMToolUse[];
  readonly stopReason: LLMStopReason;
  readonly usage?: LLMUsage;
}

export type LoopToolResultBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly source: {
        readonly type: "base64";
        readonly media_type: string;
        readonly data: string;
      };
    };

export interface LoopToolResult {
  readonly toolUseId: string;
  readonly content: string | LoopToolResultBlock[];
  readonly isError: boolean;
}

export type LoopMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolUses: LLMToolUse[] }
  | { role: "tool"; results: LoopToolResult[] };

export interface LLMTurnInput {
  readonly system?: string;
  readonly messages: LoopMessage[];
  /** Provider-formatted tool definitions (from registry.toAnthropicTools/toOpenAITools). */
  readonly tools: unknown[];
}

export interface LLMClient {
  complete(input: LLMTurnInput): Promise<LLMResponse>;
}

/** Injected transport: sends a provider request body, returns the parsed JSON. */
export type LLMSend = (body: unknown) => Promise<unknown>;

/** Transport error carrying the upstream HTTP status so retries can classify it. */
export class LLMHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed Retry-After (ms), honored by withRetry when present. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LLMHttpError";
  }
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(headerValue);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Build a transport error with a sliced body + optional Retry-After. */
export function llmHttpError(
  provider: string,
  status: number,
  body: string,
  retryAfterMs?: number,
): LLMHttpError {
  return new LLMHttpError(`${provider} ${status}: ${body.slice(0, 500)}`, status, retryAfterMs);
}

export interface RetryOptions {
  readonly retries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly isRetryable?: (error: unknown) => boolean;
  /** Abort an in-progress backoff (and short-circuit) when the turn is stopped. */
  readonly signal?: AbortSignal;
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("Aborted", "AbortError");

function abortableSleep(
  ms: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve(sleep(ms)).then(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

const defaultRetryable = (error: unknown): boolean => {
  if (error instanceof LLMHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
};

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a transport with exponential backoff on rate-limit (429) and server
 * (5xx) errors, so provider throttling is absorbed instead of failing the turn.
 */
export function withRetry(send: LLMSend, opts: RetryOptions = {}): LLMSend {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? realSleep;
  const isRetryable = opts.isRetryable ?? defaultRetryable;

  return async (body: unknown): Promise<unknown> => {
    let attempt = 0;
    for (;;) {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      try {
        return await send(body);
      } catch (error) {
        if (attempt >= retries || !isRetryable(error)) throw error;
        const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        const retryAfter =
          error instanceof LLMHttpError ? error.retryAfterMs : undefined;
        const ceiling =
          retryAfter !== undefined
            ? Math.min(maxDelayMs, Math.max(backoff, retryAfter))
            : backoff;
        // Full jitter to avoid thundering-herd retries.
        await abortableSleep(Math.random() * ceiling, sleep, opts.signal);
        attempt++;
      }
    }
  };
}

// ---- Anthropic --------------------------------------------------------------
export function buildAnthropicBody(
  input: LLMTurnInput,
  model: string,
  maxTokens: number,
): unknown {
  const messages = input.messages.map((m) => {
    if (m.role === "user") {
      return { role: "user", content: [{ type: "text", text: m.content }] };
    }
    if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tu of m.toolUses) {
        content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }
      return { role: "assistant", content };
    }
    return {
      role: "user",
      content: m.results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.toolUseId,
        content: r.content,
        is_error: r.isError,
      })),
    };
  });
  return {
    model,
    max_tokens: maxTokens,
    ...(input.system ? { system: input.system } : {}),
    messages,
    tools: input.tools,
  };
}

export function parseAnthropicResponse(raw: unknown): LLMResponse {
  const r = raw as {
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  let text = "";
  const toolUses: LLMToolUse[] = [];
  for (const block of r.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    else if (block.type === "tool_use" && block.id && block.name) {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }
  const stopReason: LLMStopReason =
    r.stop_reason === "tool_use"
      ? "tool_use"
      : r.stop_reason === "max_tokens"
        ? "max_tokens"
        : "end_turn";
  const usage = r.usage
    ? {
        inputTokens: r.usage.input_tokens ?? 0,
        outputTokens: r.usage.output_tokens ?? 0,
      }
    : undefined;
  return { text, toolUses, stopReason, usage };
}

export interface AdapterOptions {
  readonly model: string;
  readonly maxTokens?: number;
  readonly send: LLMSend;
}

export class AnthropicClient implements LLMClient {
  constructor(private readonly options: AdapterOptions) {}
  async complete(input: LLMTurnInput): Promise<LLMResponse> {
    const body = buildAnthropicBody(input, this.options.model, this.options.maxTokens ?? 4096);
    const raw = await this.options.send(body);
    return parseAnthropicResponse(raw);
  }
}

// ---- OpenAI -----------------------------------------------------------------
export function buildOpenAIBody(
  input: LLMTurnInput,
  model: string,
  maxTokens?: number,
): unknown {
  const messages: unknown[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  for (const m of input.messages) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      messages.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolUses.length
          ? {
              tool_calls: m.toolUses.map((tu) => ({
                id: tu.id,
                type: "function",
                function: { name: tu.name, arguments: JSON.stringify(tu.input) },
              })),
            }
          : {}),
      });
    } else {
      for (const r of m.results) {
        const content =
          typeof r.content === "string"
            ? r.content
            : (r.content.find(
                (block): block is { type: "text"; text: string } =>
                  block.type === "text",
              )?.text ?? "");
        messages.push({ role: "tool", tool_call_id: r.toolUseId, content });
      }
    }
  }
  return {
    model,
    messages,
    tools: input.tools,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
}

export function parseOpenAIResponse(raw: unknown): LLMResponse {
  const r = raw as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = r.choices?.[0];
  const msg = choice?.message;
  const toolUses: LLMToolUse[] = (msg?.tool_calls ?? []).map((tc) => {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      input = {};
    }
    return { id: tc.id, name: tc.function.name, input };
  });
  const stopReason: LLMStopReason =
    choice?.finish_reason === "tool_calls"
      ? "tool_use"
      : choice?.finish_reason === "length"
        ? "max_tokens"
        : "end_turn";
  const usage = r.usage
    ? {
        inputTokens: r.usage.prompt_tokens ?? 0,
        outputTokens: r.usage.completion_tokens ?? 0,
      }
    : undefined;
  return { text: msg?.content ?? "", toolUses, stopReason, usage };
}

export class OpenAIClient implements LLMClient {
  constructor(private readonly options: AdapterOptions) {}
  async complete(input: LLMTurnInput): Promise<LLMResponse> {
    const body = buildOpenAIBody(input, this.options.model, this.options.maxTokens);
    const raw = await this.options.send(body);
    return parseOpenAIResponse(raw);
  }
}

export interface ClientFromSendOptions {
  readonly provider: LlmProviderName;
  readonly model: string;
  readonly maxTokens?: number;
  readonly send: LLMSend;
}

/** Assembles the right provider client from an injected transport (shared by the web + node factories). */
export function makeClientFromSend(opts: ClientFromSendOptions): LLMClient {
  const maxTokens = opts.maxTokens ?? 4096;
  return opts.provider === "anthropic"
    ? new AnthropicClient({ model: opts.model, maxTokens, send: opts.send })
    : new OpenAIClient({ model: opts.model, maxTokens, send: opts.send });
}

// ---- Mock (tests / dry runs) ------------------------------------------------
export class MockLLMClient implements LLMClient {
  private index = 0;
  constructor(private readonly script: LLMResponse[]) {}
  async complete(): Promise<LLMResponse> {
    const next = this.script[this.index] ?? {
      text: "",
      toolUses: [],
      stopReason: "end_turn" as const,
    };
    this.index++;
    return next;
  }
}
