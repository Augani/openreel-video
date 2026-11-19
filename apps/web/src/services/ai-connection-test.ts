import { LLMHttpError, type LLMClient } from "@openreel/agent/llm";
import type { AIProvider } from "../stores/ai-connection-store";
import { isOllamaEndpoint, OLLAMA_ORIGINS_HINT } from "./ai-models";
import { makeDirectBYOKClient, validateAIEndpoint } from "./agent/direct-llm-transport";

export interface AIConnectionDraft {
  provider: AIProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type AIConnectionTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: "invalid" | "unreachable" | "no-tools"; message: string };

export const NO_TOOLS_MESSAGE = "This model answered but can't use editing tools. Try another model.";

const PROBE_TOOL_NAME = "report_ready";
const PROBE_TOOL_DESCRIPTION = "Call this once to confirm tool calling works.";
const PROBE_TOOL_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
} as const;

/** One trivial tool in the format the provider expects. */
export function probeToolFor(provider: AIProvider): unknown {
  return provider === "anthropic"
    ? { name: PROBE_TOOL_NAME, description: PROBE_TOOL_DESCRIPTION, input_schema: PROBE_TOOL_SCHEMA }
    : {
        type: "function",
        function: {
          name: PROBE_TOOL_NAME,
          description: PROBE_TOOL_DESCRIPTION,
          parameters: PROBE_TOOL_SCHEMA,
        },
      };
}

/** A network-level failure (not an HTTP status) against Ollama is almost always its origin check. */
function unreachableMessage(draft: AIConnectionDraft, error: unknown): string {
  if (isOllamaEndpoint(draft.baseUrl) && !(error instanceof LLMHttpError)) return OLLAMA_ORIGINS_HINT;
  return error instanceof Error ? error.message : "Connection test failed.";
}

/** Local runtimes reject a `tools` field with a 400 when the model has no tool support. */
function isToolRejection(error: unknown): boolean {
  return error instanceof LLMHttpError && (error.status === 400 || error.status === 422);
}

/**
 * Checks a connection in two steps: a plain "Reply with OK." turn (key, URL, model), then one
 * trivial tool call, because the editor can do nothing with a model that cannot call tools.
 * Never throws; the message is safe to show (the transport never echoes upstream bodies).
 */
export async function testAIConnection(
  draft: AIConnectionDraft,
  options: {
    signal?: AbortSignal;
    makeClient?: (connection: AIConnectionDraft & { signal?: AbortSignal }) => LLMClient;
  } = {},
): Promise<AIConnectionTestResult> {
  const make = options.makeClient ?? makeDirectBYOKClient;
  try {
    validateAIEndpoint(draft.baseUrl);
    if (!draft.model.trim()) {
      return { ok: false, reason: "invalid", message: "Enter a model ID that supports tool use." };
    }
    if (draft.provider !== "compatible" && !draft.apiKey.trim()) {
      return { ok: false, reason: "invalid", message: "Enter your provider API key." };
    }
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      message: error instanceof Error ? error.message : "Check the connection settings.",
    };
  }

  const client = make({ ...draft, signal: options.signal });
  const started = performance.now();
  try {
    await client.complete({ messages: [{ role: "user", content: "Reply with OK." }], tools: [] });
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: unreachableMessage(draft, error),
    };
  }

  try {
    const response = await client.complete({
      messages: [
        {
          role: "user",
          content: `Call the ${PROBE_TOOL_NAME} tool with ok set to true. Do not reply with text.`,
        },
      ],
      tools: [probeToolFor(draft.provider)],
    });
    if (response.toolUses.length === 0) {
      return { ok: false, reason: "no-tools", message: NO_TOOLS_MESSAGE };
    }
  } catch (error) {
    if (isToolRejection(error)) return { ok: false, reason: "no-tools", message: NO_TOOLS_MESSAGE };
    return {
      ok: false,
      reason: "unreachable",
      message: unreachableMessage(draft, error),
    };
  }
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}
