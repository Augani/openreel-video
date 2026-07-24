import type { LlmProvider } from "../../stores/settings-store";

export interface LlmModelOption {
  readonly id: string;
  readonly label: string;
}

/** Tool-use-capable models per provider for the agent chat (BYOK). */
export const LLM_MODELS: Record<LlmProvider, LlmModelOption[]> = {
  anthropic: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o4-mini", label: "o4-mini" },
  ],
};

export function defaultModelFor(provider: LlmProvider): string {
  return LLM_MODELS[provider][0].id;
}

export function modelsFor(provider: LlmProvider): LlmModelOption[] {
  return LLM_MODELS[provider];
}
