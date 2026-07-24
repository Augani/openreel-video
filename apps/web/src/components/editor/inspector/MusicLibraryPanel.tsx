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
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
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
    <Card variant="muted" padding={2} className="border border-border hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-2">
        <IconButton
          label={isPlaying ? `Stop ${sound.name}` : `Preview ${sound.name}`}
          icon={
            isPlaying ? (
              <Pause size={14} aria-hidden />
            ) : (
              <Play size={14} className="ml-0.5" aria-hidden />
            )
          }
          variant={isPlaying ? "primary" : "secondary"}
          size="md"
          onClick={isPlaying ? onStop : onPlay}
        />
        <div className="flex-1 min-w-0">
          <Text type="supporting" color="primary" weight="bold" className="block text-[10px] truncate">
            {sound.name}
          </Text>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex items-center gap-1 text-[9px] text-fg-3">
              <Clock size={10} aria-hidden />
              <Text type="supporting" color="secondary" className="text-[9px]">
                {formatDuration(sound.duration)}
              </Text>
            </div>
            {sound.bpm && (
              <Text type="supporting" color="secondary" className="text-[9px]">
                {sound.bpm} BPM
              </Text>
            )}
          </div>
        </div>
        <IconButton
          label={`Add ${sound.name} to timeline`}
          icon={<Plus size={14} aria-hidden />}
          variant="primary"
          size="sm"
          onClick={onAdd}
        />
      </div>
      {sound.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {sound.tags.slice(0, 3).map((tag) => (
            <Text
              key={tag}
              type="supporting"
              color="secondary"
              className="px-1.5 py-0.5 text-[8px] bg-bg-1 rounded"
            >
              {tag}
            </Text>
          ))}
        </div>
      )}
    </Card>
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
      <Card variant="green" padding={2} className="flex items-center gap-2 border border-primary/30">
        <Music size={16} className="text-primary" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <Text type="body" color="primary" weight="bold" className="text-[11px]">
            Music & SFX
          </Text>
          <Text type="supporting" color="secondary" className="text-[9px]">
            Royalty-free sounds
          </Text>
        </div>
      </Card>

      <div className="flex gap-1">
        <Button
          label="Music"
          icon={<Music size={12} aria-hidden />}
          variant={activeTab === "music" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("music")}
          className="flex-1"
        />
        <Button
          label="Sound FX"
          icon={<Zap size={12} aria-hidden />}
          variant={activeTab === "sfx" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setActiveTab("sfx")}
          className="flex-1"
        />
      </div>

      <div className="relative">
        <ToolcraftTextInputControl
          label="Search sounds"
          isLabelHidden
          size="sm"
          width="100%"
          placeholder="Search sounds..."
          value={searchQuery}
          onChange={setSearchQuery}
          startIcon={<Search size={14} aria-hidden />}
        />
      </div>

      {activeTab === "music" && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          <Button
            label="All"
            variant={selectedGenre === "all" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setSelectedGenre("all")}
            className="whitespace-nowrap text-[9px]"
          />
          {MUSIC_GENRES.map((genre) => (
            <Button
              key={genre.id}
              label={genre.name}
              variant={selectedGenre === genre.id ? "primary" : "secondary"}
              size="sm"
              onClick={() => setSelectedGenre(genre.id)}
              className="whitespace-nowrap text-[9px]"
            />
          ))}
        </div>
      )}

      {activeTab === "sfx" && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          <Button
            label="All"
            variant={selectedSfxCategory === "all" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setSelectedSfxCategory("all")}
            className="whitespace-nowrap text-[9px]"
          />
          {SFX_CATEGORIES.map((cat) => (
            <Button
              key={cat.id}
              label={cat.name}
              variant={selectedSfxCategory === cat.id ? "primary" : "secondary"}
              size="sm"
              onClick={() => setSelectedSfxCategory(cat.id)}
              className="whitespace-nowrap text-[9px]"
            />
          ))}
        </div>
      )}

      {activeTab === "music" && (
        <div className="flex flex-wrap gap-1">
          {MOOD_TAGS.slice(0, 6).map((mood) => (
            <Button
              key={mood.id}
              label={mood.name}
              variant={selectedMoods.includes(mood.id) ? "primary" : "secondary"}
              size="sm"
              onClick={() => toggleMood(mood.id)}
              className="rounded-full text-[8px]"
            />
          ))}
        </div>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sounds.length === 0 ? (
          <div className="text-center py-6">
            <Volume2
              size={24}
              className="mx-auto mb-2 text-fg-3 opacity-50"
              aria-hidden
            />
            <Text type="supporting" color="secondary" className="block text-[10px]">
              No sounds found
            </Text>
            <Text type="supporting" color="secondary" className="block text-[9px] mt-1">
              Try adjusting filters
            </Text>
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

      <Text type="supporting" color="secondary" className="block text-[9px] text-center">
        {sounds.length} {activeTab === "music" ? "tracks" : "effects"} available
      </Text>
    </div>
  );
};

export default MusicLibraryPanel;
