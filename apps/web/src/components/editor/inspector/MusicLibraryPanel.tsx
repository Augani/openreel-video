import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Music,
  Zap,
  Play,
  Pause,
  Plus,
  Search,
  Clock,
  Volume2,
} from "lucide-react";
import { Input } from "@openreel/ui";
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

type TabType = "music" | "sfx";

interface SoundCardProps {
  sound: SoundItem;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onAdd: () => void;
}

const SoundCard: React.FC<SoundCardProps> = ({
  sound,
  isPlaying,
  onPlay,
  onStop,
  onAdd,
}) => {
  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-2 rounded-lg border border-border bg-background-tertiary hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-2">
        <button
          onClick={isPlaying ? onStop : onPlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            isPlaying
              ? "bg-primary text-white"
              : "bg-background-secondary hover:bg-primary/20"
          }`}
        >
          {isPlaying ? (
            <Pause size={14} />
          ) : (
            <Play size={14} className="ml-0.5" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-medium text-text-primary truncate">
            {sound.name}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-1 text-[9px] text-text-muted">
              <Clock size={10} />
              <span>{formatDuration(sound.duration)}</span>
            </div>
            {sound.bpm && (
              <span className="text-[9px] text-text-muted">
                {sound.bpm} BPM
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onAdd}
          className="p-1.5 rounded-md bg-primary/20 hover:bg-primary text-primary hover:text-white transition-colors"
          title="Add to timeline"
        >
          <Plus size={14} />
        </button>
      </div>
      {sound.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {sound.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[8px] bg-background-secondary text-text-muted rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export const MusicLibraryPanel: React.FC = () => {
  const getSoundLibraryEngine = useEngineStore(
    (state) => state.getSoundLibraryEngine,
  );
  const importMedia = useProjectStore((state) => state.importMedia);
  const project = useProjectStore((state) => state.project);

  const [activeTab, setActiveTab] = useState<TabType>("music");
  const [selectedGenre, setSelectedGenre] = useState<MusicGenre | "all">("all");
  const [selectedSfxCategory, setSelectedSfxCategory] = useState<
    SFXCategory | "all"
  >("all");
  const [selectedMoods, setSelectedMoods] = useState<MoodTag[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [allMusic, setAllMusic] = useState<SoundItem[]>([]);
  const [allSfx, setAllSfx] = useState<SoundItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadSounds = async () => {
      const engine = await getSoundLibraryEngine();
      if (!cancelled) {
        setAllMusic(engine.getMusic());
        setAllSfx(engine.getSFX());
      }
    };
    loadSounds();
    return () => {
      cancelled = true;
    };
  }, [getSoundLibraryEngine]);

  const sounds = useMemo(() => {
    let results = activeTab === "music" ? allMusic : allSfx;
    if (results.length === 0) return [];

    if (activeTab === "music" && selectedGenre !== "all") {
      results = results.filter((s) => s.subcategory === selectedGenre);
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
          s.tags.some((t) => t.toLowerCase().includes(query)),
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

  const handlePlay = useCallback(
    async (sound: SoundItem) => {
      const engine = await getSoundLibraryEngine();

      if (playingId === sound.id) {
        engine.stopPreview();
        setPlayingId(null);
      } else {
        engine.stopPreview();
        setPlayingId(sound.id);
        await engine.previewSound(sound);
      }
    },
    [getSoundLibraryEngine, playingId],
  );

  const handleStop = useCallback(async () => {
    const engine = await getSoundLibraryEngine();
    engine.stopPreview();
    setPlayingId(null);
  }, [getSoundLibraryEngine]);

  const handleAddToTimeline = useCallback(
    async (sound: SoundItem) => {
      if (!project) return;

      const engine = await getSoundLibraryEngine();
      const blob = engine.getSoundBlob(sound.id);
      if (!blob) {
        console.error("[MusicLibrary] Failed to get sound blob for:", sound.id);
        return;
      }

      const file = new File([blob], `${sound.name}.wav`, { type: "audio/wav" });
      const importResult = await importMedia(file);

      if (!importResult.success || !importResult.actionId) {
        console.error(
          "[MusicLibrary] Failed to import sound:",
          importResult.error,
        );
        return;
      }

      const mediaId = importResult.actionId;
      const { addClipToNewTrack } = useProjectStore.getState();
      await addClipToNewTrack(mediaId);
    },
    [project, getSoundLibraryEngine, importMedia],
  );

  const toggleMood = useCallback((mood: MoodTag) => {
    setSelectedMoods((prev) =>
      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood],
    );
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Music size={16} className="text-primary" />
        <div>
          <span className="text-[11px] font-medium text-text-primary">
            Music & SFX
          </span>
          <p className="text-[9px] text-text-muted">Royalty-free sounds</p>
        </div>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab("music")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] transition-colors ${
            activeTab === "music"
              ? "bg-primary text-white font-medium"
              : "bg-background-tertiary text-text-secondary hover:text-text-primary"
          }`}
        >
          <Music size={12} />
          Music
        </button>
        <button
          onClick={() => setActiveTab("sfx")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[10px] transition-colors ${
            activeTab === "sfx"
              ? "bg-primary text-white font-medium"
              : "bg-background-tertiary text-text-secondary hover:text-text-primary"
          }`}
        >
          <Zap size={12} />
          Sound FX
        </button>
      </div>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted z-10"
        />
        <Input
          type="text"
          placeholder="Search sounds..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 text-[10px] bg-background-secondary border-border h-8"
        />
      </div>

      {activeTab === "music" && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedGenre("all")}
            className={`px-2 py-1 rounded text-[9px] whitespace-nowrap transition-colors ${
              selectedGenre === "all"
                ? "bg-primary text-white"
                : "bg-background-tertiary text-text-muted hover:text-text-primary"
            }`}
          >
            All
          </button>
          {MUSIC_GENRES.map((genre) => (
            <button
              key={genre.id}
              onClick={() => setSelectedGenre(genre.id)}
              className={`px-2 py-1 rounded text-[9px] whitespace-nowrap transition-colors ${
                selectedGenre === genre.id
                  ? "bg-primary text-white"
                  : "bg-background-tertiary text-text-muted hover:text-text-primary"
              }`}
            >
              {genre.name}
            </button>
          ))}
        </div>
      )}

      {activeTab === "sfx" && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedSfxCategory("all")}
            className={`px-2 py-1 rounded text-[9px] whitespace-nowrap transition-colors ${
              selectedSfxCategory === "all"
                ? "bg-primary text-white"
                : "bg-background-tertiary text-text-muted hover:text-text-primary"
            }`}
          >
            All
          </button>
          {SFX_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedSfxCategory(cat.id)}
              className={`px-2 py-1 rounded text-[9px] whitespace-nowrap transition-colors ${
                selectedSfxCategory === cat.id
                  ? "bg-primary text-white"
                  : "bg-background-tertiary text-text-muted hover:text-text-primary"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {activeTab === "music" && (
        <div className="flex flex-wrap gap-1">
          {MOOD_TAGS.slice(0, 6).map((mood) => (
            <button
              key={mood.id}
              onClick={() => toggleMood(mood.id)}
              className={`px-2 py-0.5 rounded-full text-[8px] transition-colors ${
                selectedMoods.includes(mood.id)
                  ? "bg-primary text-white"
                  : "bg-background-secondary text-text-muted hover:text-text-primary"
              }`}
            >
              {mood.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sounds.length === 0 ? (
          <div className="text-center py-6">
            <Volume2
              size={24}
              className="mx-auto mb-2 text-text-muted opacity-50"
            />
            <p className="text-[10px] text-text-muted">No sounds found</p>
            <p className="text-[9px] text-text-muted mt-1">
              Try adjusting filters
            </p>
          </div>
        ) : (
          sounds.map((sound) => (
            <SoundCard
              key={sound.id}
              sound={sound}
              isPlaying={playingId === sound.id}
              onPlay={() => handlePlay(sound)}
              onStop={handleStop}
              onAdd={() => handleAddToTimeline(sound)}
            />
          ))
        )}
      </div>

      <p className="text-[9px] text-text-muted text-center">
        {sounds.length} {activeTab === "music" ? "tracks" : "effects"} available
      </p>
    </div>
  );
};

export default MusicLibraryPanel;
