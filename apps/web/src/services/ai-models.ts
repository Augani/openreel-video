/**
 * One source of truth for the AI provider list and recommended model ids.
 *
 * Only Anthropic ids are refreshed here (claude-sonnet-5-5 is the recommended default). The other
 * providers keep their existing ids: do not invent ids that cannot be verified in this repo.
 */

export type AIProviderKind = "openai" | "anthropic" | "compatible";

export interface AIModelOption {
  readonly id: string;
  readonly label: string;
  readonly recommended?: boolean;
}

export const ANTHROPIC_MODELS: readonly AIModelOption[] = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", recommended: true },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];

export const OPENAI_MODELS: readonly AIModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o", recommended: true },
];

/** Ids this app used as defaults before; kept so saved connections still get a friendly label. */
export const LEGACY_ANTHROPIC_MODEL_IDS: readonly string[] = ["claude-sonnet-4-5"];

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";
export const OPENAI_DEFAULT_MODEL = "gpt-4o";

export const AI_PROVIDER_DEFAULTS: Record<AIProviderKind, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: OPENAI_DEFAULT_MODEL },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: ANTHROPIC_DEFAULT_MODEL },
  compatible: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
};

export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** True for a local Ollama server (loopback host on its default port 11434). */
export function isOllamaEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "11434";
  } catch {
    return false;
  }
}

/**
 * Ollama refuses browser requests from origins it does not know. The app talks to it directly, so
 * the one-time fix is to allow this app's origin through the OLLAMA_ORIGINS setting and restart it.
 */
export const OLLAMA_ORIGINS_HINT =
  "Ollama is running but refused this app's request. Set the OLLAMA_ORIGINS environment variable to * (for example, run: OLLAMA_ORIGINS='*' ollama serve), restart Ollama, then test again.";

export type AIProviderChoiceId =
  | "ollama"
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "custom";

export interface AIProviderChoice {
  readonly id: AIProviderChoiceId;
  readonly name: string;
  readonly subtitle: string;
  readonly provider: AIProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  /** Needs an API key before it can answer. */
  readonly keyRequired: boolean;
  /** Provider console where a key is created (opened in the system browser). */
  readonly keyUrl?: string;
  /** Models offered in a dropdown; empty means the user types a model id. */
  readonly models: readonly AIModelOption[];
  readonly editableBaseUrl?: boolean;
}

export const AI_PROVIDER_CHOICES: readonly AIProviderChoice[] = [
  {
    id: "ollama",
    name: "Local model (Ollama)",
    subtitle: "Runs on this computer, no key",
    provider: "compatible",
    baseUrl: OLLAMA_BASE_URL,
    model: "",
    keyRequired: false,
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    subtitle: "Claude models",
    provider: "anthropic",
    baseUrl: AI_PROVIDER_DEFAULTS.anthropic.baseUrl,
    model: ANTHROPIC_DEFAULT_MODEL,
    keyRequired: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: ANTHROPIC_MODELS,
  },
  {
    id: "openai",
    name: "OpenAI",
    subtitle: "GPT models",
    provider: "openai",
    baseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl,
    model: OPENAI_DEFAULT_MODEL,
    keyRequired: true,
    keyUrl: "https://platform.openai.com/api-keys",
    models: OPENAI_MODELS,
  },
  {
    id: "google",
    name: "Google",
    subtitle: "Gemini models",
    provider: "compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "",
    keyRequired: true,
    keyUrl: "https://aistudio.google.com/apikey",
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    subtitle: "Any model, one key",
    provider: "compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    keyRequired: true,
    keyUrl: "https://openrouter.ai/keys",
    models: [],
  },
  {
    id: "custom",
    name: "Custom endpoint",
    subtitle: "Any OpenAI-compatible URL",
    provider: "compatible",
    baseUrl: AI_PROVIDER_DEFAULTS.compatible.baseUrl,
    model: AI_PROVIDER_DEFAULTS.compatible.model,
    keyRequired: false,
    models: [],
    editableBaseUrl: true,
  },
];

export function providerChoice(id: AIProviderChoiceId): AIProviderChoice {
  return AI_PROVIDER_CHOICES.find((c) => c.id === id) ?? AI_PROVIDER_CHOICES[0];
}

/** Friendly name for a known model id, or null (the id is then shown as is). */
export function knownModelLabel(provider: AIProviderKind, id: string): string | null {
  const model = id.trim();
  if (provider === "anthropic") {
    const hit = ANTHROPIC_MODELS.find((m) => m.id === model);
    if (hit) return hit.label.replace(/ 5\.5$/, "");
    if (LEGACY_ANTHROPIC_MODEL_IDS.includes(model)) return "Claude Sonnet";
  }
  if (provider === "openai" && model === OPENAI_DEFAULT_MODEL) return "GPT-4o";
  return null;
}
