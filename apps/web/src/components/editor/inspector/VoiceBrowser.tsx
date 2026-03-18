import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  Play,
  Pause,
  Search,
  Star,
  StarOff,
  ChevronDown,
  Loader2,
  User,
  Settings,
} from "lucide-react";
import type { TtsProvider } from "../../../stores/settings-store";
import { useSettingsStore } from "../../../stores/settings-store";
import type { ElevenLabsVoice } from "./tts-types";
import { PIPER_VOICES } from "./tts-constants";

interface VoiceBrowserProps {
  provider: TtsProvider;
  selectedVoice: string;
  onSelectVoice: (voiceId: string) => void;
  allVoices: ElevenLabsVoice[];
  isLoadingVoices: boolean;
}

export const VoiceBrowser: React.FC<VoiceBrowserProps> = ({
  provider,
  selectedVoice,
  onSelectVoice,
  allVoices,
  isLoadingVoices,
}) => {
  const {
    favoriteVoices,
    addFavoriteVoice,
    removeFavoriteVoice,
    openSettings,
  } = useSettingsStore();

  const [voiceSearch, setVoiceSearch] = useState("");
  const [showAllVoices, setShowAllVoices] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const isFavoriteVoice = useCallback(
    (voiceId: string) => favoriteVoices.some((v) => v.voiceId === voiceId),
    [favoriteVoices],
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

  const previewVoice = useCallback((previewUrl?: string, voiceId?: string) => {
    if (!previewUrl) return;

    if (previewAudioRef.current && previewingVoice === voiceId) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewingVoice(null);
      return;
    }

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

  const filteredVoices = useMemo(() => {
    return allVoices.filter((v) => {
      if (!voiceSearch.trim()) return true;
      const q = voiceSearch.toLowerCase();
      return (
        v.name.toLowerCase().includes(q) ||
        v.category?.toLowerCase().includes(q) ||
        Object.values(v.labels || {}).some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [allVoices, voiceSearch]);

  if (provider === "piper") {
    return (
      <div className="space-y-2">
        <label className="text-[10px] font-medium text-text-secondary">
          Voice
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PIPER_VOICES.map((voice) => (
            <button
              key={voice.id}
              onClick={() => onSelectVoice(voice.id)}
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
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-medium text-text-secondary">
        Voice
      </label>
      <div className="space-y-2">
        {favoriteVoices.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[9px] text-text-muted flex items-center gap-1">
              <Star size={9} className="text-amber-400 fill-amber-400" /> Favorites
            </span>
            <div className="flex flex-wrap gap-1.5">
              {favoriteVoices.map((fav) => (
                <button
                  key={fav.voiceId}
                  onClick={() => onSelectVoice(fav.voiceId)}
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

        <button
          onClick={() => setShowAllVoices(!showAllVoices)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] border border-dashed border-border text-text-muted hover:text-text-primary hover:border-primary/50 transition-colors"
        >
          <Search size={10} />
          {showAllVoices ? "Hide voice browser" : "Browse & search voices"}
          <ChevronDown size={10} className={`transition-transform ${showAllVoices ? "rotate-180" : ""}`} />
        </button>

        {showAllVoices && (
          <div className="border border-border rounded-lg overflow-hidden">
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
                      onClick={() => onSelectVoice(voice.voice_id)}
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
    </div>
  );
};
