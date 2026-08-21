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
  openrouter: [
    { id: "openai/gpt-5.4", label: "GPT-5.4 (OpenAI)" },
    { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini (OpenAI)" },
    { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash (Google)" },
    { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "nvidia/nemotron-3-ultra:free", label: "Nemotron 3 Ultra (free)" },
    { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B (free)" },
  ],
};

export function defaultModelFor(provider: LlmProvider): string {
  return LLM_MODELS[provider][0].id;
}

export function modelsFor(provider: LlmProvider): LlmModelOption[] {
  return LLM_MODELS[provider];
}
