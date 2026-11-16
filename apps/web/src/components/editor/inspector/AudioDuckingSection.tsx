import { buildTriggerTrackBuffer } from "../../../services/audio-ducking-buffer";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Volume2,
  VolumeX,
  Mic,
  Music,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  AlertCircle,
} from "@/icons/lucide-compat";
import {
  AudioDucker,
  resolveAudibleAudioTarget,
  trackHasAudioItems,
  type Clip,
  type Project,
  type Track,
} from "@openreel/core";
import { Button } from "@openreel/ui";
import { Card } from "@openreel/ui";
import { cn } from "@openreel/ui";

import { PropertySlider } from "./shell/PropertySlider";
import { InspectorToggle } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import type { AudioDuckingSettings } from "../../../stores/project";

interface AudioDuckingSectionProps {
  clipId: string;
}

const DEFAULT_SETTINGS: AudioDuckingSettings = {
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
  settings: Partial<AudioDuckingSettings>;
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

const isAudioDuckingSettings = (
  value: unknown,
): value is AudioDuckingSettings => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AudioDuckingSettings>;

  return (
    typeof candidate.enabled === "boolean" &&
    (typeof candidate.sourceTrackId === "string" ||
      candidate.sourceTrackId === null) &&
    typeof candidate.threshold === "number" &&
    typeof candidate.reduction === "number" &&
    typeof candidate.attack === "number" &&
    typeof candidate.release === "number" &&
    typeof candidate.holdTime === "number"
  );
};

const findClipById = (project: Project, clipId: string): Clip | null => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return clip;
    }
  }

  return null;
};

const getTrackLabel = (track: Track): string => {
  return track.name || `Track ${track.id.slice(-4)}`;
};

interface DuckingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  description: string;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}

const DuckingSlider: React.FC<DuckingSliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  description,
  formatValue,
  onChange,
}) => (
  <div className="space-y-1">
    <PropertySlider
      label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      formatValue={formatValue}
    />
    <span className="text-fg-2 font-normal text-[8px]">
      {description}
    </span>
  </div>
);


