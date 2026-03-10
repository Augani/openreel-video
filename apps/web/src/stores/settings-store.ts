import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";

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

export interface SettingsState {
  // General preferences
  autoSave: boolean;
  autoSaveInterval: number; // minutes
  language: string;

  // AI/Service preferences
  defaultTtsProvider: string;
  defaultLlmProvider: string;
  defaultAggregator: string;
  configuredServices: string[]; // IDs of services with stored API keys

  // Settings dialog state
  settingsOpen: boolean;
  settingsTab: string;

  // Actions
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveInterval: (minutes: number) => void;
  setLanguage: (lang: string) => void;
  setDefaultTtsProvider: (provider: string) => void;
  setDefaultLlmProvider: (provider: string) => void;
  setDefaultAggregator: (provider: string) => void;
  addConfiguredService: (serviceId: string) => void;
  removeConfiguredService: (serviceId: string) => void;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        autoSave: true,
        autoSaveInterval: 5,
        language: "en",

        defaultTtsProvider: "elevenlabs",
        defaultLlmProvider: "openai",
        defaultAggregator: "kie-ai",
        configuredServices: [],

        settingsOpen: false,
        settingsTab: "general",

        setAutoSave: (enabled: boolean) => set({ autoSave: enabled }),

        setAutoSaveInterval: (minutes: number) =>
          set({ autoSaveInterval: Math.max(1, Math.min(30, minutes)) }),

        setLanguage: (lang: string) => set({ language: lang }),

        setDefaultTtsProvider: (provider: string) =>
          set({ defaultTtsProvider: provider }),

        setDefaultLlmProvider: (provider: string) =>
          set({ defaultLlmProvider: provider }),

        setDefaultAggregator: (provider: string) =>
          set({ defaultAggregator: provider }),

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

        openSettings: (tab?: string) =>
          set({
            settingsOpen: true,
            settingsTab: tab ?? get().settingsTab,
          }),

        closeSettings: () => set({ settingsOpen: false }),
      }),
      {
        name: "openreel-settings",
        version: 1,
        partialize: (state) => ({
          autoSave: state.autoSave,
          autoSaveInterval: state.autoSaveInterval,
          language: state.language,
          defaultTtsProvider: state.defaultTtsProvider,
          defaultLlmProvider: state.defaultLlmProvider,
          defaultAggregator: state.defaultAggregator,
          configuredServices: state.configuredServices,
        }),
      },
    ),
  ),
);
