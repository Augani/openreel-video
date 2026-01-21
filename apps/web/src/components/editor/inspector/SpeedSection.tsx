import React, { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import type { Clip } from "@openreel/core";
import { getSpeedEngine } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { Input, Switch, Label } from "@openreel/ui";

interface SpeedSectionProps {
  clip: Clip;
}

const SPEED_PRESETS = [
  { label: "0.25×", value: 0.25 },
  { label: "0.5×", value: 0.5 },
  { label: "0.75×", value: 0.75 },
  { label: "1×", value: 1 },
  { label: "1.25×", value: 1.25 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
  { label: "3×", value: 3 },
  { label: "5×", value: 5 },
];

export const SpeedSection: React.FC<SpeedSectionProps> = ({ clip }) => {
  const speedEngine = getSpeedEngine();
  const { project } = useProjectStore();

  const [currentSpeed, setCurrentSpeed] = useState(
    speedEngine.getClipSpeed(clip.id) || 1,
  );
  const [isReversed, setIsReversed] = useState(() => {
    const speedData = speedEngine.getClipSpeedData(clip.id);
    return speedData?.reverse || false;
  });

  const [customSpeed, setCustomSpeed] = useState<string>(
    currentSpeed.toString(),
  );
  const [affectAudio, setAffectAudio] = useState(true);

  useEffect(() => {
    setCustomSpeed(currentSpeed.toString());
  }, [currentSpeed]);

  const hasAudio = () => {
    const audioTrack = project.timeline.tracks.find(
      (track) =>
        track.type === "audio" &&
        track.clips.some((audioClip) => audioClip.mediaId === clip.mediaId),
    );
    return !!audioTrack;
  };

  const updateClipDuration = (speed: number) => {
    const originalDuration = clip.outPoint - clip.inPoint;
    const newDuration = originalDuration / speed;

    const tracks = project.timeline.tracks.map((track) => {
      const clipIndex = track.clips.findIndex((c) => c.id === clip.id);
      if (clipIndex === -1) {
        if (affectAudio && track.type === "audio") {
          const audioClipIndex = track.clips.findIndex(
            (c) => c.mediaId === clip.mediaId,
          );
          if (audioClipIndex !== -1) {
            const audioClip = track.clips[audioClipIndex];
            const updatedAudioClip = {
              ...audioClip,
              duration: newDuration,
              speed,
            };
            const newClips = [...track.clips];
            newClips[audioClipIndex] = updatedAudioClip;
            speedEngine.setClipSpeed(audioClip.id, speed, audioClip.duration);
            return { ...track, clips: newClips };
          }
        }
        return track;
      }

      const updatedClip = {
        ...track.clips[clipIndex],
        duration: newDuration,
        speed,
      };
      const newClips = [...track.clips];
      newClips[clipIndex] = updatedClip;

      return { ...track, clips: newClips };
    });

    useProjectStore.setState({
      project: {
        ...project,
        timeline: { ...project.timeline, tracks },
        modifiedAt: Date.now(),
      },
    });
  };

  const updateClipReverse = (reversed: boolean) => {
    const tracks = project.timeline.tracks.map((track) => {
      const clipIndex = track.clips.findIndex((c) => c.id === clip.id);
      if (clipIndex === -1) {
        if (affectAudio && track.type === "audio") {
          const audioClipIndex = track.clips.findIndex(
            (c) => c.mediaId === clip.mediaId,
          );
          if (audioClipIndex !== -1) {
            const audioClip = track.clips[audioClipIndex];
            const updatedAudioClip = { ...audioClip, reversed };
            const newClips = [...track.clips];
            newClips[audioClipIndex] = updatedAudioClip;
            speedEngine.setReverse(audioClip.id, reversed, audioClip.duration);
            return { ...track, clips: newClips };
          }
        }
        return track;
      }

      const updatedClip = { ...track.clips[clipIndex], reversed };
      const newClips = [...track.clips];
      newClips[clipIndex] = updatedClip;

      return { ...track, clips: newClips };
    });

    useProjectStore.setState({
      project: {
        ...project,
        timeline: { ...project.timeline, tracks },
        modifiedAt: Date.now(),
      },
    });
  };

  const handleSpeedPreset = (speed: number) => {
    speedEngine.setClipSpeed(clip.id, speed, clip.duration);
    updateClipDuration(speed);
    setCurrentSpeed(speed);
  };

  const handleCustomSpeed = () => {
    const speed = parseFloat(customSpeed);
    if (!isNaN(speed) && speed >= 0.1 && speed <= 100) {
      speedEngine.setClipSpeed(clip.id, speed, clip.duration);
      updateClipDuration(speed);
      setCurrentSpeed(speed);
    }
  };

  const handleToggleReverse = () => {
    const newReversed = !isReversed;
    speedEngine.setReverse(clip.id, newReversed, clip.duration);
    updateClipReverse(newReversed);
    setIsReversed(newReversed);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {SPEED_PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => handleSpeedPreset(preset.value)}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
              currentSpeed === preset.value
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "bg-background-tertiary hover:bg-background-elevated text-text-secondary hover:text-text-primary border border-border"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-tertiary">Custom Speed</Label>
        <div className="flex gap-2">
          <Input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={customSpeed}
            onChange={(e) => setCustomSpeed(e.target.value)}
            onBlur={handleCustomSpeed}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCustomSpeed();
              }
            }}
            className="flex-1 bg-background-tertiary border-border text-text-primary"
            placeholder="1.0"
          />
          <span className="flex items-center text-xs text-text-tertiary">
            ×
          </span>
        </div>
        <p className="text-xs text-text-tertiary">
          Range: 0.1× (slowest) to 100× (fastest)
        </p>
      </div>

      {hasAudio() && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary border border-border">
          <Label htmlFor="affect-audio" className="text-xs text-text-secondary">
            Apply speed to audio
          </Label>
          <Switch
            id="affect-audio"
            checked={affectAudio}
            onCheckedChange={setAffectAudio}
          />
        </div>
      )}

      <button
        onClick={handleToggleReverse}
        className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
          isReversed
            ? "bg-primary text-white shadow-lg shadow-primary/20"
            : "bg-background-tertiary hover:bg-background-elevated text-text-secondary hover:text-text-primary border border-border"
        }`}
      >
        <RotateCcw size={14} />
        {isReversed ? "Reversed" : "Reverse Clip"}
      </button>

      {(currentSpeed !== 1 || isReversed) && (
        <div className="p-3 rounded-lg bg-background-tertiary border border-border">
          <div className="text-xs text-text-tertiary mb-1">
            Current Settings
          </div>
          <div className="text-sm text-text-primary">
            Speed: {currentSpeed}× {isReversed && "• Reversed"}
          </div>
        </div>
      )}
    </div>
  );
};
