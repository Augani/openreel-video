import React, { useState, useCallback } from "react";
import { Video } from "lucide-react";
import type { Clip } from "@openreel/core";
import { getStabilizationEngine } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { Switch, Label, Slider, Button } from "@openreel/ui";

interface StabilizationSectionProps {
  clip: Clip;
}

export const StabilizationSection: React.FC<StabilizationSectionProps> = ({
  clip,
}) => {
  const { project, getMediaItem } = useProjectStore();
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  const stabilization = clip.stabilization ?? {
    enabled: false,
    strength: 50,
    cropMode: "auto" as const,
    analyzed: false,
  };

  const updateStabilization = useCallback(
    (updates: Partial<typeof stabilization>) => {
      const newStabilization = { ...stabilization, ...updates };

      const tracks = project.timeline.tracks.map((track) => {
        const clipIndex = track.clips.findIndex((c) => c.id === clip.id);
        if (clipIndex === -1) return track;

        const updatedClip = {
          ...track.clips[clipIndex],
          stabilization: newStabilization,
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
    },
    [clip.id, project, stabilization],
  );

  const handleAnalyze = useCallback(async () => {
    const mediaItem = getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) return;

    setAnalyzing(true);
    setProgress(0);

    try {
      const url = URL.createObjectURL(mediaItem.blob);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Failed to load video"));
        setTimeout(() => reject(new Error("Timeout")), 10000);
      });

      const duration = clip.outPoint - clip.inPoint;
      const stabEngine = getStabilizationEngine();

      await stabEngine.analyzeClip(
        clip.id,
        video,
        duration,
        {
          strength: stabilization.strength,
          cropMode: stabilization.cropMode,
          analysisInterval: 2,
        },
        (p) => setProgress(Math.round(p * 100)),
      );

      video.src = "";
      URL.revokeObjectURL(url);

      updateStabilization({ enabled: true, analyzed: true });
    } catch (error) {
      console.warn("Stabilization analysis failed:", error);
    } finally {
      setAnalyzing(false);
    }
  }, [clip.id, clip.mediaId, clip.outPoint, clip.inPoint, getMediaItem, stabilization.strength, stabilization.cropMode, updateStabilization]);

  const handleToggle = useCallback(
    (enabled: boolean) => {
      if (enabled && !stabilization.analyzed) {
        handleAnalyze();
        return;
      }
      updateStabilization({ enabled });
    },
    [stabilization.analyzed, handleAnalyze, updateStabilization],
  );

  const handleStrengthChange = useCallback(
    (value: number[]) => {
      const strength = value[0];
      updateStabilization({ strength });

      if (stabilization.analyzed) {
        const stabEngine = getStabilizationEngine();
        stabEngine.removeProfile(clip.id);
        updateStabilization({ strength, analyzed: false, enabled: false });
      }
    },
    [clip.id, stabilization.analyzed, updateStabilization],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm">
          <Video className="h-4 w-4" />
          Stabilize
        </Label>
        <Switch
          checked={stabilization.enabled}
          onCheckedChange={handleToggle}
          disabled={analyzing}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Strength</Label>
          <span className="text-xs text-muted-foreground">
            {stabilization.strength}%
          </span>
        </div>
        <Slider
          value={[stabilization.strength]}
          min={0}
          max={100}
          step={1}
          onValueChange={handleStrengthChange}
          disabled={analyzing}
        />
      </div>

      {analyzing && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Analyzing motion...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {stabilization.analyzed && !analyzing && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleAnalyze}
        >
          Re-analyze
        </Button>
      )}
    </div>
  );
};
