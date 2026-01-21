import React, { useState, useCallback, useMemo } from "react";
import {
  Volume2,
  VolumeX,
  Mic,
  Music,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
} from "lucide-react";
import { Slider } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import type { Track } from "@openreel/core";

interface AudioDuckingSectionProps {
  clipId: string;
}

interface DuckingSettings {
  enabled: boolean;
  sourceTrackId: string | null;
  threshold: number;
  reduction: number;
  attack: number;
  release: number;
  holdTime: number;
}

const DEFAULT_SETTINGS: DuckingSettings = {
  enabled: false,
  sourceTrackId: null,
  threshold: -30,
  reduction: 0.7,
  attack: 0.1,
  release: 0.3,
  holdTime: 0.2,
};

const PRESET_CONFIGS: {
  id: string;
  name: string;
  settings: Partial<DuckingSettings>;
}[] = [
  {
    id: "subtle",
    name: "Subtle",
    settings: { threshold: -35, reduction: 0.4, attack: 0.15, release: 0.5 },
  },
  {
    id: "moderate",
    name: "Moderate",
    settings: { threshold: -30, reduction: 0.6, attack: 0.1, release: 0.3 },
  },
  {
    id: "aggressive",
    name: "Aggressive",
    settings: { threshold: -25, reduction: 0.8, attack: 0.05, release: 0.2 },
  },
  {
    id: "podcast",
    name: "Podcast",
    settings: {
      threshold: -28,
      reduction: 0.75,
      attack: 0.08,
      release: 0.4,
      holdTime: 0.3,
    },
  },
];

