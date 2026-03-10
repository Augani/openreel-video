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
  Settings,
  Search,
  Star,
  StarOff,
  ChevronDown,
} from "lucide-react";
import { Slider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { isSessionUnlocked, getSecret } from "../../../services/secure-storage";
import { OPENREEL_TTS_URL, ELEVENLABS_API_URL } from "../../../config/api-endpoints";

type TtsProvider = "piper" | "elevenlabs";

const TTS_PROVIDERS = [
  { id: "piper" as const, label: "Piper (Free)", description: "Built-in open-source TTS" },
  { id: "elevenlabs" as const, label: "ElevenLabs", description: "Premium AI voices" },
];

const ELEVENLABS_MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2", description: "Best quality, 29 languages" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", description: "Low latency, high quality" },
  { id: "eleven_turbo_v2", label: "Turbo v2", description: "Low latency, English optimized" },
  { id: "eleven_monolingual_v1", label: "English v1", description: "Legacy English model" },
];

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

// Voice cache to avoid re-fetching
let cachedElevenLabsVoices: ElevenLabsVoice[] | null = null;

export const TextToSpeechPanel: React.FC = () => {
  const importMedia = useProjectStore((state) => state.importMedia);
  const project = useProjectStore((state) => state.project);
  const {
    defaultTtsProvider,
    openSettings,
    configuredServices,
    elevenLabsModel,
    setElevenLabsModel,
    favoriteVoices,
    addFavoriteVoice,
    removeFavoriteVoice,
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

  // Voice search state
  const [voiceSearch, setVoiceSearch] = useState("");
  const [allVoices, setAllVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const hasElevenLabsKey = configuredServices.includes("elevenlabs");

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
      const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
        headers: { "xi-api-key": apiKey },
      });

      if (!response.ok) throw new Error("Failed to fetch voices");

      const data = await response.json();
      const voices = (data.voices ?? []) as ElevenLabsVoice[];
      cachedElevenLabsVoices = voices;
      setAllVoices(voices);
    } catch {
      // Silently fail — user can still use favorites
    } finally {
      setIsLoadingVoices(false);
    }
  }, []);

  useEffect(() => {
    if (provider === "elevenlabs" && hasElevenLabsKey && allVoices.length === 0) {
      fetchVoices();
    }
  }, [provider, hasElevenLabsKey, allVoices.length, fetchVoices]);

  // Preview a voice sample
  const previewVoice = useCallback((previewUrl?: string, voiceId?: string) => {
    if (!previewUrl) return;

    if (previewingVoice === voiceId) {
      previewAudioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }

    const audio = new Audio(previewUrl);
    previewAudioRef.current = audio;
    setPreviewingVoice(voiceId ?? null);

    audio.onended = () => setPreviewingVoice(null);
    audio.play().catch(() => setPreviewingVoice(null));
  }, [previewingVoice]);

  const isFavorite = useCallback(
    (voiceId: string) => favoriteVoices.some((v) => v.voiceId === voiceId),
    [favoriteVoices],
  );

  const toggleFavorite = useCallback(
    (voice: ElevenLabsVoice) => {
      if (isFavorite(voice.voice_id)) {
        removeFavoriteVoice(voice.voice_id);
      } else {
        addFavoriteVoice({
          voiceId: voice.voice_id,
          name: voice.name,
          previewUrl: voice.preview_url,
        });
      }
    },
    [isFavorite, addFavoriteVoice, removeFavoriteVoice],
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

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
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

  const generateSpeech = useCallback(async () => {
    if (!text.trim()) {
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
      const blob = provider === "elevenlabs"
        ? await generateWithElevenLabs(text.trim(), selectedVoice)
        : await generateWithPiper(text.trim(), selectedVoice, speed);

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
  }, [text, selectedVoice, speed, provider, generateWithPiper, generateWithElevenLabs]);

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

  const addToTimeline = useCallback(async () => {
    if (!generatedAudio || !project) return;

    setIsGenerating(true);

    try {
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

      const mediaId = importResult.actionId;
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
  }, [generatedAudio, project, getSelectedVoiceName, importMedia]);

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
          <select
            value={elevenLabsModel}
            onChange={(e) => setElevenLabsModel(e.target.value)}
            className="w-full h-8 px-2 rounded-lg border border-border bg-background-tertiary text-[10px] text-text-primary focus:border-primary focus:outline-none"
          >
            {ELEVENLABS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Text input */}
      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Text
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter the text you want to convert to speech..."
          className="w-full h-24 px-3 py-2 text-[11px] bg-background-tertiary rounded-lg border border-border focus:border-primary focus:outline-none resize-none"
          maxLength={maxChars}
        />
        <div className="flex justify-end">
          <span
            className={`text-[9px] ${charCount > maxChars * 0.9 ? "text-red-400" : "text-text-muted"}`}
          >
            {charCount}/{maxChars}
          </span>
        </div>
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
                      {isLoadingVoices ? "Loading voices..." : allVoices.length === 0 ? "Unlock session to browse voices" : "No voices match your search"}
                    </div>
                  ) : (
                    filteredVoices.map((voice) => {
                      const gender = voice.labels?.gender ?? "";
                      const accent = voice.labels?.accent ?? "";
                      const isSelected = selectedVoice === voice.voice_id;
                      const isFav = isFavorite(voice.voice_id);

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
                                toggleFavorite(voice);
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
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-[10px] text-red-400">{error}</p>
        </div>
      )}

      <button
        onClick={generateSpeech}
        disabled={isGenerating || !text.trim() || (provider === "elevenlabs" && !selectedVoice)}
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
              onClick={addToTimeline}
              disabled={isGenerating}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-[10px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Plus size={12} />
              Add to Timeline
            </button>
            <button
              onClick={downloadAudio}
              className="px-3 py-2 bg-background-secondary border border-border rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
            >
              <Download size={12} />
            </button>
          </div>
        </div>
      )}

      <p className="text-[9px] text-text-muted text-center">
        Powered by {provider === "elevenlabs" ? "ElevenLabs" : "Piper TTS"}
        {provider === "elevenlabs" && ` • ${ELEVENLABS_MODELS.find((m) => m.id === elevenLabsModel)?.label ?? elevenLabsModel}`}
      </p>
    </div>
  );
};

export default TextToSpeechPanel;
