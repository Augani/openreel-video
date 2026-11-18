import { type AIProvider } from "../../../stores/ai-connection-store";
import { knownModelLabel } from "../../../services/ai-models";

/** Display names never replace the provider's actual model ID. */
export function aiModelLabel(provider: AIProvider, model: string): string {
  const id = model.trim();
  return knownModelLabel(provider, id) ?? (id || "Choose a model");
}

export function aiProviderLabel(provider: AIProvider, baseUrl: string): string {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "openai") return "OpenAI";
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "openrouter.ai") return "OpenRouter";
    if (url.hostname === "generativelanguage.googleapis.com") return "Google";
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "11434") return "Ollama";
  } catch { /* An unfinished draft may not contain a URL yet. */ }
  return "Compatible";
}

/** True when the saved connection can actually serve a request. */
export function isConnectionReady(c: { baseUrl: string; model: string; apiKey: string; provider: string }): boolean {
  return !!c.baseUrl.trim() && !!c.model.trim() && (!!c.apiKey || c.provider === "compatible");
}
