import { create } from "zustand";

export type AIProvider = "openai" | "anthropic" | "compatible";
export const AI_PROVIDER_DEFAULTS: Record<AIProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  compatible: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
};

const env = import.meta.env as Record<string, string | undefined>;
const envProvider = (env.VITE_AI_PROVIDER ?? "").trim().toLowerCase();
const initialProvider: AIProvider =
  envProvider === "openai" || envProvider === "anthropic" || envProvider === "compatible" ? envProvider : "openai";
const initialDefaults = AI_PROVIDER_DEFAULTS[initialProvider];
/** Build-time defaults from VITE_AI_* env vars. Values are exposed to the browser bundle. */
const initialConnection = {
  provider: initialProvider,
  baseUrl: env.VITE_AI_BASE_URL?.trim() || initialDefaults.baseUrl,
  model: env.VITE_AI_MODEL?.trim() || initialDefaults.model,
  apiKey: env.VITE_AI_API_KEY?.trim() || "",
};

/** Connection values for a provider: env overrides apply only to the provider chosen via env. */
export function getProviderConnection(provider: AIProvider) {
  if (provider === initialProvider) return { provider, baseUrl: initialConnection.baseUrl, model: initialConnection.model, apiKey: initialConnection.apiKey };
  return { provider, ...AI_PROVIDER_DEFAULTS[provider], apiKey: "" };
}

interface AIConnectionState { provider: AIProvider; baseUrl: string; model: string; apiKey: string; configure: (options: Partial<Pick<AIConnectionState, "provider" | "baseUrl" | "model" | "apiKey">>) => void; forgetKey: () => void }
/** Intentionally no persistence: keys and connection details stay in this tab. */
export const useAIConnectionStore = create<AIConnectionState>((set) => ({ ...initialConnection, configure: (options) => set(options), forgetKey: () => set({ apiKey: "" }) }));
