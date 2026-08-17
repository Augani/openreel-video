import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";
import { onSessionLock } from "../services/secure-storage";
import { i18n, ensureLocaleLoaded, detectInitialLanguage } from "../i18n";

export interface ServiceConfig {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly docsUrl?: string;
}

/**
 * Registry of supported external services that require API keys.
 * Add new services here as the app integrates more third-party APIs.
 */
export const SERVICE_REGISTRY: readonly ServiceConfig[] = [
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "AI voice generation and text-to-speech",
    docsUrl: "https://elevenlabs.io/docs/api-reference",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT models for script generation and AI features",
    docsUrl: "https://platform.openai.com/docs/api-reference",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models for AI-assisted editing",
    docsUrl: "https://docs.anthropic.com/en/docs",
  },
  {
    id: "kie-ai",
    label: "Kie.ai",
    description: "AI aggregator for video/image generation, upscaling, and editing",
    docsUrl: "https://kie.ai",
  },
  {
    id: "freepik",
    label: "Freepik",
    description: "AI aggregator for image generation, vectors, and creative assets",
    docsUrl: "https://www.freepik.com/api",
  },
] as const;

export type TtsProvider = "piper" | "elevenlabs";
export type LlmProvider = "openai" | "anthropic";
export type AggregatorProvider = "kie-ai" | "freepik";
export type SettingsTab = "general" | "api-keys" | "mcp";

export interface SettingsState {
  // General preferences
  autoSave: boolean;
  autoSaveInterval: number;
  language: string;

  // AI/Service preferences
  defaultTtsProvider: TtsProvider;
  defaultLlmProvider: LlmProvider;
  /** Selected model id for the agent chat (per the current LLM provider). */
  llmModel: string;
  defaultAggregator: AggregatorProvider;
  elevenLabsModel: string;
  favoriteVoices: Array<{ voiceId: string; name: string; previewUrl?: string }>;
  favoriteModels: Array<{ modelId: string; name: string }>;
  configuredServices: string[]; // IDs of services with stored API keys

  /** Desktop MCP server: auto-allow destructive/expensive tools from trusted local clients. */
  mcpAutoAllowTrustedLocal: boolean;

  /** Agent chat: auto-approve destructive/expensive tools instead of prompting. */
  agentAutoConfirm: boolean;
  /** Agent chat: plan tools without applying mutations. */
  agentDryRun: boolean;

  // Session-scoped API caches (cleared on session lock, not persisted)
  cachedElevenLabsVoices: Array<{ voice_id: string; name: string; category: string; labels: Record<string, string>; preview_url?: string }> | null;
  cachedElevenLabsModels: Array<{ model_id: string; name: string; description?: string; can_do_text_to_speech?: boolean; languages?: Array<{ language_id: string; name: string }> }> | null;

  // Settings dialog state
  settingsOpen: boolean;
  settingsTab: SettingsTab;

  // Actions
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveInterval: (minutes: number) => void;
  setLanguage: (lang: string) => void;
  setDefaultTtsProvider: (provider: TtsProvider) => void;
  setDefaultLlmProvider: (provider: LlmProvider) => void;
  setLlmModel: (model: string) => void;
  setMcpAutoAllowTrustedLocal: (enabled: boolean) => void;
  setAgentAutoConfirm: (enabled: boolean) => void;
  setAgentDryRun: (enabled: boolean) => void;
  setDefaultAggregator: (provider: AggregatorProvider) => void;
  setElevenLabsModel: (model: string) => void;
  addFavoriteVoice: (voice: { voiceId: string; name: string; previewUrl?: string }) => void;
  removeFavoriteVoice: (voiceId: string) => void;
  addFavoriteModel: (model: { modelId: string; name: string }) => void;
  removeFavoriteModel: (modelId: string) => void;
  addConfiguredService: (serviceId: string) => void;
  removeConfiguredService: (serviceId: string) => void;
  setCachedElevenLabsVoices: (voices: SettingsState["cachedElevenLabsVoices"]) => void;
  setCachedElevenLabsModels: (models: SettingsState["cachedElevenLabsModels"]) => void;
  clearApiCaches: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        autoSave: true,
        autoSaveInterval: 5,
        language: detectInitialLanguage(),

        defaultTtsProvider: "piper" as TtsProvider,
        defaultLlmProvider: "openai" as LlmProvider,
        llmModel: "gpt-4o",
        defaultAggregator: "kie-ai" as AggregatorProvider,
        elevenLabsModel: "eleven_v3",
        favoriteVoices: [],
        favoriteModels: [],
        configuredServices: [],

        mcpAutoAllowTrustedLocal: true,
        agentAutoConfirm: false,
        agentDryRun: false,

