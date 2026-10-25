import { useState, useCallback, useRef, useEffect } from "react";
import type { LlmProvider } from "../../../../stores/settings-store";
import { useSettingsStore } from "../../../../stores/settings-store";
import { isSessionUnlocked, getSecret, ENV_ELEVENLABS_API_KEY } from "../../../../services/secure-storage";
import { apiFetch } from "../../../../services/api-proxy";
import type { ElevenLabsVoice, ElevenLabsModel } from "../tts-types";
import { FALLBACK_MODELS, ENHANCE_SYSTEM_PROMPT } from "../tts-constants";

interface UseElevenLabsApiOptions {
  hasElevenLabsKey: boolean;
  settingsOpen: boolean;
  elevenLabsModel: string;
  defaultLlmProvider: LlmProvider | null;
  llmBaseUrl: string;
  llmModel: string;
}

interface UseElevenLabsApiReturn {
  allVoices: ElevenLabsVoice[];
  allModels: ElevenLabsModel[];
  isLoadingVoices: boolean;
  isLoadingModels: boolean;
  generateWithElevenLabs: (text: string, voiceId: string, signal?: AbortSignal) => Promise<Blob>;
  enhanceViaLlm: (text: string, signal?: AbortSignal) => Promise<string>;
}

export function useElevenLabsApi(options: UseElevenLabsApiOptions): UseElevenLabsApiReturn {
  const {
    hasElevenLabsKey,
    settingsOpen,
    elevenLabsModel,
    defaultLlmProvider,
    llmBaseUrl,
    llmModel,
  } = options;

  const isDesktop = typeof window !== "undefined" && window.openreel?.platform === "desktop";

  const {
    cachedElevenLabsVoices,
    cachedElevenLabsModels,
    configuredServices,
    setCachedElevenLabsVoices,
    setCachedElevenLabsModels,
  } = useSettingsStore();

  const [allVoices, setAllVoices] = useState<ElevenLabsVoice[]>([]);
  const [allModels, setAllModels] = useState<ElevenLabsModel[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const prevSettingsOpen = useRef(settingsOpen);

  const getSignal = useCallback((): AbortSignal => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current.signal;
  }, []);

  const fetchModels = useCallback(async (signal?: AbortSignal) => {
    if (cachedElevenLabsModels) {
      setAllModels(cachedElevenLabsModels);
      return;
    }

    if (!ENV_ELEVENLABS_API_KEY && !isSessionUnlocked()) {
      setAllModels(FALLBACK_MODELS);
      return;
    }

    const apiKey = isDesktop ? "" : ENV_ELEVENLABS_API_KEY || ((await getSecret("elevenlabs")) ?? "");
    if (!isDesktop && !apiKey) {
      setAllModels(FALLBACK_MODELS);
      return;
    }

    setIsLoadingModels(true);
    try {
      const response = await apiFetch("elevenlabs", "/models", apiKey, { signal });

      if (!response.ok) throw new Error("Failed to fetch models");

      const data = await response.json();
      const models = (Array.isArray(data) ? data : []) as ElevenLabsModel[];
      const ttsModels = models.filter((m) => m.can_do_text_to_speech !== false);
      setCachedElevenLabsModels(ttsModels);
      setAllModels(ttsModels);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAllModels(FALLBACK_MODELS);
    } finally {
      setIsLoadingModels(false);
    }
  }, [cachedElevenLabsModels, setCachedElevenLabsModels, isDesktop]);

  const fetchVoices = useCallback(async (signal?: AbortSignal) => {
    if (cachedElevenLabsVoices) {
      setAllVoices(cachedElevenLabsVoices);
      return;
    }

    if (!ENV_ELEVENLABS_API_KEY && !isSessionUnlocked()) return;

    const apiKey = isDesktop ? "" : ENV_ELEVENLABS_API_KEY || ((await getSecret("elevenlabs")) ?? "");
    if (!isDesktop && !apiKey) return;

    setIsLoadingVoices(true);
    try {
      const response = await apiFetch("elevenlabs", "/voices", apiKey, { signal });

      if (!response.ok) throw new Error("Failed to fetch voices");

      const data = await response.json();
      const voices = (data.voices ?? []) as ElevenLabsVoice[];
      setCachedElevenLabsVoices(voices);
      setAllVoices(voices);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      setIsLoadingVoices(false);
    }
  }, [cachedElevenLabsVoices, setCachedElevenLabsVoices, isDesktop]);

  useEffect(() => {
    if (hasElevenLabsKey) {
      const signal = getSignal();
      if (allVoices.length === 0) fetchVoices(signal);
      if (allModels.length === 0) fetchModels(signal);
    }
  }, [hasElevenLabsKey, allVoices.length, allModels.length, fetchVoices, fetchModels, getSignal]);

  useEffect(() => {
    if (prevSettingsOpen.current && !settingsOpen) {
      if (hasElevenLabsKey && (ENV_ELEVENLABS_API_KEY || isSessionUnlocked())) {
        const signal = getSignal();
        if (allVoices.length === 0) fetchVoices(signal);
        if (allModels.length === 0) fetchModels(signal);
      }
    }
    prevSettingsOpen.current = settingsOpen;
  }, [settingsOpen, hasElevenLabsKey, allVoices.length, allModels.length, fetchVoices, fetchModels, getSignal]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const generateWithElevenLabs = useCallback(async (inputText: string, voiceId: string, signal?: AbortSignal): Promise<Blob> => {
    if (!ENV_ELEVENLABS_API_KEY && !isSessionUnlocked()) {
      throw new Error("Session locked. Unlock in Settings > API Keys first.");
    }

    const apiKey = isDesktop ? "" : ENV_ELEVENLABS_API_KEY || ((await getSecret("elevenlabs")) ?? "");
    if (!isDesktop && !apiKey) {
      throw new Error("ElevenLabs API key not found. Add it in Settings > API Keys.");
    }

    const response = await apiFetch(
      "elevenlabs",
      `/text-to-speech/${voiceId}`,
      apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText,
          model_id: elevenLabsModel,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal,
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = (errorData as Record<string, unknown>).detail
        ?? (errorData as Record<string, unknown>).message
        ?? `ElevenLabs error (${response.status})`;
      throw new Error(String(msg));
    }

    return response.blob();
  }, [elevenLabsModel, isDesktop]);

  const enhanceViaLlm = useCallback(async (inputText: string, signal?: AbortSignal): Promise<string> => {
    const llmProvider = defaultLlmProvider;
    const selectedModel = llmModel.trim();
    if (!llmProvider || !llmBaseUrl.trim() || !selectedModel) {
      throw new Error("Configure an AI endpoint and model before using text enhancement.");
    }
    const compatibleKeyConfigured = configuredServices.includes(llmProvider);

    if (compatibleKeyConfigured && !isSessionUnlocked()) {
      throw new Error("Session locked. Unlock in Settings > API Keys to use text enhancement.");
    }

    const apiKey =
      isDesktop || (!compatibleKeyConfigured && !isSessionUnlocked())
        ? ""
        : (await getSecret(llmProvider)) ?? "";

    if (llmProvider === "anthropic-compatible") {
      const response = await apiFetch(llmProvider, "/messages", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 2048,
          system: ENHANCE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: inputText }],
        }),
        baseUrl: llmBaseUrl,
        signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as Record<string, unknown>).error
          ? String((err as Record<string, unknown>).error)
          : `Anthropic error (${response.status})`);
      }

      const data = await response.json();
      const content = (data as { content: Array<{ type: string; text: string }> }).content;
      return content?.[0]?.text ?? inputText;
    }

    const response = await apiFetch(
      llmProvider,
      "/chat/completions",
      apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: "system", content: ENHANCE_SYSTEM_PROMPT },
            { role: "user", content: inputText },
          ],
        }),
        baseUrl: llmBaseUrl,
        signal,
      },
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err as Record<string, unknown>).error;
      throw new Error(msg ? String((msg as Record<string, unknown>).message ?? msg) : `OpenAI error (${response.status})`);
    }

    const data = await response.json();
    const choices = (data as { choices: Array<{ message: { content: string } }> }).choices;
    return choices?.[0]?.message?.content ?? inputText;
  }, [
    configuredServices,
    defaultLlmProvider,
    isDesktop,
    llmBaseUrl,
    llmModel,
  ]);

  return {
    allVoices,
    allModels,
    isLoadingVoices,
    isLoadingModels,
    generateWithElevenLabs,
    enhanceViaLlm,
  };
}
