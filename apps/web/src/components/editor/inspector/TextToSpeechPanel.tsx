import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Mic,
  Play,
  Pause,
  Plus,
  Loader2,
  Volume2,
  User,
  Download,
  FolderPlus,
  Settings,
  Search,
  Star,
  StarOff,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Slider, Switch } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { isSessionUnlocked, getSecret } from "../../../services/secure-storage";
import { apiFetch } from "../../../services/api-proxy";
import { OPENREEL_TTS_URL } from "../../../config/api-endpoints";

type TtsProvider = "piper" | "elevenlabs";

const TTS_PROVIDERS = [
  { id: "piper" as const, label: "Piper (Free)", description: "Built-in open-source TTS" },
  { id: "elevenlabs" as const, label: "ElevenLabs", description: "Premium AI voices" },
];

// Fallback models used when the API is unavailable
const FALLBACK_MODELS: ElevenLabsModel[] = [
  { model_id: "eleven_v3", name: "Eleven v3", description: "Latest ElevenLabs model", can_do_text_to_speech: true, languages: [] },
];

const ENHANCE_SYSTEM_PROMPT = `You are a professional voice director transforming text into expressive, emotionally rich scripts for ElevenLabs v3 TTS. Your goal is to turn narration into performance.

Analyze the input for speaker intent, emotional arc, subtext, physical state, relationship dynamics, pacing needs, and environmental context.

Use the 4-Layer System: Delivery (HOW), Tone (emotional color), Texture (voice quality), Subtext (what's beneath). Layer 1-3 tags per emotional beat.

Available tags include: [authoritatively], [hesitantly], [breathlessly], [whispered], [softly], [sighs], [chuckles], [laughs], [sobs], [gasps], [pause:200ms], and many more.

Rules: Do not alter original text. Do not over-tag. Do not use conflicting tags. Output ONLY enhanced text with tags, no explanations.`;

interface ElevenLabsModel {
  model_id: string;
  name: string;
  description?: string;
  can_do_text_to_speech?: boolean;
  languages?: Array<{ language_id: string; name: string }>;
}

interface Voice {
  id: string;
  name: string;
  gender: "male" | "female";
  language: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url?: string;
}

const PIPER_VOICES: Voice[] = [
  { id: "amy", name: "Amy", gender: "female", language: "en-US" },
  { id: "ryan", name: "Ryan", gender: "male", language: "en-US" },
];

