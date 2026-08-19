import type { LlmProvider } from "../../stores/settings-store";

export interface LlmModelOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Compatible endpoints own their model catalogs. This registry intentionally
 * stays empty so the app never invents a provider or model selection.
 */
export const LLM_MODELS: Record<LlmProvider, LlmModelOption[]> = {
  "openai-compatible": [],
  "anthropic-compatible": [],
};

export function defaultModelFor(provider: LlmProvider): string {
  return modelsFor(provider)[0]?.id ?? "";
}

export function modelsFor(provider: LlmProvider): LlmModelOption[] {
  return LLM_MODELS[provider] ?? [];
}

export function isKnownModel(provider: LlmProvider, model: string): boolean {
  return modelsFor(provider).some((option) => option.id === model);
}

/** Accept a provider model id entered by the user, falling back only when blank. */
export function resolveModel(
  provider: LlmProvider,
  model: string | null | undefined,
): string {
  return model?.trim() || defaultModelFor(provider);
}