export const AudioDuckingSection: React.FC<AudioDuckingSectionProps> = ({
  clipId,
}) => {
  const project = useProjectStore((state) => state.project);
  const [settings, setSettings] = useState<DuckingSettings>(DEFAULT_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isApplied, setIsApplied] = useState(false);

  const audioTracks = useMemo(() => {
    return project.timeline.tracks.filter(
      (track): track is Track => track.type === "audio",
    );
  }, [project.timeline.tracks]);

  const currentTrack = useMemo(() => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) {
          return track;
        }
      }
    }
    return null;
  }, [project.timeline.tracks, clipId]);

  const availableSourceTracks = useMemo(() => {
    return audioTracks.filter((track) => track.id !== currentTrack?.id);
  }, [audioTracks, currentTrack]);

  const updateSetting = useCallback(
    <K extends keyof DuckingSettings>(key: K, value: DuckingSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      if (isApplied) {
        setIsApplied(false);
      }
    },
    [isApplied],
  );

  const applyPreset = useCallback((presetId: string) => {
    const preset = PRESET_CONFIGS.find((p) => p.id === presetId);
    if (preset) {
      setSettings((prev) => ({ ...prev, ...preset.settings }));
    }
  }, []);

  const handleApplyDucking = useCallback(() => {
    if (!settings.sourceTrackId) return;

    setIsApplied(true);
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, [settings]);

  const handleRemoveDucking = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    setIsApplied(false);
    useProjectStore.setState((state) => ({
      project: { ...state.project, modifiedAt: Date.now() },
    }));
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <VolumeX size={16} className="text-primary" />
        <div className="flex-1">
          <span className="text-[11px] font-medium text-text-primary">
            Audio Ducking
          </span>
          <p className="text-[9px] text-text-muted">
            Auto-lower music when speech plays
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between p-2 bg-background-tertiary rounded-lg">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              settings.enabled ? "bg-green-400" : "bg-gray-500"
            }`}
          />
          <span className="text-[10px] font-medium text-text-primary">
            {settings.enabled ? "Ducking Enabled" : "Ducking Disabled"}
          </span>
        </div>
        <button
          onClick={() => updateSetting("enabled", !settings.enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            settings.enabled ? "bg-primary" : "bg-background-secondary"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              settings.enabled ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {settings.enabled && (
        <>
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-text-secondary flex items-center gap-2">
              <Mic size={12} />
              Trigger Source (Voice Track)
            </label>
            {availableSourceTracks.length > 0 ? (
              <div className="space-y-1">
                {availableSourceTracks.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => updateSetting("sourceTrackId", track.id)}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                      settings.sourceTrackId === track.id
                        ? "bg-primary/20 border border-primary"
                        : "bg-background-tertiary border border-transparent hover:border-border"
                    }`}
                  >
                    <Volume2 size={12} className="text-text-muted" />
                    <span className="flex-1 text-[10px] text-text-primary">
                      {track.name || `Audio ${track.id.slice(-4)}`}
                    </span>
                    {settings.sourceTrackId === track.id && (
                      <Check size={12} className="text-primary" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-background-tertiary rounded-lg text-center">
                <Mic
                  size={16}
                  className="mx-auto mb-1 text-text-muted opacity-50"
                />
                <p className="text-[10px] text-text-muted">
                  Add another audio track to use as trigger
                </p>
              </div>
            )}
          </div>

          {settings.sourceTrackId && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-text-secondary flex items-center gap-2">
                  <Music size={12} />
                  Ducking Presets
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {PRESET_CONFIGS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset.id)}
                      className="p-2 text-[9px] text-text-secondary bg-background-tertiary rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-text-secondary">
                      Detection Threshold
                    </label>
                    <span className="text-[10px] font-mono text-text-primary">
                      {settings.threshold} dB
                    </span>
                  </div>
                  <Slider
                    min={-50}
                    max={-10}
                    step={1}
                    value={[settings.threshold]}
                    onValueChange={(value) =>
                      updateSetting("threshold", value[0])
                    }
                  />
                  <p className="text-[8px] text-text-muted">
                    Voice level that triggers ducking
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-text-secondary">
                      Volume Reduction
                    </label>
                    <span className="text-[10px] font-mono text-text-primary">
                      {Math.round(settings.reduction * 100)}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[settings.reduction * 100]}
                    onValueChange={(value) =>
                      updateSetting("reduction", value[0] / 100)
                    }
                  />
                  <p className="text-[8px] text-text-muted">
                    How much to lower background music
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center gap-2 py-1.5 text-[10px] text-text-secondary hover:text-text-primary transition-colors"
              >
                {showAdvanced ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Timing Controls
              </button>

              {showAdvanced && (
                <div className="space-y-3 p-2 bg-background-tertiary rounded-lg">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-text-secondary">
                        Attack
                      </label>
                      <span className="text-[10px] font-mono text-text-primary">
                        {settings.attack.toFixed(2)}s
                      </span>
                    </div>
                    <Slider
                      min={0.01}
                      max={0.5}
                      step={0.01}
                      value={[settings.attack]}
                      onValueChange={(value) =>
                        updateSetting("attack", value[0])
                      }
                    />
                    <p className="text-[8px] text-text-muted">
                      How fast volume drops when voice starts
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-text-secondary">
                        Release
                      </label>
                      <span className="text-[10px] font-mono text-text-primary">
                        {settings.release.toFixed(2)}s
                      </span>
                    </div>
                    <Slider
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={[settings.release]}
                      onValueChange={(value) =>
                        updateSetting("release", value[0])
                      }
                    />
                    <p className="text-[8px] text-text-muted">
                      How fast volume returns after voice stops
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-text-secondary">
                        Hold Time
                      </label>
                      <span className="text-[10px] font-mono text-text-primary">
                        {settings.holdTime.toFixed(2)}s
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={0.5}
                      step={0.05}
                      value={[settings.holdTime]}
                      onValueChange={(value) =>
                        updateSetting("holdTime", value[0])
                      }
                    />
                    <p className="text-[8px] text-text-muted">
                      Minimum time to stay ducked between words
                    </p>
                  </div>
                </div>
              )}

              {!isApplied ? (
                <button
                  onClick={handleApplyDucking}
                  className="w-full py-2.5 bg-primary hover:bg-primary-hover rounded-lg text-[11px] font-medium text-white flex items-center justify-center gap-2 transition-colors"
                >
                  <VolumeX size={14} />
                  Apply Ducking
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <Check size={12} className="text-green-400" />
                    <span className="text-[10px] text-green-400">
                      Ducking Applied
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleApplyDucking}
                      className="flex items-center justify-center gap-1 py-2 bg-background-tertiary rounded-lg text-[10px] text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <RefreshCw size={10} />
                      Update
                    </button>
                    <button
                      onClick={handleRemoveDucking}
                      className="py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="pt-2 border-t border-border">
        <p className="text-[9px] text-text-muted text-center">
          Automatically reduces music volume when voice is detected
        </p>
      </div>
    </div>
  );
};

export default AudioDuckingSection;
