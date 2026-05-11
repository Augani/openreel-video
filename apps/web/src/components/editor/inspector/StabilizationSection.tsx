import React, { useState, useCallback } from "react";
import { Video, Download } from "lucide-react";
import type { Clip } from "@openreel/core";
import { getVidstabEngine, type VidstabProgress } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { Switch, Label, Slider, Button } from "@openreel/ui";

interface StabilizationSectionProps {
  clip: Clip;
}

export const StabilizationSection: React.FC<StabilizationSectionProps> = ({
  clip,
}) => {
  const { project, getMediaItem } = useProjectStore();
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<VidstabProgress["stage"] | null>(null);
  const [progress, setProgress] = useState(0);

  const stabilization = clip.stabilization ?? {
    enabled: false,
    strength: 50,
    cropMode: "auto" as const,
    analyzed: false,
  };

  const vidstabEngine = getVidstabEngine();
  const isStabilized = vidstabEngine.hasStabilized(clip.id);

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

  const handleStabilize = useCallback(async () => {
    const mediaItem = getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) return;

    setProcessing(true);
    setProgress(0);
    setStage("downloading");

    try {
      await vidstabEngine.load((p) => {
        setStage(p.stage);
        setProgress(Math.round(p.progress * 100));
      });

      setStage("detecting");
      setProgress(0);

      await vidstabEngine.stabilize(
        clip.id,
        mediaItem.blob,
        {
          strength: stabilization.strength,
          cropMode: stabilization.cropMode,
          analysisInterval: 1,
        },
        (p) => {
          setStage(p.stage);
          setProgress(Math.round(p.progress * 100));
        },
      );

      updateStabilization({ enabled: true, analyzed: true });
    } catch (error) {
      console.warn("Stabilization failed:", error);
    } finally {
      setProcessing(false);
      setStage(null);
    }
  }, [
    clip.id,
    clip.mediaId,
    getMediaItem,
    vidstabEngine,
    stabilization.strength,
    stabilization.cropMode,
    updateStabilization,
  ]);

  const handleToggle = useCallback(
    (enabled: boolean) => {
      if (enabled && !isStabilized) {
        handleStabilize();
        return;
      }
      updateStabilization({ enabled });
    },
    [isStabilized, handleStabilize, updateStabilization],
  );

  const handleStrengthChange = useCallback(
    (value: number[]) => {
      const strength = value[0];
      if (isStabilized) {
        vidstabEngine.removeStabilized(clip.id);
        updateStabilization({
          strength,
          analyzed: false,
          enabled: false,
        });
        return;
      }
      updateStabilization({ strength });
    },
    [clip.id, isStabilized, vidstabEngine, updateStabilization],
  );

  const stageLabel = (() => {
    switch (stage) {
      case "downloading":
        return "Downloading stabilization engine...";
      case "detecting":
        return "Analyzing motion...";
      case "stabilizing":
        return "Stabilizing video...";
      default:
        return "";
    }
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm">
          <Video className="h-4 w-4" />
          Stabilize
        </Label>
        <Switch
          checked={stabilization.enabled && isStabilized}
          onCheckedChange={handleToggle}
          disabled={processing}
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
          min={10}
          max={100}
          step={5}
          onValueChange={handleStrengthChange}
          disabled={processing}
        />
      </div>

      {!vidstabEngine.isLoaded() && !processing && !isStabilized && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span>First use requires a one-time download (~65 MB)</span>
        </div>
      )}

      {processing && stage && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{stageLabel}</span>
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

      {isStabilized && !processing && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleStabilize}
        >
          Re-stabilize
        </Button>
      )}
    </div>
  );
};