        cachedElevenLabsVoices: null,
        cachedElevenLabsModels: null,

        settingsOpen: false,
        settingsTab: "general" as SettingsTab,

        setAutoSave: (enabled: boolean) => set({ autoSave: enabled }),

        setAutoSaveInterval: (minutes: number) =>
          set({ autoSaveInterval: Math.max(1, Math.min(30, minutes)) }),

        setLanguage: (lang: string) => {
          set({ language: lang });
          // Load the locale bundle first so the re-render lands with translations ready.
          // If the user picked another language while this bundle was loading, leave
          // the newer selection in charge instead of clobbering it.
          void ensureLocaleLoaded(lang).then(async () => {
            if (get().language !== lang) return;
            await i18n.changeLanguage(lang);
          });
        },

        setDefaultTtsProvider: (provider: TtsProvider) =>
          set({ defaultTtsProvider: provider }),

        setDefaultLlmProvider: (provider: LlmProvider) =>
          set({ defaultLlmProvider: provider }),

        setLlmModel: (model: string) => set({ llmModel: model }),

        setMcpAutoAllowTrustedLocal: (enabled: boolean) =>
          set({ mcpAutoAllowTrustedLocal: enabled }),

        setAgentAutoConfirm: (enabled: boolean) => set({ agentAutoConfirm: enabled }),

        setAgentDryRun: (enabled: boolean) => set({ agentDryRun: enabled }),

        setDefaultAggregator: (provider: AggregatorProvider) =>
          set({ defaultAggregator: provider }),

        setElevenLabsModel: (model: string) =>
          set({ elevenLabsModel: model }),

        addFavoriteVoice: (voice) => {
          const { favoriteVoices } = get();
          if (!favoriteVoices.some((v) => v.voiceId === voice.voiceId)) {
            set({ favoriteVoices: [...favoriteVoices, voice] });
          }
        },

        removeFavoriteVoice: (voiceId: string) => {
          const { favoriteVoices } = get();
          set({ favoriteVoices: favoriteVoices.filter((v) => v.voiceId !== voiceId) });
        },

        addFavoriteModel: (model) => {
          const { favoriteModels } = get();
          if (!favoriteModels.some((m) => m.modelId === model.modelId)) {
            set({ favoriteModels: [...favoriteModels, model] });
          }
        },

        removeFavoriteModel: (modelId: string) => {
          const { favoriteModels } = get();
          set({ favoriteModels: favoriteModels.filter((m) => m.modelId !== modelId) });
        },

        addConfiguredService: (serviceId: string) => {
          const { configuredServices } = get();
          if (!configuredServices.includes(serviceId)) {
            set({ configuredServices: [...configuredServices, serviceId] });
          }
        },

        removeConfiguredService: (serviceId: string) => {
          const { configuredServices } = get();
          set({
            configuredServices: configuredServices.filter((id) => id !== serviceId),
          });
        },

        setCachedElevenLabsVoices: (voices) =>
          set({ cachedElevenLabsVoices: voices }),

        setCachedElevenLabsModels: (models) =>
          set({ cachedElevenLabsModels: models }),

        clearApiCaches: () =>
          set({ cachedElevenLabsVoices: null, cachedElevenLabsModels: null }),

        openSettings: (tab?: SettingsTab) =>
          set({
            settingsOpen: true,
            settingsTab: tab ?? get().settingsTab,
          }),

        closeSettings: () => set({ settingsOpen: false }),
      }),
      {
        name: "openreel-settings",
        version: 2,
        migrate: (persisted, version) => {
          const next = (persisted ?? {}) as Record<string, unknown>;
          if (version < 2) next.mcpAutoAllowTrustedLocal = true;
          return next as unknown as SettingsState;
        },
        partialize: (state) => ({
          autoSave: state.autoSave,
          autoSaveInterval: state.autoSaveInterval,
          language: state.language,
          defaultTtsProvider: state.defaultTtsProvider,
          defaultLlmProvider: state.defaultLlmProvider,
          llmModel: state.llmModel,
          defaultAggregator: state.defaultAggregator,
          elevenLabsModel: state.elevenLabsModel,
          favoriteVoices: state.favoriteVoices,
          favoriteModels: state.favoriteModels,
          configuredServices: state.configuredServices,
          mcpAutoAllowTrustedLocal: state.mcpAutoAllowTrustedLocal,
          agentAutoConfirm: state.agentAutoConfirm,
          agentDryRun: state.agentDryRun,
        }),
      },
    ),
  ),
);

// Clear API caches when the secure session locks
onSessionLock(() => {
  useSettingsStore.getState().clearApiCaches();
});
