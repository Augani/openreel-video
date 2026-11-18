import { useShallow } from "zustand/react/shallow";
import { useTimelineStore } from "../../../stores/timeline-store";
import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { AudioLines, Volume2, Loader2 } from "lucide-react";
import { wavPreviewEnvelope } from "../../../services/wav-preview-peaks";
import {
  Button,
  Input,
  ScrollArea,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
} from "@openreel/ui";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import {
  MUSIC_GENRES,
  SFX_CATEGORIES,
  MOOD_TAGS,
  type SoundItem,
  type MusicGenre,
  type SFXCategory,
  type MoodTag,
} from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { WorkspaceTabs, workspaceTabPanel } from "../WorkspacePrimitives";
import { AudioLibraryIcon } from "@/icons/audio-library";
import { formatSoundDuration } from "./sound-library-format";

type TabType = "music" | "sfx";
type PreviewStatus = "loading" | "playing" | "paused" | "resuming";

interface SoundCardProps {
  sound: SoundItem;
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  isUsed: boolean;
  isAdding: boolean;
  readProgress: (soundId: string) => number;
  onPlay: () => void;
  onStop: () => void;
  onPause: () => void;
  onAdd: () => void;
}

function SoundCard({
  sound,
  isPlaying,
  isPaused,
  isLoading,
  isUsed,
  isAdding,
  readProgress,
  onPlay,
  onPause,
  onStop,
  onAdd,
}: SoundCardProps) {
  const playButton = useRef<HTMLButtonElement>(null);
  const peaks = useMemo(() => {
    // Resample to 60 bars covering the whole sound (the envelope arrives at 60 already).
    const data = sound.waveformData ?? [];
    if (data.length <= 60) return data;
    return Array.from({ length: 60 }, (_, bar) => {
      const from = Math.floor((bar * data.length) / 60),
        to = Math.max(from + 1, Math.floor(((bar + 1) * data.length) / 60));
      return Math.max(...data.slice(from, to).map(Math.abs));
    });
  }, [sound.waveformData]);
  const [playedBars, setPlayedBars] = useState(0);
  useEffect(() => {
    const progress = () => {
      const value = readProgress(sound.id);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    };
    if (!isPlaying || !peaks.length) {
      setPlayedBars(isPaused ? Math.floor(progress() * peaks.length) : 0);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const value = progress(),
        bar = Math.floor(value * peaks.length);
      setPlayedBars(bar);
      if (value >= 1) return;
      // Read the actual playback clock at the next visible bar boundary.
      // Polling every display frame adds work without changing these 60 bars.
      const duration =
        Number.isFinite(sound.duration) && sound.duration > 0
          ? sound.duration
          : 1;
      const delay = ((bar + 1) / peaks.length - value) * duration * 1000;
      timer = setTimeout(tick, Math.max(16, Math.min(1000, Math.ceil(delay))));
    };
    tick();
    return () => clearTimeout(timer);
  }, [
    isPlaying,
    isPaused,
    sound.id,
    sound.duration,
    readProgress,
    peaks.length,
  ]);
  const category =
    MUSIC_GENRES.find((g) => g.id === sound.subcategory)?.name ??
    SFX_CATEGORIES.find((g) => g.id === sound.subcategory)?.name ??
    sound.subcategory.replaceAll("-", " ");
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="group"
          aria-label={`${sound.name} audio`}
          onKeyDown={(event) => {
            if (
              !event.defaultPrevented &&
              event.key === "Escape" &&
              (isPlaying || isPaused || isLoading)
            ) {
              event.preventDefault();
              event.stopPropagation();
              onStop();
            }
          }}
          className={`workspace-sound-row${isPlaying ? " is-playing" : ""}${isPaused ? " is-paused" : ""}${isUsed ? " is-used" : ""}`}
        >
          <Button
            ref={playButton}
            variant="ghost"
            size="icon"
            className="workspace-sound-play"
            aria-label={`${isLoading ? "Cancel preview of" : isPlaying ? "Pause" : isPaused ? "Resume" : "Preview"} ${sound.name}`}
            title={
              isPlaying || isPaused || isLoading
                ? "Esc to stop preview"
                : undefined
            }
            onClick={isLoading ? onStop : isPlaying ? onPause : onPlay}
          >
            {isLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <AudioLibraryIcon
                name={isPlaying ? "pause" : "play"}
                className={`workspace-audio-icon ${isPlaying ? "workspace-audio-pause-icon" : "workspace-audio-play-icon"}`}
              />
            )}
          </Button>
          <div className="workspace-sound-details">
            <div className="workspace-sound-title">
              <strong>{sound.name}</strong>
              <time>{formatSoundDuration(sound.duration)}</time>
            </div>
            <p>
              {isUsed ? "In timeline" : category}
              {sound.bpm ? ` · ${sound.bpm} BPM` : ""}
            </p>
            {peaks.length ? (
              <div className="workspace-sound-waveform" aria-hidden="true">
                {peaks.map((v, i) => (
                  <span
                    key={i}
                    className={
                      (isPlaying || isPaused) && i < playedBars
                        ? "is-played"
                        : undefined
                    }
                    style={{
                      height: `${Math.max(3, Math.min(20, Math.abs(v) * 20))}px`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <AudioLines
                className="workspace-sound-waveform-icon"
                aria-hidden="true"
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="workspace-sound-add"
            disabled={isAdding}
            aria-label={`Add ${sound.name} to timeline`}
            onClick={onAdd}
          >
            <AudioLibraryIcon
              name="add"
              className="workspace-audio-icon workspace-audio-add-icon"
            />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          playButton.current?.focus();
        }}
      >
        <ContextMenuItem
          disabled={!isPlaying && !isPaused && !isLoading}
          onSelect={onStop}
        >
          Stop preview
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const MusicLibraryPanel: React.FC<{ source?: "music" | "sfx" }> = ({
  source,
}) => {
  const getSoundLibraryEngine = useEngineStore(
    (state) => state.getSoundLibraryEngine,
  );
  const projectId = useProjectStore((state) => state.project.id);
  const previewEngine = useRef<Awaited<
    ReturnType<typeof getSoundLibraryEngine>
  > | null>(null);

  const [localTab, setActiveTab] = useState<TabType>("music");
  const activeTab = source ?? localTab;
  const [selectedGenre, setSelectedGenre] = useState<MusicGenre | "all">("all");
  const [selectedSfxCategory, setSelectedSfxCategory] = useState<
    SFXCategory | "all"
  >("all");
  const [selectedMoods, setSelectedMoods] = useState<MoodTag[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const allFiltersButton = useRef<HTMLButtonElement>(null);
  const keyboardFilters = useRef(false);
  const [preview, setPreview] = useState<{
    id: string;
    status: PreviewStatus;
  } | null>(null);
  const previewSession = useRef<symbol | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(() => new Set());
  const pendingAdds = useRef(new Map<string, symbol>());
  const previewIntent = useRef(0);
  const cancelPreview = useCallback(() => {
    previewIntent.current++;
    previewSession.current = null;
    previewEngine.current?.stopPreview();
  }, []);
  const session = useProjectStore((state) => state.actionExecutor);
  useEffect(() => {
    pendingAdds.current.clear();
    setAddingIds(new Set());
    cancelPreview();
    setPreview(null);
  }, [projectId, session, cancelPreview]);
  const usedSources = useProjectStore(
    useShallow((state) => {
      const mediaIds = new Set(
        state.project.timeline.tracks.flatMap((track) =>
          track.clips.map((clip) => clip.mediaId),
        ),
      );
      return state.project.mediaLibrary.items
        .filter((media) => mediaIds.has(media.id))
        .map((media) => media.metadata.soundLibraryId)
        .filter((id): id is string => Boolean(id));
    }),
  );
  const usedSoundIds = useMemo(() => new Set(usedSources), [usedSources]);
  const readProgress = useCallback(
    (soundId: string) =>
      previewEngine.current?.getPreviewProgress(soundId) ?? 0,
    [],
  );
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const [visibleCount, setVisibleCount] = useState(20);
  const [allMusic, setAllMusic] = useState<SoundItem[]>([]);
  const [allSfx, setAllSfx] = useState<SoundItem[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [loadProgress, setLoadProgress] = useState({
    music: { done: 0, total: 0 },
    sfx: { done: 0, total: 0 },
  });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const loadSounds = async () => {
      const engine = await getSoundLibraryEngine();
      if (cancelled) return;
      previewEngine.current = engine;
      // Rows appear as each loop finishes instead of after the whole library.
      const sync = () => {
        if (cancelled) return;
        setAllMusic(engine.getMusic());
        setAllSfx(engine.getSFX());
        setLoadProgress({
          music: engine.getLoadProgress("music"),
          sfx: engine.getLoadProgress("sfx"),
        });
      };
      unsubscribe = engine.onLoadProgress(sync);
      sync();
      await engine.ensureInitialized();
      if (!cancelled) {
        sync();
        setLibraryStatus("ready");
      }
    };
    void loadSounds().catch(() => {
      if (!cancelled) {
        setLibraryStatus("error");
        toast.error(
          "Sound library unavailable",
          "Reload the editor to try again.",
        );
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      cancelPreview();
    };
  }, [getSoundLibraryEngine, cancelPreview]);

  const presentMusicGenres = useMemo(
    () =>
      MUSIC_GENRES.filter((genre) =>
        allMusic.some(
          (s) =>
            s.subcategory === genre.id ||
            (genre.id === "afrobeats" &&
              s.tags.some((tag) => tag.toLowerCase() === "afrobeats")),
        ),
      ),
    [allMusic],
  );
  const presentSfxCategories = useMemo(
    () => SFX_CATEGORIES.filter((c) => allSfx.some((s) => s.subcategory === c.id)),
    [allSfx],
  );
  const presentMoods = useMemo(
    () =>
      MOOD_TAGS.filter((mood) =>
        (activeTab === "music" ? allMusic : allSfx).some((s) =>
          s.mood?.includes(mood.id),
        ),
      ),
    [activeTab, allMusic, allSfx],
  );
  const hasCalmMusic = allMusic.some((s) => s.mood?.includes("calm"));

  const sounds = useMemo(() => {
    let results = activeTab === "music" ? allMusic : allSfx;
    if (results.length === 0) return [];

    if (activeTab === "music" && selectedGenre !== "all") {
      results = results.filter(
        (s) =>
          s.subcategory === selectedGenre ||
          (selectedGenre === "afrobeats" &&
            s.tags.some((tag) => tag.toLowerCase() === "afrobeats")),
      );
    }

    if (activeTab === "sfx" && selectedSfxCategory !== "all") {
      results = results.filter((s) => s.subcategory === selectedSfxCategory);
    }

    if (selectedMoods.length > 0) {
      results = results.filter((s) =>
        s.mood?.some((m) => selectedMoods.includes(m)),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.tags.some((t) => t.toLowerCase().includes(query)) ||
          `${s.bpm ?? ""} ${s.subcategory} ${s.mood?.join(" ") ?? ""}`
            .toLowerCase()
            .includes(query),
      );
    }

    return results;
  }, [
    allMusic,
    allSfx,
    activeTab,
    selectedGenre,
    selectedSfxCategory,
    selectedMoods,
    searchQuery,
  ]);

  useEffect(() => {
    setVisibleCount(20);
  }, [
    searchQuery,
    selectedGenre,
    selectedSfxCategory,
    selectedMoods,
    activeTab,
  ]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const engine = await getSoundLibraryEngine();
      const entries = await Promise.all(
        sounds
          .slice(0, visibleCount)
          .filter((s) => !waveforms[s.id] && !s.waveformData?.length)
          .map(async (sound) => {
            const blob = engine.getSoundBlob(sound.id);
            return [
              sound.id,
              blob ? wavPreviewEnvelope(await blob.arrayBuffer()) : [],
            ] as const;
          }),
      );
      if (!cancelled && entries.length)
        setWaveforms((previous) => ({
          ...previous,
          ...Object.fromEntries(entries),
        }));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sounds, visibleCount, getSoundLibraryEngine, waveforms]);

  const handlePlay = useCallback(
    async (sound: SoundItem) => {
      const request = ++previewIntent.current;
      const resuming =
        preview?.id === sound.id &&
        (preview.status === "paused" || preview.status === "resuming");
      const session = resuming ? previewSession.current : Symbol(sound.id);
      previewSession.current = session;
      setPreview({ id: sound.id, status: resuming ? "resuming" : "loading" });
      try {
        const engine = await getSoundLibraryEngine();
        if (request !== previewIntent.current) return;
        if (resuming) {
          const resumed = await engine.resumePreview(sound.id);
          if (request !== previewIntent.current) return;
          if (!resumed) previewSession.current = null;
          setPreview(resumed ? { id: sound.id, status: "playing" } : null);
        } else {
          await engine.previewSound(sound, () => {
            if (previewSession.current === session) {
              previewSession.current = null;
              setPreview(null);
            }
          });
          if (
            request === previewIntent.current &&
            previewSession.current === session
          )
            setPreview({ id: sound.id, status: "playing" });
        }
      } catch {
        if (request !== previewIntent.current) return;
        if (resuming) setPreview({ id: sound.id, status: "paused" });
        else {
          previewSession.current = null;
          setPreview(null);
        }
        toast.error("Could not play sound", "Try previewing it again.");
      }
    },
    [getSoundLibraryEngine, preview],
  );

  const handlePause = useCallback((soundId: string) => {
    previewIntent.current++;
    if (previewEngine.current?.pausePreview(soundId))
      setPreview({ id: soundId, status: "paused" });
    else {
      previewSession.current = null;
      setPreview(null);
    }
  }, []);

  const handleStop = useCallback(() => {
    cancelPreview();
    setPreview(null);
  }, [cancelPreview]);

  const handleAddToTimeline = useCallback(
    async (sound: SoundItem) => {
      if (pendingAdds.current.has(sound.id)) return;
      const request = Symbol(sound.id);
      pendingAdds.current.set(sound.id, request);
      setAddingIds((previous) => new Set(previous).add(sound.id));
      const initial = useProjectStore.getState();
      const projectId = initial.project.id,
        executor = initial.actionExecutor;
      const isCurrent = () =>
        useProjectStore.getState().project.id === projectId &&
        useProjectStore.getState().actionExecutor === executor;
      try {
        const engine = await getSoundLibraryEngine();
        if (!isCurrent()) return;
        const existing = useProjectStore
          .getState()
          .project.mediaLibrary.items.find(
            (media) =>
              media.metadata.soundLibraryId === sound.id &&
              !media.isPlaceholder &&
              (media.blob || media.fileHandle),
          );
        let mediaId = existing?.id;
        if (!mediaId) {
          const blob = engine.getSoundBlob(sound.id);
          if (!blob) {
            toast.error(
              "Sound unavailable",
              "Choose another sound or reopen the audio browser.",
            );
            return;
          }
          const file = new File([blob], `${sound.name}.wav`, {
            type: "audio/wav",
          });
          const imported = await initial.importMedia(file, undefined, {
            soundLibraryId: sound.id,
          });
          if (!isCurrent() || !imported.success || !imported.actionId) return;
          mediaId = imported.actionId;
        }
        const store = useProjectStore.getState();
        const target = store.project.timeline.tracks.find(
          (track) => track.role === "music" && !track.locked,
        );
        const placed = await store.placeMediaClip(
          mediaId,
          target?.id,
          useTimelineStore.getState().playheadPosition,
        );
        if (!placed.success)
          toast.error("Could not add sound", placed.error?.message);
      } catch (error) {
        if (isCurrent())
          toast.error(
            "Could not add sound",
            error instanceof Error ? error.message : "Try again.",
          );
      } finally {
        if (pendingAdds.current.get(sound.id) === request) {
          pendingAdds.current.delete(sound.id);
          setAddingIds((previous) => {
            const next = new Set(previous);
            next.delete(sound.id);
            return next;
          });
        }
      }
    },
    [getSoundLibraryEngine],
  );

  const toggleMood = useCallback((mood: MoodTag) => {
    setSelectedMoods((prev) =>
      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood],
    );
  }, []);

  return (
    <div className="workspace-sound-library flex flex-col min-h-0 h-full">
      {!source && (
        <WorkspaceTabs
          label="Sound library"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: "music", label: "Music" },
            { value: "sfx", label: "Sound FX" },
          ]}
        />
      )}
      <div
        {...(!source ? workspaceTabPanel("Sound library", activeTab) : {})}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="workspace-sound-filters">
          <div className="workspace-search">
            <AudioLibraryIcon name="search" className="workspace-audio-icon workspace-audio-search-icon" />
            <Input
              aria-label="Search sounds"
              placeholder={
                activeTab === "music"
                  ? "Search music by mood, genre, BPM"
                  : "Search sound effects"
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <ContextMenu>
            <ContextMenuTrigger asChild
              onPointerDown={() => { keyboardFilters.current = false; }}
              onKeyDown={event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) keyboardFilters.current = true; }}>
              <div
                className="workspace-chips"
                role="group"
                aria-label="Sound filters"
                aria-description="Right-click or press Shift+F10 for all genres and mood filters."
              >
                <Button
                  ref={allFiltersButton}
                  variant="ghost"
                  aria-description="Right-click or press Shift+F10 for all genres and mood filters."
                  aria-pressed={
                    (activeTab === "music"
                      ? selectedGenre
                      : selectedSfxCategory) === "all" &&
                    selectedMoods.length === 0
                  }
                  onClick={() => {
                    if (activeTab === "music") setSelectedGenre("all");
                    else setSelectedSfxCategory("all");
                    setSelectedMoods([]);
                  }}
                >
                  All
                </Button>
                {activeTab === "music" ? (
                  <>
                    {presentMusicGenres.slice(0, 4).map((genre) => (
                      <Button
                        key={genre.id}
                        variant="ghost"
                        aria-pressed={selectedGenre === genre.id}
                        onClick={() => setSelectedGenre(genre.id)}
                      >
                        {genre.name}
                      </Button>
                    ))}
                    {hasCalmMusic && (
                      <Button
                        variant="ghost"
                        aria-pressed={selectedMoods.includes("calm")}
                        onClick={() => toggleMood("calm")}
                      >
                        Chill
                      </Button>
                    )}
                    {selectedGenre !== "all" &&
                      !presentMusicGenres
                        .slice(0, 4)
                        .some((genre) => genre.id === selectedGenre) && (
                      <Button
                        variant="ghost"
                        aria-pressed
                        onClick={() => setSelectedGenre("all")}
                      >
                        {
                          MUSIC_GENRES.find(
                            (genre) => genre.id === selectedGenre,
                          )?.name
                        }
                      </Button>
                    )}
                  </>
                ) : (
                  presentSfxCategories.map((category) => (
                    <Button
                      key={category.id}
                      variant="ghost"
                      aria-pressed={selectedSfxCategory === category.id}
                      onClick={() => setSelectedSfxCategory(category.id)}
                    >
                      {category.name}
                    </Button>
                  ))
                )}
                {selectedMoods
                  .filter((mood) => activeTab !== "music" || mood !== "calm")
                  .map((mood) => (
                    <Button
                      key={mood}
                      variant="ghost"
                      aria-pressed
                      onClick={() => toggleMood(mood)}
                      aria-label={`Remove ${MOOD_TAGS.find((item) => item.id === mood)?.name} mood filter`}
                    >
                      {MOOD_TAGS.find((item) => item.id === mood)?.name}
                    </Button>
                  ))}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent aria-label="Audio filters"
              onPointerDownOutside={() => { keyboardFilters.current = false; }}
              onCloseAutoFocus={event => {
                if (keyboardFilters.current) { event.preventDefault(); allFiltersButton.current?.focus(); }
                keyboardFilters.current = false;
              }}>
              {activeTab === "music" && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    All music genres
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <ContextMenuRadioGroup
                      value={selectedGenre}
                      onValueChange={(value) =>
                        setSelectedGenre(value as MusicGenre | "all")
                      }
                    >
                      <ContextMenuRadioItem value="all">
                        All genres
                      </ContextMenuRadioItem>
                      {presentMusicGenres.map((genre) => (
                        <ContextMenuRadioItem key={genre.id} value={genre.id}>
                          {genre.name}
                        </ContextMenuRadioItem>
                      ))}
                    </ContextMenuRadioGroup>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
              <ContextMenuSub>
                <ContextMenuSubTrigger>Filter by mood</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {presentMoods.map((mood) => (
                    <ContextMenuCheckboxItem
                      key={mood.id}
                      checked={selectedMoods.includes(mood.id)}
                      onCheckedChange={() => toggleMood(mood.id)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {mood.name}
                    </ContextMenuCheckboxItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => {
                  setSelectedGenre("all");
                  setSelectedSfxCategory("all");
                  setSelectedMoods([]);
                }}
              >
                Clear filters
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
        <p className="workspace-sound-note">
          {activeTab === "music"
            ? "Generated demo loops, synthesised in your browser. Not licensed music."
            : "Generated sound effects, synthesised in your browser."}
        </p>
        {libraryStatus === "loading" && loadProgress[activeTab].total > 0 && (
          <div
            className="workspace-sound-progress"
            role="progressbar"
            aria-label={`Generating ${activeTab === "music" ? "demo loops" : "sound effects"}`}
            aria-valuemin={0}
            aria-valuemax={loadProgress[activeTab].total}
            aria-valuenow={loadProgress[activeTab].done}
            data-testid="sound-library-progress"
          >
            <span>
              Generating {activeTab === "music" ? "demo loops" : "sound effects"}{" "}
              {loadProgress[activeTab].done} of {loadProgress[activeTab].total}
            </span>
            <i style={{ width: `${(100 * loadProgress[activeTab].done) / loadProgress[activeTab].total}%` }} />
          </div>
        )}
        <ScrollArea className="workspace-sound-list flex-1 min-h-0">
          {libraryStatus === "loading" && sounds.length === 0 ? (
            <div role="status" aria-label="Loading sounds" className="workspace-sound-skeletons">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="workspace-sound-skeleton" aria-hidden="true" />
              ))}
            </div>
          ) : libraryStatus === "error" ? (
            <p role="alert" className="p-6 text-center text-xs text-fg-muted">
              Sound library unavailable. Reload the editor to try again.
            </p>
          ) : sounds.length ? (
            sounds.slice(0, visibleCount).map((sound) => (
              <SoundCard
                key={sound.id}
                sound={{
                  ...sound,
                  waveformData: waveforms[sound.id] ?? sound.waveformData,
                }}
                isPlaying={
                  preview?.id === sound.id && preview.status === "playing"
                }
                isPaused={
                  preview?.id === sound.id &&
                  (preview.status === "paused" || preview.status === "resuming")
                }
                isLoading={
                  preview?.id === sound.id &&
                  (preview.status === "loading" ||
                    preview.status === "resuming")
                }
                onPause={() => handlePause(sound.id)}
                isUsed={usedSoundIds.has(sound.id)}
                isAdding={addingIds.has(sound.id)}
                readProgress={readProgress}
                onPlay={() => {
                  void handlePlay(sound);
                }}
                onStop={() => {
                  void handleStop();
                }}
                onAdd={() => {
                  void handleAddToTimeline(sound);
                }}
              />
            ))
          ) : (
            <div className="p-6 text-center text-xs text-fg-3">
              <Volume2 className="mx-auto mb-2" />
              No sounds found
              <br />
              Try adjusting your filters.
            </div>
          )}
          {sounds.length > visibleCount && (
            <Button
              variant="ghost"
              className="w-full h-8 text-xs"
              onClick={() => setVisibleCount((n) => n + 20)}
            >
              Load more sounds
            </Button>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};
