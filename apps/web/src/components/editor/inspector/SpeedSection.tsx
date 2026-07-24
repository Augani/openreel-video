import React, { useState, useEffect } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { RotateCcw, Sparkles } from "@/icons/lucide-compat";
import type { Clip } from "@openreel/core";
import { getSpeedEngine } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { MockToggle } from "./shell/InspectorControls";

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

  const linkedAudioClip = () => {
    if (!affectAudio) return undefined;
    for (const track of project.timeline.tracks) {
      if (track.type !== "audio") continue;
      const audioClip = track.clips.find((c) => c.mediaId === clip.mediaId);
      if (audioClip) return audioClip;
    }
    return undefined;
  };

  const updateClipDuration = (speed: number) => {
    const store = useProjectStore.getState();
    void store.executeAction({
      type: "clip/setSpeed",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { clipId: clip.id, speed },
    });
    const audioClip = linkedAudioClip();
    if (audioClip) {
      void store.executeAction({
        type: "clip/setSpeed",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId: audioClip.id, speed },
      });
      speedEngine.setClipSpeed(audioClip.id, speed, audioClip.duration);
    }
  };

  const updateClipReverse = (reversed: boolean) => {
    const store = useProjectStore.getState();
    void store.executeAction({
      type: "clip/setReverse",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { clipId: clip.id, reversed },
    });
    const audioClip = linkedAudioClip();
    if (audioClip) {
      void store.executeAction({
        type: "clip/setReverse",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId: audioClip.id, reversed },
      });
      speedEngine.setReverse(audioClip.id, reversed, audioClip.duration);
    }
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
          <ClickableCard
            key={preset.value}
            label={`Set speed to ${preset.label}`}
            onClick={() => handleSpeedPreset(preset.value)}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all ${
              currentSpeed === preset.value
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "bg-bg-2 hover:bg-bg-elev text-fg-2 hover:text-fg border border-border"
            }`}
          >
            {preset.label}
          </ClickableCard>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <ToolcraftTextInputControl
            label="Custom Speed"
            value={customSpeed}
            onChange={setCustomSpeed}
            onBlur={handleCustomSpeed}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCustomSpeed();
              }
            }}
            placeholder="1.0"
            width="100%"
          />
          <Text type="supporting" color="secondary" className="flex items-center text-xs">
            ×
          </Text>
        </div>
        <Text type="supporting" color="secondary" className="text-xs">
          Range: 0.1× (slowest) to 100× (fastest)
        </Text>
      </div>

      {hasAudio() && (
        <Card
          variant="muted"
          padding={3}
          className="flex items-center justify-between border border-border"
        >
          <Text type="supporting" color="secondary" className="text-xs">
            Apply speed to audio
          </Text>
          <MockToggle
            checked={affectAudio}
            onChange={setAffectAudio}
            ariaLabel="Apply speed to audio"
          />
        </Card>
      )}

      <Button
        label={isReversed ? "Reversed" : "Reverse Clip"}
        icon={<RotateCcw size={14} />}
        variant={isReversed ? "primary" : "secondary"}
        size="sm"
        onClick={handleToggleReverse}
        className="w-full justify-center"
      />

      {currentSpeed < 1 && (
        <Card variant="muted" padding={3} className="space-y-2 border border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary" />
              <Text type="supporting" color="secondary" className="text-xs">
                Smooth Slow Motion
              </Text>
            </div>
            <MockToggle
              ariaLabel="Smooth Slow Motion"
              checked={clip.smoothSlowMo ?? false}
              onChange={(checked) => {
                const tracks = project.timeline.tracks.map((track) => {
                  const clipIndex = track.clips.findIndex((c) => c.id === clip.id);
                  if (clipIndex === -1) return track;
                  const updatedClip = { ...track.clips[clipIndex], smoothSlowMo: checked };
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
              }}
            />
          </div>
          {clip.smoothSlowMo && (
            <div className="space-y-1">
              <Selector
                label="Quality"
                size="sm"
                width="100%"
                value={clip.interpolationQuality ?? "medium"}
                options={[
                  { label: "Low (faster)", value: "low" },
                  { label: "Medium", value: "medium" },
                  { label: "High (slower)", value: "high" },
                ]}
                onChange={(value) => {
                  const tracks = project.timeline.tracks.map((track) => {
                    const clipIndex = track.clips.findIndex((c) => c.id === clip.id);
                    if (clipIndex === -1) return track;
                    const updatedClip = {
                      ...track.clips[clipIndex],
                      interpolationQuality: value as "low" | "medium" | "high",
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
                }}
              />
              <Text type="supporting" color="secondary" className="text-[10px]">
                Uses optical flow to generate smooth in-between frames
              </Text>
            </div>
          )}
        </Card>
      )}

      {(currentSpeed !== 1 || isReversed) && (
        <Card variant="muted" padding={3} className="border border-border">
          <Text type="supporting" color="secondary" className="mb-1 block text-xs">
            Current Settings
          </Text>
          <Text type="body" color="primary" className="block text-sm">
            Speed: {currentSpeed}× {isReversed && "• Reversed"}
            {clip.smoothSlowMo && " • Smooth"}
          </Text>
        </Card>
      )}
    </div>
  );
};
