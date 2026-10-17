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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function responseError(raw: unknown, provider: string): Error | null {
  if (!isRecord(raw) || !isRecord(raw.error)) return null;
  const message =
    typeof raw.error.message === "string"
      ? raw.error.message
      : typeof raw.error.type === "string"
        ? raw.error.type
        : "The provider returned an error response.";
  return new Error(`${provider}: ${message}`);
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseToolInput(value: unknown, toolName: string): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  if (isRecord(value)) return value;
  if (typeof value !== "string") {
    throw new Error(`Model returned invalid arguments for tool ${toolName}.`);
  }

  try {
    let parsed: unknown = JSON.parse(value);
    // A few compatible servers double-encode function arguments.
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!isRecord(parsed)) throw new Error("arguments must be an object");
    return parsed;
  } catch {
    throw new Error(`Model returned invalid JSON arguments for tool ${toolName}.`);
  }
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
  const upstreamError = responseError(raw, "Anthropic");
  if (upstreamError) throw upstreamError;
  const r = raw as {
    content?: string | Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  let text = typeof r.content === "string" ? r.content : "";
  const toolUses: LLMToolUse[] = [];
  for (const block of Array.isArray(r.content) ? r.content : []) {
    if (block.type === "text" && block.text) text += block.text;
    else if (block.type === "tool_use") {
      if (!block.id || !block.name) {
        throw new Error("Anthropic returned a tool call without an id or name.");
      }
      toolUses.push({
        id: block.id,
        name: block.name,
        input: parseToolInput(block.input, block.name),
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
        inputTokens: tokenCount(r.usage.input_tokens),
        outputTokens: tokenCount(r.usage.output_tokens),
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
      const images = m.results.flatMap((r) => typeof r.content === "string" ? [] : r.content.filter((b) => b.type === "image").map((b) => ({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } })));
      if (images.length) messages.push({ role: "user", content: images });
    }
  }
  return {
    model,
    messages,
    tools: input.tools,
    ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
  };
}

export function parseOpenAIResponse(raw: unknown): LLMResponse {
  const upstreamError = responseError(raw, "OpenAI-compatible provider");
  if (upstreamError) throw upstreamError;
  const r = raw as {
    choices?: Array<{
      message?: {
        content?: unknown;
        tool_calls?: unknown[];
        function_call?: unknown;
      };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  const choice = r.choices?.[0];
  if (!choice?.message) {
    throw new Error("OpenAI-compatible provider returned no assistant message.");
  }
  const msg = choice?.message;

  const textFromContent = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        if (typeof part.text === "string") return part.text;
        if (isRecord(part.text) && typeof part.text.value === "string") {
          return part.text.value;
        }
        return typeof part.content === "string" ? part.content : "";
      })
      .join("");
  };

  const rawToolCalls = Array.isArray(msg.tool_calls) ? [...msg.tool_calls] : [];
  if (rawToolCalls.length === 0 && msg.function_call !== undefined) {
    rawToolCalls.push({ id: "legacy-function-call-0", function: msg.function_call });
  }
  const toolUses: LLMToolUse[] = rawToolCalls.map((rawToolCall, index) => {
    if (!isRecord(rawToolCall)) {
      throw new Error("OpenAI-compatible provider returned an invalid tool call.");
    }
    const fn = isRecord(rawToolCall.function) ? rawToolCall.function : rawToolCall;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) {
      throw new Error("OpenAI-compatible provider returned a tool call without a name.");
    }
    const id =
      typeof rawToolCall.id === "string" && rawToolCall.id
        ? rawToolCall.id
        : `compatible-tool-call-${index}`;
    return {
      id,
      name,
      input: parseToolInput(fn.arguments, name),
    };
  });
  const stopReason: LLMStopReason =
    toolUses.length > 0 || choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call"
      ? "tool_use"
      : choice.finish_reason === "length" || choice.finish_reason === "max_tokens"
        ? "max_tokens"
        : "end_turn";
  const usage = r.usage
    ? {
        inputTokens: tokenCount(r.usage.prompt_tokens ?? r.usage.input_tokens),
        outputTokens: tokenCount(r.usage.completion_tokens ?? r.usage.output_tokens),
      }
    : undefined;
  return { text: textFromContent(msg.content), toolUses, stopReason, usage };
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
  /** Omit provider-specific output-token fields for broad compatible-endpoint support. */
  readonly omitMaxTokens?: boolean;
  readonly send: LLMSend;
}

/** Assembles the right provider client from an injected transport (shared by the web + node factories). */
export function makeClientFromSend(opts: ClientFromSendOptions): LLMClient {
  const maxTokens = opts.omitMaxTokens ? undefined : (opts.maxTokens ?? 4096);
  return opts.provider === "anthropic"
    ? new AnthropicClient({
        model: opts.model,
        maxTokens: maxTokens ?? 4096,
        send: opts.send,
      })
    : new OpenAIClient({
        model: opts.model,
        maxTokens,
        send: opts.send,
      });
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
