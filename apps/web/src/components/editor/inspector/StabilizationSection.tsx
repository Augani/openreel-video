import React, { useState, useCallback } from "react";
import { Button } from "@openreel/ui";
import { Card } from "@openreel/ui";

import { Video, Download } from "@/icons/lucide-compat";
import { PropertySlider } from "./shell/PropertySlider";
import { InspectorToggle } from "./shell/InspectorControls";
import type { Clip } from "@openreel/core";
import { getVidstabEngine, type VidstabProgress } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

interface StabilizationSectionProps {
  clip: Clip;
}

export const StabilizationSection: React.FC<StabilizationSectionProps> = ({
  clip,
}) => {
  const { getMediaItem } = useProjectStore();
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState<VidstabProgress["stage"] | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
      void useProjectStore.getState().executeAction({
        type: "clip/setStabilization",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        params: { clipId: clip.id, stabilization: newStabilization },
      });
    },
    [clip.id, stabilization],
  );

  const handleStabilize = useCallback(async () => {
    const mediaItem = getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) return;

    setProcessing(true);
    setProgress(0);
    setError(null);
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
        { inPoint: clip.inPoint, outPoint: clip.outPoint },
      );

      updateStabilization({ enabled: true, analyzed: true });
    } catch (error) {
      console.error("Stabilization failed:", error);
      setStage(null);
      setError(error instanceof Error ? error.message : "Stabilization failed");
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
        <span className="text-fg font-normal flex items-center gap-2 text-sm">
          <Video className="h-4 w-4" />
          Stabilize
        </span>
        <InspectorToggle
          ariaLabel="Enable stabilization"
          checked={stabilization.enabled && isStabilized}
          onChange={handleToggle}
          isDisabled={processing}
        />
      </div>

      <PropertySlider
        label="Strength"
        value={stabilization.strength}
        min={10}
        max={100}
        step={5}
        onChange={(value: number) => handleStrengthChange([value])}
        isDisabled={processing}
        formatValue={(value) => `${Math.round(value)}%`}
      />

      {!vidstabEngine.isLoaded() && !processing && !isStabilized && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 flex items-center gap-2 border border-border/60 bg-muted/40"
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="text-fg-2 font-normal text-[11px]">
            First use requires a one-time download (~65 MB)
          </span>
        </Card>
      )}

      {processing && stage && (
        <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-fg-2 font-normal text-xs">
              {stageLabel}
            </span>
            <span className="text-fg-2 font-normal text-xs">
              {progress}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </Card>
      )}

      {error && !processing && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 border border-destructive/50 bg-destructive/10">
          <span className="font-normal text-[11px] text-destructive">
          {error}
          </span>
        </Card>
      )}

      {isStabilized && !processing && (
        <Button onClick={handleStabilize} type="button" aria-label="Re-stabilize" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
          <span className="truncate">{"Re-stabilize"}</span>
        </Button>
      )}
    </div>
  );
};