export const TextToSpeechPanel: React.FC = () => {
  const importMedia = useProjectStore((state) => state.importMedia);
  const project = useProjectStore((state) => state.project);
  const {
    defaultTtsProvider,
    defaultLlmProvider,
    openSettings,
    settingsOpen,
    configuredServices,
    elevenLabsModel,
    setElevenLabsModel,
    favoriteVoices,
    addFavoriteVoice,
    removeFavoriteVoice,
    favoriteModels,
    addFavoriteModel,
    removeFavoriteModel,
    cachedElevenLabsVoices,
    cachedElevenLabsModels,
    setCachedElevenLabsVoices,
    setCachedElevenLabsModels,
  } = useSettingsStore();

  const defaultProvider: TtsProvider =
    defaultTtsProvider === "elevenlabs" && configuredServices.includes("elevenlabs")
      ? "elevenlabs"
      : "piper";

  const [provider, setProvider] = useState<TtsProvider>(defaultProvider);
  const [text, setText] = useState("");
  const [selectedVoice, setSelectedVoice] = useState<string>(
    defaultProvider === "elevenlabs" && favoriteVoices.length > 0
      ? favoriteVoices[0].voiceId
      : "amy",
  );
  const [speed, setSpeed] = useState(1.0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [generatedAudio, setGeneratedAudio] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enhanceText, setEnhanceText] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null);

  // Voice search state
  const [voiceSearch, setVoiceSearch] = useState("");
  const [allVoices, setAllVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  // Model state
  const [allModels, setAllModels] = useState<ElevenLabsModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const hasElevenLabsKey = configuredServices.includes("elevenlabs");

  // Fetch ElevenLabs models from API
  const fetchModels = useCallback(async () => {
    if (cachedElevenLabsModels) {
      setAllModels(cachedElevenLabsModels);
      return;
    }

    if (!isSessionUnlocked()) {
      setAllModels(FALLBACK_MODELS);
      return;
    }

    const apiKey = await getSecret("elevenlabs");
    if (!apiKey) {
      setAllModels(FALLBACK_MODELS);
      return;
    }

    setIsLoadingModels(true);
    try {
      const response = await apiFetch("elevenlabs", "/models", apiKey);

      if (!response.ok) throw new Error("Failed to fetch models");

      const data = await response.json();
      // API returns an array of Model objects directly
      const models = (Array.isArray(data) ? data : []) as ElevenLabsModel[];
      // Only keep TTS-capable models
      const ttsModels = models.filter((m) => m.can_do_text_to_speech !== false);
      setCachedElevenLabsModels(ttsModels);
      setAllModels(ttsModels);
    } catch {
      setAllModels(FALLBACK_MODELS);
    } finally {
      setIsLoadingModels(false);
    }
  }, [cachedElevenLabsModels, setCachedElevenLabsModels]);

  // Fetch ElevenLabs voices
  const fetchVoices = useCallback(async () => {
    if (cachedElevenLabsVoices) {
      setAllVoices(cachedElevenLabsVoices);
      return;
    }

    if (!isSessionUnlocked()) return;

    const apiKey = await getSecret("elevenlabs");
    if (!apiKey) return;

    setIsLoadingVoices(true);
    try {
      const response = await apiFetch("elevenlabs", "/voices", apiKey);

      if (!response.ok) throw new Error("Failed to fetch voices");

      const data = await response.json();
      const voices = (data.voices ?? []) as ElevenLabsVoice[];
      setCachedElevenLabsVoices(voices);
      setAllVoices(voices);
    } catch {
      // Silently fail — user can still use favorites
    } finally {
      setIsLoadingVoices(false);
    }
  }, [cachedElevenLabsVoices, setCachedElevenLabsVoices]);

  useEffect(() => {
    if (provider === "elevenlabs" && hasElevenLabsKey) {
      if (allVoices.length === 0) fetchVoices();
      if (allModels.length === 0) fetchModels();
    }
  }, [provider, hasElevenLabsKey, allVoices.length, allModels.length, fetchVoices, fetchModels]);

  // Re-fetch when settings dialog closes (user may have just unlocked the session)
  const prevSettingsOpen = useRef(settingsOpen);
  useEffect(() => {
    if (prevSettingsOpen.current && !settingsOpen) {
      // Settings just closed — re-check if session is now unlocked
      if (provider === "elevenlabs" && hasElevenLabsKey && isSessionUnlocked()) {
        if (allVoices.length === 0) fetchVoices();
        if (allModels.length === 0) fetchModels();
      }
    }
    prevSettingsOpen.current = settingsOpen;
  }, [settingsOpen, provider, hasElevenLabsKey, allVoices.length, allModels.length, fetchVoices, fetchModels]);

  // Preview a voice sample
  const previewVoice = useCallback((previewUrl?: string, voiceId?: string) => {
    if (!previewUrl) return;

    // Toggle off if already previewing this voice
    if (previewAudioRef.current && previewingVoice === voiceId) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewingVoice(null);
      return;
    }

    // Stop any currently playing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    setPreviewingVoice(voiceId ?? null);

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    previewAudioRef.current = audio;

    audio.onended = () => {
      previewAudioRef.current = null;
      setPreviewingVoice(null);
    };
    audio.onerror = () => {
      previewAudioRef.current = null;
      setPreviewingVoice(null);
    };

    audio.src = previewUrl;
    audio.play().catch(() => {
      previewAudioRef.current = null;
      setPreviewingVoice(null);
    });
  }, [previewingVoice]);

  const isFavoriteVoice = useCallback(
    (voiceId: string) => favoriteVoices.some((v) => v.voiceId === voiceId),
    [favoriteVoices],
  );

  const isFavoriteModel = useCallback(
    (modelId: string) => favoriteModels.some((m) => m.modelId === modelId),
    [favoriteModels],
  );

  const toggleFavoriteVoice = useCallback(
    (voice: ElevenLabsVoice) => {
      if (isFavoriteVoice(voice.voice_id)) {
        removeFavoriteVoice(voice.voice_id);
      } else {
        addFavoriteVoice({
          voiceId: voice.voice_id,
          name: voice.name,
          previewUrl: voice.preview_url,
        });
      }
    },
    [isFavoriteVoice, addFavoriteVoice, removeFavoriteVoice],
  );

  const toggleFavoriteModel = useCallback(
    (model: ElevenLabsModel) => {
      if (isFavoriteModel(model.model_id)) {
        removeFavoriteModel(model.model_id);
      } else {
        addFavoriteModel({
          modelId: model.model_id,
          name: model.name,
        });
      }
    },
    [isFavoriteModel, addFavoriteModel, removeFavoriteModel],
  );

  // Filtered voices for search
  const filteredVoices = allVoices.filter((v) => {
    if (!voiceSearch.trim()) return true;
    const q = voiceSearch.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.category?.toLowerCase().includes(q) ||
      Object.values(v.labels || {}).some((l) => l.toLowerCase().includes(q))
    );
  });

  // Get display name for currently selected voice
  const getSelectedVoiceName = useCallback((): string => {
    if (provider === "piper") {
      return PIPER_VOICES.find((v) => v.id === selectedVoice)?.name ?? "TTS";
    }
    const fav = favoriteVoices.find((v) => v.voiceId === selectedVoice);
    if (fav) return fav.name;
    const apiVoice = allVoices.find((v) => v.voice_id === selectedVoice);
    if (apiVoice) return apiVoice.name;
    return "TTS";
  }, [provider, selectedVoice, favoriteVoices, allVoices]);

  // Get display name for currently selected model
  const getSelectedModelName = useCallback((): string => {
    const model = allModels.find((m) => m.model_id === elevenLabsModel);
    if (model) return model.name;
    const favModel = favoriteModels.find((m) => m.modelId === elevenLabsModel);
    if (favModel) return favModel.name;
    return elevenLabsModel;
  }, [elevenLabsModel, allModels, favoriteModels]);

  const generateWithPiper = useCallback(async (inputText: string, voice: string, spd: number): Promise<Blob> => {
    const response = await fetch(`${OPENREEL_TTS_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: inputText, voice, speed: spd }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "Rate limit reached. Please wait a minute. Free service is limited to 10 req/min.",
        );
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || errorData.error || "Failed to generate speech");
    }

    return response.blob();
  }, []);

  const generateWithElevenLabs = useCallback(async (inputText: string, voiceId: string): Promise<Blob> => {
    if (!isSessionUnlocked()) {
      throw new Error("Session locked. Unlock in Settings > API Keys first.");
    }

    const apiKey = await getSecret("elevenlabs");
    if (!apiKey) {
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
  }, [elevenLabsModel]);

  const enhanceViaLlm = useCallback(async (inputText: string): Promise<string> => {
    const llmProvider = defaultLlmProvider;

    if (!isSessionUnlocked()) {
      throw new Error("Session locked. Unlock in Settings > API Keys to use text enhancement.");
    }

    const apiKey = await getSecret(llmProvider);
    if (!apiKey) {
      throw new Error(`${llmProvider === "openai" ? "OpenAI" : "Anthropic"} API key not found. Add it in Settings > API Keys.`);
    }

    if (llmProvider === "anthropic") {
      const response = await apiFetch("anthropic", "/messages", apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: ENHANCE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: inputText }],
        }),
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

    // OpenAI
    const response = await apiFetch("openai", "/chat/completions", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: ENHANCE_SYSTEM_PROMPT },
          { role: "user", content: inputText },
        ],
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = (err as Record<string, unknown>).error;
      throw new Error(msg ? String((msg as Record<string, unknown>).message ?? msg) : `OpenAI error (${response.status})`);
    }

    const data = await response.json();
    const choices = (data as { choices: Array<{ message: { content: string } }> }).choices;
    return choices?.[0]?.message?.content ?? inputText;
  }, [defaultLlmProvider]);

  // Step 1: Enhance text via LLM (shows editable preview, waits for approval)
  const handleEnhance = useCallback(async () => {
    if (!text.trim()) {
      setError("Please enter some text");
      return;
    }

    setIsEnhancing(true);
    setError(null);

    try {
      const result = await enhanceViaLlm(text.trim());
      setEnhancedPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enhance text");
    } finally {
      setIsEnhancing(false);
    }
  }, [text, enhanceViaLlm]);

  // Step 2: Generate speech (uses enhanced text if available and approved)
  const generateSpeech = useCallback(async () => {
    if (!text.trim() && !enhancedPreview) {
      setError("Please enter some text");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedAudio(null);

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    try {
      // Use enhanced text if available, otherwise original
      const finalText = (enhanceText && enhancedPreview) ? enhancedPreview : text.trim();

      const blob = provider === "elevenlabs"
        ? await generateWithElevenLabs(finalText, selectedVoice)
        : await generateWithPiper(finalText, selectedVoice, speed);

      setGeneratedAudio(blob);

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      if (audioRef.current) {
        audioRef.current.src = url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate speech");
    } finally {
      setIsGenerating(false);
    }
  }, [text, enhancedPreview, enhanceText, selectedVoice, speed, provider, generateWithPiper, generateWithElevenLabs]);

  const togglePlayback = useCallback(() => {
    if (!audioRef.current || !audioUrlRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const importToMediaAssets = useCallback(async (): Promise<string | null> => {
    if (!generatedAudio || !project) return null;

    const voiceName = getSelectedVoiceName();
    const timestamp = Date.now();
    const fileName = `${voiceName}_${timestamp}.wav`;

    const file = new File([generatedAudio], fileName, { type: "audio/wav" });
    const importResult = await importMedia(file);

    if (!importResult.success || !importResult.actionId) {
      const errorMsg =
        typeof importResult.error === "string"
          ? importResult.error
          : "Failed to import audio";
      throw new Error(errorMsg);
    }

    return importResult.actionId;
  }, [generatedAudio, project, getSelectedVoiceName, importMedia]);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const saveToMedia = useCallback(async () => {
    if (!generatedAudio || !project) return;

    setIsGenerating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await importToMediaAssets();
      setSuccessMsg("Saved to Media Assets");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save to media");
    } finally {
      setIsGenerating(false);
    }
  }, [generatedAudio, project, importToMediaAssets]);

  const addToTimeline = useCallback(async () => {
    if (!generatedAudio || !project) return;

    setIsGenerating(true);
    setError(null);

    try {
      const mediaId = await importToMediaAssets();
      if (!mediaId) return;

      const { addClipToNewTrack } = useProjectStore.getState();
      await addClipToNewTrack(mediaId);

      setText("");
      setGeneratedAudio(null);
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to timeline");
    } finally {
      setIsGenerating(false);
    }
  }, [generatedAudio, project, importToMediaAssets]);

  const downloadAudio = useCallback(() => {
    if (!generatedAudio) return;

    const voiceName = getSelectedVoiceName();
    const timestamp = Date.now();
    const fileName = `${voiceName}_${timestamp}.wav`;

    const url = URL.createObjectURL(generatedAudio);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedAudio, getSelectedVoiceName]);

  const charCount = text.length;
  const maxChars = 5000;

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      <audio ref={audioRef} onEnded={handleAudioEnded} className="hidden" />

      <div className="flex items-center justify-between p-2 bg-primary/10 rounded-lg border border-primary/30">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-primary" />
          <div>
            <span className="text-[11px] font-medium text-text-primary">
              Text to Speech
            </span>
            <p className="text-[9px] text-text-muted">AI voice generation</p>
          </div>
        </div>
        <button
          onClick={() => openSettings("api-keys")}
          className="p-1.5 rounded-md hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
          title="API Key Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      {/* Provider selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Provider
        </label>
        <div className="flex gap-1.5">
          {TTS_PROVIDERS.map((p) => {
            const isDisabled = p.id === "elevenlabs" && !hasElevenLabsKey;
            return (
              <button
                key={p.id}
                onClick={() => {
                  if (isDisabled) {
                    openSettings("api-keys");
                    return;
                  }
                  setProvider(p.id);
                  setSelectedVoice(
                    p.id === "elevenlabs"
                      ? (favoriteVoices.length > 0 ? favoriteVoices[0].voiceId : "")
                      : "amy",
                  );
                  setGeneratedAudio(null);
                  setShowAllVoices(false);
                  setShowAllModels(false);
                }}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] transition-colors ${
                  provider === p.id
                    ? "bg-primary text-white font-medium"
                    : isDisabled
                      ? "bg-background-tertiary text-text-muted border border-border opacity-60 cursor-default"
                      : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                }`}
                title={isDisabled ? "Add ElevenLabs API key in Settings" : p.description}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Model selector (ElevenLabs only) */}
      {provider === "elevenlabs" && hasElevenLabsKey && (
        <div className="space-y-2">
          <label className="text-[10px] font-medium text-text-secondary">
            Model
          </label>

          {/* Favorite models */}
          {favoriteModels.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[9px] text-text-muted flex items-center gap-1">
                <Star size={9} className="text-amber-400 fill-amber-400" /> Favorite Models
              </span>
              <div className="flex flex-wrap gap-1.5">
                {favoriteModels.map((fav) => (
                  <button
                    key={fav.modelId}
                    onClick={() => setElevenLabsModel(fav.modelId)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                      elevenLabsModel === fav.modelId
                        ? "bg-primary text-white font-medium"
                        : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                    }`}
                  >
                    <Star size={8} className="text-amber-400 fill-amber-400" />
                    <span>{fav.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current model display + browse toggle */}
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-8 px-2 rounded-lg border border-border bg-background-tertiary text-[10px] text-text-primary flex items-center justify-between cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setShowAllModels(!showAllModels)}
            >
              <span className="truncate">
                {isLoadingModels ? "Loading models..." : getSelectedModelName()}
              </span>
              <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${showAllModels ? "rotate-180" : ""}`} />
            </div>
          </div>

          {/* Model browser */}
          {showAllModels && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="max-h-48 overflow-y-auto">
                {allModels.length === 0 ? (
                  <div className="p-3 text-center text-[10px] text-text-muted">
                    {isLoadingModels ? "Loading models..." : "No models available"}
                  </div>
                ) : (
                  allModels.map((model) => {
                    const isSelected = elevenLabsModel === model.model_id;
                    const isFav = isFavoriteModel(model.model_id);
                    const langCount = model.languages?.length ?? 0;

                    return (
                      <div
                        key={model.model_id}
                        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary/10 border-l-2 border-primary"
                            : "hover:bg-background-tertiary border-l-2 border-transparent"
                        }`}
                        onClick={() => {
                          setElevenLabsModel(model.model_id);
                          setShowAllModels(false);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-text-primary truncate">
                              {model.name}
                            </span>
                          </div>
                          <div className="text-[8px] text-text-muted truncate">
                            {model.description
                              ? (model.description.length > 80 ? model.description.slice(0, 80) + "..." : model.description)
                              : ""}
                            {langCount > 0 && ` · ${langCount} languages`}
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavoriteModel(model);
                          }}
                          className={`p-1 rounded hover:bg-background-elevated transition-colors shrink-0 ${
                            isFav ? "text-amber-400" : "text-text-muted hover:text-amber-400"
                          }`}
                          title={isFav ? "Remove from favorites" : "Add to favorites"}
                        >
                          {isFav ? (
                            <Star size={10} className="fill-current" />
                          ) : (
                            <StarOff size={10} />
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-2 py-1 border-t border-border bg-background-secondary text-[8px] text-text-muted text-center">
                {allModels.length} models available
              </div>
            </div>
          )}
        </div>
      )}

      {/* Text input */}
      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Text
        </label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setEnhancedPreview(null); }}
          placeholder="Enter the text you want to convert to speech..."
          className="w-full h-24 px-3 py-2 text-[11px] bg-background-tertiary rounded-lg border border-border focus:border-primary focus:outline-none resize-none"
          maxLength={maxChars}
        />
        <div className="flex items-center justify-between">
          {/* Enhance toggle (ElevenLabs only) */}
          {provider === "elevenlabs" ? (
            <div className="flex items-center gap-1.5">
              <Switch
                checked={enhanceText}
                onCheckedChange={setEnhanceText}
                className="scale-75 origin-left"
              />
              <label className="text-[9px] text-text-muted flex items-center gap-1 cursor-pointer" onClick={() => setEnhanceText(!enhanceText)}>
                <Sparkles size={10} className={enhanceText ? "text-amber-400" : ""} />
                Enhance for TTS
              </label>
            </div>
          ) : (
            <div />
          )}
          <span
            className={`text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-text-muted"}`}
          >
            {charCount}/{maxChars}
          </span>
        </div>

        {/* Enhanced text preview — editable */}
        {enhancedPreview && enhanceText && (
          <div className="p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Sparkles size={9} className="text-amber-400" />
                <span className="text-[9px] font-medium text-amber-400">Enhanced — edit below then Generate</span>
              </div>
              <button
                onClick={() => setEnhancedPreview(null)}
                className="text-[9px] text-text-muted hover:text-red-400 transition-colors"
              >
                Discard
              </button>
            </div>
            <textarea
              value={enhancedPreview}
              onChange={(e) => setEnhancedPreview(e.target.value)}
              className="w-full h-24 px-2 py-1.5 text-[10px] bg-background-tertiary rounded-md border border-amber-500/20 focus:border-amber-500/50 focus:outline-none resize-none text-text-primary leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* Voice selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Voice
        </label>

        {provider === "piper" ? (
          /* Piper: simple buttons */
          <div className="flex flex-wrap gap-1.5">
            {PIPER_VOICES.map((voice) => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] transition-colors ${
                  selectedVoice === voice.id
                    ? "bg-primary text-white font-medium"
                    : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                }`}
              >
                <User size={10} />
                <span>{voice.name}</span>
                <span className="text-[8px] opacity-70">{voice.gender === "female" ? "F" : "M"}</span>
              </button>
            ))}
          </div>
        ) : (
          /* ElevenLabs: favorites + searchable voice browser */
          <div className="space-y-2">
            {/* Favorites */}
            {favoriteVoices.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[9px] text-text-muted flex items-center gap-1">
                  <Star size={9} className="text-amber-400 fill-amber-400" /> Favorites
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {favoriteVoices.map((fav) => (
                    <button
                      key={fav.voiceId}
                      onClick={() => setSelectedVoice(fav.voiceId)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                        selectedVoice === fav.voiceId
                          ? "bg-primary text-white font-medium"
                          : "bg-background-tertiary text-text-secondary hover:text-text-primary border border-border"
                      }`}
                    >
                      <Star size={8} className="text-amber-400 fill-amber-400" />
                      <span>{fav.name}</span>
                      {fav.previewUrl && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            previewVoice(fav.previewUrl, fav.voiceId);
                          }}
                          className="ml-0.5 opacity-60 hover:opacity-100"
                          title="Preview voice"
                        >
                          {previewingVoice === fav.voiceId ? (
                            <Pause size={8} />
                          ) : (
                            <Play size={8} />
                          )}
                        </button>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Browse all voices toggle */}
            <button
              onClick={() => setShowAllVoices(!showAllVoices)}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] border border-dashed border-border text-text-muted hover:text-text-primary hover:border-primary/50 transition-colors"
            >
              <Search size={10} />
              {showAllVoices ? "Hide voice browser" : "Browse & search voices"}
              <ChevronDown size={10} className={`transition-transform ${showAllVoices ? "rotate-180" : ""}`} />
            </button>

            {/* Voice browser */}
            {showAllVoices && (
              <div className="border border-border rounded-lg overflow-hidden">
                {/* Search input */}
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-background-secondary">
                  <Search size={12} className="text-text-muted shrink-0" />
                  <input
                    type="text"
                    value={voiceSearch}
                    onChange={(e) => setVoiceSearch(e.target.value)}
                    placeholder="Search by name, accent, gender..."
                    className="flex-1 bg-transparent text-[10px] text-text-primary placeholder:text-text-muted focus:outline-none"
                    autoFocus
                  />
                  {isLoadingVoices && <Loader2 size={12} className="animate-spin text-text-muted" />}
                </div>

                {/* Voice list */}
                <div className="max-h-48 overflow-y-auto">
                  {filteredVoices.length === 0 ? (
                    <div className="p-3 text-center text-[10px] text-text-muted">
                      {isLoadingVoices ? "Loading voices..." : allVoices.length === 0 ? (
                        <button
                          onClick={() => openSettings("api-keys")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors font-medium"
                        >
                          <Settings size={12} />
                          Unlock session to browse voices
                        </button>
                      ) : "No voices match your search"}
                    </div>
                  ) : (
                    filteredVoices.map((voice) => {
                      const gender = voice.labels?.gender ?? "";
                      const accent = voice.labels?.accent ?? "";
                      const isSelected = selectedVoice === voice.voice_id;
                      const isFav = isFavoriteVoice(voice.voice_id);

                      return (
                        <div
                          key={voice.voice_id}
                          className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-primary/10 border-l-2 border-primary"
                              : "hover:bg-background-tertiary border-l-2 border-transparent"
                          }`}
                          onClick={() => setSelectedVoice(voice.voice_id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-medium text-text-primary truncate">
                                {voice.name}
                              </span>
                              {voice.category === "cloned" && (
                                <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                  Cloned
                                </span>
                              )}
                            </div>
                            <div className="text-[8px] text-text-muted">
                              {[gender, accent, voice.category].filter(Boolean).join(" · ")}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {voice.preview_url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  previewVoice(voice.preview_url, voice.voice_id);
                                }}
                                className="p-1 rounded hover:bg-background-elevated text-text-muted hover:text-text-primary transition-colors"
                                title="Preview"
                              >
                                {previewingVoice === voice.voice_id ? (
                                  <Pause size={10} />
                                ) : (
                                  <Play size={10} />
                                )}
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavoriteVoice(voice);
                              }}
                              className={`p-1 rounded hover:bg-background-elevated transition-colors ${
                                isFav ? "text-amber-400" : "text-text-muted hover:text-amber-400"
                              }`}
                              title={isFav ? "Remove from favorites" : "Add to favorites"}
                            >
                              {isFav ? (
                                <Star size={10} className="fill-current" />
                              ) : (
                                <StarOff size={10} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="px-2 py-1 border-t border-border bg-background-secondary text-[8px] text-text-muted text-center">
                  {filteredVoices.length} of {allVoices.length} voices
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Speed (Piper only) */}
      {provider === "piper" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-text-secondary">
              Speed
            </label>
            <span className="text-[10px] text-text-muted">
              {speed.toFixed(1)}x
            </span>
          </div>
          <Slider
            min={0.5}
            max={2.0}
            step={0.1}
            value={[speed]}
            onValueChange={(value) => setSpeed(value[0])}
          />
          <div className="flex justify-between text-[8px] text-text-muted">
            <span>0.5x</span>
            <span>1.0x</span>
            <span>2.0x</span>
          </div>
        </div>
      )}

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between gap-2">
          <p className="text-[10px] text-red-400">{error}</p>
          {error.includes("API key") || error.includes("Session locked") || error.includes("Unlock") ? (
            <button
              onClick={() => openSettings("api-keys")}
              className="shrink-0 px-2 py-1 rounded text-[9px] font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
            >
              Open Settings
            </button>
          ) : null}
        </div>
      )}

      {successMsg && (
        <div className="p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-[10px] text-green-400">{successMsg}</p>
        </div>
      )}

      {/* Enhance button: shown when toggle is on and no enhanced text yet */}
      {enhanceText && provider === "elevenlabs" && !enhancedPreview && (
        <button
          onClick={handleEnhance}
          disabled={isEnhancing || !text.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg text-[11px] font-medium transition-all hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isEnhancing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Enhancing...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Enhance Text
            </>
          )}
        </button>
      )}

      {/* Generate button */}
      <button
        onClick={generateSpeech}
        disabled={isGenerating || !text.trim() || (provider === "elevenlabs" && !selectedVoice) || (enhanceText && provider === "elevenlabs" && !enhancedPreview)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg text-[11px] font-medium transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Volume2 size={14} />
            Generate Speech
          </>
        )}
      </button>

      {generatedAudio && (
        <div className="p-3 bg-background-tertiary rounded-lg border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Volume2 size={14} className="text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-medium text-text-primary">
                  {getSelectedVoiceName()} Voice
                </p>
                <p className="text-[9px] text-text-muted">
                  {(generatedAudio.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <button
              onClick={togglePlayback}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white hover:opacity-90 transition-opacity"
            >
              {isPlaying ? (
                <Pause size={14} />
              ) : (
                <Play size={14} className="ml-0.5" />
              )}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={saveToMedia}
              disabled={isGenerating}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-[10px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <FolderPlus size={12} />
              Save to Media
            </button>
            <button
              onClick={addToTimeline}
              disabled={isGenerating}
              className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              title="Add to Timeline"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={downloadAudio}
              className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              title="Download"
            >
              <Download size={12} />
            </button>
          </div>
        </div>
      )}

      <p className="text-[9px] text-text-muted text-center">
        Powered by {provider === "elevenlabs" ? "ElevenLabs" : "Piper TTS"}
        {provider === "elevenlabs" && ` · ${getSelectedModelName()}`}
      </p>
    </div>
  );
};

export default TextToSpeechPanel;
