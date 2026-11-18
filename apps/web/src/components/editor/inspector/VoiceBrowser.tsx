import {
  Input as ShadcnInput,
  Button,
  Card,
  buttonVariants,
  cn,
} from "@openreel/ui";
import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  Play,
  Pause,
  Search,
  Star,
  StarOff,
  ChevronDown,
  Loader2,
  Settings,
} from "@/icons/lucide-compat";





import { useSettingsStore } from "../../../stores/settings-store";
import type { ElevenLabsVoice } from "./tts-types";

interface VoiceBrowserProps {
  selectedVoice: string;
  onSelectVoice: (voiceId: string) => void;
  allVoices: ElevenLabsVoice[];
  isLoadingVoices: boolean;
}

export const VoiceBrowser: React.FC<VoiceBrowserProps> = ({
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

  React.useEffect(() => () => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    previewAudioRef.current = null;
  }, []);

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

    const finishPreview = () => {
      if (previewAudioRef.current !== audio) return;
      previewAudioRef.current = null;
      setPreviewingVoice(null);
    };
    audio.onended = finishPreview;
    audio.onerror = finishPreview;

    audio.src = previewUrl;
    audio.play().catch(finishPreview);
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

  return (
    <div className="space-y-2">
      <span className="font-medium text-[10px] text-fg-2">
        Voice
      </span>
      <div className="space-y-2">
        {favoriteVoices.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[9px] text-fg-3 flex items-center gap-1">
              <Star size={9} className="text-amber-400 fill-amber-400" /> Favorites
            </span>
            <div className="flex flex-wrap gap-1.5">
              {favoriteVoices.map((fav) => (
                <Card key={fav.voiceId} data-selected={selectedVoice === fav.voiceId ? "true" : undefined} className={cn("shadow-none", buttonVariants({ variant: "ghost" }), cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (selectedVoice === fav.voiceId ? "border-status-success/25 bg-status-success/10 text-fg hover:bg-status-success/15" : "border-transparent bg-bg-2 text-fg hover:bg-bg-3"), (selectedVoice === fav.voiceId) && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]", "p-2", `flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-colors ${
                    selectedVoice === fav.voiceId
                      ? "bg-primary text-white font-medium"
                      : "bg-bg-2 text-fg-2 hover:text-fg border border-border"
                  }`), "relative w-fit max-w-full")}>
                  <Button variant="ghost" type="button" aria-label={fav.name} role="checkbox" aria-checked={selectedVoice === fav.voiceId} onClick={() => onSelectVoice(fav.voiceId)} className="absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)] rounded-[inherit] bg-transparent p-0 hover:bg-transparent" />
                  <Star size={8} className="text-amber-400 fill-amber-400" />
                  <span>{fav.name}</span>
                  {fav.previewUrl && (
                    <Button variant="ghost" size="icon-sm" onClick={(e) => {
                        e.stopPropagation();
                        previewVoice(fav.previewUrl, fav.voiceId);
                      }} type="button" aria-label="Preview voice" title="Preview voice" className="relative z-10 inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg ml-0.5 opacity-60 hover:opacity-100">
                      {previewingVoice === fav.voiceId ? (
                          <Pause size={8} />
                        ) : (
                          <Play size={8} />
                        )}
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        <Button onClick={() => setShowAllVoices(!showAllVoices)} type="button" aria-label={(showAllVoices ? "Hide voice browser" : "Browse and search voices").trim() || undefined} className="min-w-0 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 bg-transparent hover:bg-bg-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] border border-dashed border-border text-fg-3 hover:text-fg hover:border-primary/50 transition-colors"
        >
          <Search size={10} />
          {showAllVoices ? "Hide voice browser" : "Browse & search voices"}
          <ChevronDown size={10} className={`transition-transform ${showAllVoices ? "rotate-180" : ""}`} />
        </Button>

        {showAllVoices && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-bg-1">
              <Search size={12} className="text-fg-3 shrink-0" />
              <ShadcnInput
                value={voiceSearch}
                placeholder="Search by name, accent, gender..."
                aria-label={"Search voices"}
                onChange={(event) => setVoiceSearch(event.currentTarget.value)}
                autoFocus={true}
                className={cn(
                  "flex h-8 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[13px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
                  "flex-1 bg-transparent text-[10px] text-fg placeholder:text-fg-3 focus:outline-none md:text-[10px]",
                )}
              />
              {isLoadingVoices && <Loader2 size={12} className="animate-spin text-fg-3" />}
            </div>

            <div className="max-h-48 overflow-y-auto">
              {filteredVoices.length === 0 ? (
                <div className="p-3 text-center text-[10px] text-fg-3">
                  {isLoadingVoices ? "Loading voices..." : allVoices.length === 0 ? (
                    <Button onClick={() => openSettings("api-keys")} type="button" aria-label="Unlock session to browse voices" className="min-w-0 justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 text-[12px] hover:text-fg inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 transition-colors font-medium">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Settings size={12} />}</span>
                      <span className="truncate">{"Unlock session to browse voices"}</span>
                    </Button>
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
                          : "hover:bg-bg-2 border-l-2 border-transparent"
                      }`}
                      onClick={() => onSelectVoice(voice.voice_id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-fg truncate">
                            {voice.name}
                          </span>
                          {voice.category === "cloned" && (
                            <span className="text-[8px] px-1 py-0.5 rounded bg-primary/20 text-primary">
                              Cloned
                            </span>
                          )}
                        </div>
                        <div className="text-[8px] text-fg-3">
                          {[gender, accent, voice.category].filter(Boolean).join(" · ")}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {voice.preview_url && (
                          <Button variant="ghost" size="icon-sm" onClick={(e) => {
                              e.stopPropagation();
                              previewVoice(voice.preview_url, voice.voice_id);
                            }} type="button" aria-label="Preview" title="Preview" className="inline-flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent p-1 rounded hover:bg-bg-elev text-fg-3 hover:text-fg transition-colors">
                            {previewingVoice === voice.voice_id ? (
                                <Pause size={10} />
                              ) : (
                                <Play size={10} />
                              )}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" onClick={(e) => {
                            e.stopPropagation();
                            toggleFavoriteVoice(voice);
                          }} type="button" aria-label={isFav ? "Remove from favorites" : "Add to favorites"} title={isFav ? "Remove from favorites" : "Add to favorites"} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg", `p-1 rounded hover:bg-bg-elev transition-colors ${
                            isFav ? "text-amber-400" : "text-fg-3 hover:text-amber-400"
                          }`)}>
                          {isFav ? (
                              <Star size={10} className="fill-current" />
                            ) : (
                              <StarOff size={10} />
                            )}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-2 py-1 border-t border-border bg-bg-1 text-[8px] text-fg-3 text-center">
              {filteredVoices.length} of {allVoices.length} voices
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