export const AudioDuckingSection: React.FC<AudioDuckingSectionProps> = ({
  clipId,
}) => {
  const project = useProjectStore((state) => state.project);
  const setClipAudioDucking = useProjectStore(
    (state) => state.setClipAudioDucking,
  );
  const clearClipAudioDucking = useProjectStore(
    (state) => state.clearClipAudioDucking,
  );
  const [settings, setSettings] = useState<AudioDuckingSettings>(DEFAULT_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedClip = useMemo(() => findClipById(project, clipId), [project, clipId]);
  const audioTargetClip = useMemo(
    () =>
      selectedClip
        ? resolveAudibleAudioTarget(selectedClip, project.timeline)
        : null,
    [project.timeline, selectedClip],
  );

  const availableSourceTracks = useMemo(() => {
    const excludedClipIds = new Set(
      [clipId, audioTargetClip?.id].filter(Boolean) as string[],
    );

    return project.timeline.tracks.filter(
      (track): track is Track =>
        trackHasAudioItems(project, track.id) &&
        !track.clips.every((clip) => excludedClipIds.has(clip.id)),
    );
  }, [audioTargetClip?.id, clipId, project]);

  const currentTrack = useMemo(() => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === (audioTargetClip?.id ?? clipId)) {
          return track;
        }
      }
    }
    return null;
  }, [audioTargetClip?.id, project.timeline.tracks, clipId]);

  const persistedSettings = useMemo(() => {
    const candidate = audioTargetClip?.metadata?.audioDucking;
    return isAudioDuckingSettings(candidate) ? candidate : null;
  }, [audioTargetClip]);

  const hasAppliedDucking = Boolean(
    persistedSettings?.enabled &&
      (audioTargetClip?.automation?.volume?.length ?? 0) > 0,
  );
  const showControls = settings.enabled || hasAppliedDucking;

  useEffect(() => {
    if (persistedSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...persistedSettings });
    } else {
      setSettings(DEFAULT_SETTINGS);
    }

    setErrorMessage(null);
  }, [clipId, persistedSettings]);

  const updateSetting = useCallback(
    <K extends keyof AudioDuckingSettings>(
      key: K,
      value: AudioDuckingSettings[K],
    ) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setErrorMessage(null);
    },
    [],
  );

  const applyPreset = useCallback((presetId: string) => {
    const preset = PRESET_CONFIGS.find((p) => p.id === presetId);
    if (preset) {
      setSettings((prev) => ({ ...prev, ...preset.settings }));
      setErrorMessage(null);
    }
  }, []);

  const handleApplyDucking = useCallback(async () => {
    if (!audioTargetClip || !settings.sourceTrackId) {
      return;
    }

    const sourceTrack = project.timeline.tracks.find(
      (track) => track.id === settings.sourceTrackId,
    );

    if (!sourceTrack) {
      setErrorMessage("Select a valid trigger source track.");
      return;
    }

    setIsApplying(true);
    setErrorMessage(null);

    try {
      const triggerBuffer = await buildTriggerTrackBuffer(
        project,
        audioTargetClip,
        sourceTrack,
      );
      const ducker = new AudioDucker();
      const keyframes = ducker.generateDuckingKeyframes(
        triggerBuffer,
        settings,
        audioTargetClip.volume > 0 ? audioTargetClip.volume : 1,
      );

      if (keyframes.length === 0) {
        throw new Error(
          "No speech crossed the trigger threshold. Lower the threshold or choose a louder source track.",
        );
      }

      const persisted = { ...settings, enabled: true };
      const applied = setClipAudioDucking(audioTargetClip.id, persisted, keyframes);

      if (!applied) {
        throw new Error("Failed to persist ducking on this clip.");
      }

      window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to apply ducking.",
      );
    } finally {
      setIsApplying(false);
    }
  }, [audioTargetClip, project, setClipAudioDucking, settings]);

  const handleRemoveDucking = useCallback(() => {
    const cleared = clearClipAudioDucking(audioTargetClip?.id ?? clipId);

    if (!cleared) {
      setErrorMessage("Failed to remove ducking from this clip.");
      return;
    }

    setSettings(DEFAULT_SETTINGS);
    setErrorMessage(null);
    window.dispatchEvent(new CustomEvent("openreel:preview-invalidate", { detail: { audioOnly: true } }));
  }, [audioTargetClip?.id, clearClipAudioDucking, clipId]);

  return (
    <div className="space-y-3">
      <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-2 flex items-center gap-2 border border-primary/30"
      >
        <VolumeX size={16} className="text-primary" aria-hidden />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-fg font-bold block text-[11px]">
            Audio Ducking
          </span>
          <span className="text-fg-2 font-normal block text-[9px]">
            Auto-lower music when speech plays
          </span>
        </div>
      </Card>

      <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              showControls ? "bg-green-400" : "bg-gray-500"
            }`}
          />
          <span className="text-[12px] leading-5 text-fg font-bold">
            {showControls ? "Ducking Enabled" : "Ducking Disabled"}
          </span>
        </div>
        <InspectorToggle
          ariaLabel="Enable audio ducking"
          checked={settings.enabled}
          onChange={(checked) => updateSetting("enabled", checked)}
        />
      </Card>

      {showControls && (
        <>
          <div className="space-y-2">
            <span className="text-[12px] leading-5 text-fg-2 font-bold flex items-center gap-2"
            >
              <Mic size={12} aria-hidden />
              Trigger Source (Voice Track)
            </span>
            {availableSourceTracks.length > 0 ? (
              <div className="space-y-1">
                {availableSourceTracks
                  .filter((track) => track.id !== currentTrack?.id)
                  .map((track) => (
                  <Button variant="ghost" key={track.id} onClick={() => updateSetting("sourceTrackId", track.id)} type="button" aria-label={`Use ${getTrackLabel(track)} as ducking trigger`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", (settings.sourceTrackId === track.id ? "" : "border-transparent bg-bg-2 hover:bg-bg-3"), "p-2", "w-full border border-transparent")}>
                    <div className="flex items-center gap-2">
                      <Volume2 size={12} className="text-fg-3" aria-hidden />
                      <span className="text-fg font-normal flex-1 text-[10px]"
                      >
                        {getTrackLabel(track)}
                      </span>
                      {settings.sourceTrackId === track.id && (
                        <Check size={12} className="text-primary" aria-hidden />
                      )}
                    </div>
                  </Button>
                ))}
              </div>
            ) : (
              <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 text-center">
                <Mic
                  size={16}
                  className="mx-auto mb-1 text-fg-3 opacity-50"
                  aria-hidden
                />
                <span className="text-fg-2 font-normal text-[10px]">
                  Add another audio or video track with speech to use as trigger
                </span>
              </Card>
            )}
          </div>

          {settings.sourceTrackId && (
            <>
              <div className="space-y-2">
                <span className="text-[12px] leading-5 text-fg-2 font-bold flex items-center gap-2"
                >
                  <Music size={12} aria-hidden />
                  Ducking Presets
                </span>
                <div className="grid grid-cols-2 gap-1">
                  {PRESET_CONFIGS.map((preset) => (
                    <Button key={preset.id} onClick={() => applyPreset(preset.id)} type="button" aria-label={(preset.name).trim() || undefined} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full text-[9px]">
                      {(preset.name) ? <span className="truncate">{preset.name}</span> : null}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <DuckingSlider
                  label="Detection Threshold"
                  min={-50}
                  max={-10}
                  step={1}
                  value={settings.threshold}
                  onChange={(value) => updateSetting("threshold", value)}
                  formatValue={(value) => `${Math.round(value)} dB`}
                  description="Voice level that triggers ducking"
                />

                <DuckingSlider
                  label="Volume Reduction"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.reduction * 100}
                  onChange={(value) => updateSetting("reduction", value / 100)}
                  formatValue={(value) => `${Math.round(value)}%`}
                  description="How much to lower background music"
                />
              </div>

              <Button onClick={() => setShowAdvanced(!showAdvanced)} type="button" aria-label="Timing Controls" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg w-full justify-start">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{showAdvanced ? (
                    <ChevronDown size={12} aria-hidden />
                  ) : (
                    <ChevronRight size={12} aria-hidden />
                  )}</span>
                <span className="truncate">{"Timing Controls"}</span>
              </Button>

              {showAdvanced && (
                <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 space-y-3">
                  <DuckingSlider
                    label="Attack"
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={settings.attack}
                    onChange={(value) => updateSetting("attack", value)}
                    formatValue={(value) => `${value.toFixed(2)}s`}
                    description="How fast volume drops when voice starts"
                  />

                  <DuckingSlider
                    label="Release"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={settings.release}
                    onChange={(value) => updateSetting("release", value)}
                    formatValue={(value) => `${value.toFixed(2)}s`}
                    description="How fast volume returns after voice stops"
                  />

                  <DuckingSlider
                    label="Hold Time"
                    min={0}
                    max={0.5}
                    step={0.05}
                    value={settings.holdTime}
                    onChange={(value) => updateSetting("holdTime", value)}
                    formatValue={(value) => `${value.toFixed(2)}s`}
                    description="Minimum time to stay ducked between words"
                  />
                </Card>
              )}

              {!hasAppliedDucking ? (
                <Button onClick={handleApplyDucking} type="button" aria-label={(isApplying ? "Analyzing..." : "Apply Ducking").trim() || undefined} disabled={(isApplying)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full">
                  {(isApplying) ? <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isApplying ? (
                      <RefreshCw size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <VolumeX size={14} aria-hidden />
                    )}</span>}
                  <span className="truncate">{isApplying ? "Analyzing..." : "Apply Ducking"}</span>
                </Button>
              ) : (
                <div className="space-y-2">
                  <Card className="min-w-0 rounded-[7px] shadow-none bg-status-success/10 text-fg p-2 flex items-center gap-2 border border-green-500/20"
                  >
                    <Check size={12} className="text-green-400" aria-hidden />
                    <span className="font-normal text-[10px] text-green-400">
                      Ducking Applied
                    </span>
                  </Card>
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={handleApplyDucking} type="button" aria-label={(isApplying ? "Updating..." : "Update").trim() || undefined} disabled={(isApplying)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg">
                      {(isApplying) ? <span aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<RefreshCw
                          size={10}
                          className={isApplying ? "animate-spin" : undefined}
                          aria-hidden
                        />}</span>}
                      <span className="truncate">{isApplying ? "Updating..." : "Update"}</span>
                    </Button>
                    <Button onClick={handleRemoveDucking} type="button" aria-label="Remove" disabled={(isApplying)} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 hover:bg-bg-3 hover:text-fg text-red-400">
                      <span className="truncate">{"Remove"}</span>
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {errorMessage && (
        <Card className="min-w-0 rounded-[7px] shadow-none bg-status-error/10 text-fg p-2 flex items-center gap-2 border border-red-500/20"
        >
          <AlertCircle size={12} className="text-red-400" aria-hidden />
          <span className="font-normal text-[9px] text-red-400">
            {errorMessage}
          </span>
        </Card>
      )}

      <div className="pt-2 border-t border-border">
        <span className="text-fg-2 font-normal block text-[9px] text-center">
          Automatically reduces music volume when voice is detected
        </span>
      </div>
    </div>
  );
};

