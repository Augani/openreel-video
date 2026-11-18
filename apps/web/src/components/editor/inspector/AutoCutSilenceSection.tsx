import React, { useState, useCallback } from "react";
import { Button, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";

import { Progress } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { Scissors, Search, Loader2 } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import {
  getSilenceCutBridge,
  DEFAULT_SILENCE_SETTINGS,
  type SilenceSettings,
  type SilenceAnalysisResult,
} from "../../../bridges/silence-cut-bridge";
import { toast } from "../../../stores/notification-store";

interface AutoCutSilenceSectionProps {
  clipId: string;
  initialSettings?: Partial<SilenceSettings>;
  onActivity?: (activity: SilenceActivity) => void;
}

export interface SilenceActivity {
  stage: 2 | 3 | 4;
  status: "running" | "ready" | "done" | "error";
  progress: number;
  message: string;
}

const SilenceSlider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  description?: string;
}> = ({ label, value, onChange, min, max, step, unit = "", description }) => (
  <PropertySlider
    label={label}
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={onChange}
    formatValue={(nextValue) =>
      `${Number(nextValue.toFixed(step < 1 ? 2 : 0))}${unit}`
    }
    description={description}
  />
);

export const AutoCutSilenceSection: React.FC<AutoCutSilenceSectionProps> = ({
  clipId,
  initialSettings,
  onActivity,
}) => {
  const { getClip, getMediaItem } = useProjectStore();
  const [settings, setSettings] = useState<SilenceSettings>({
    ...DEFAULT_SILENCE_SETTINGS,
    ...initialSettings,
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCutting, setIsCutting] = useState(false);
  const [analysisResult, setAnalysisResult] =
    useState<SilenceAnalysisResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  const clip = getClip(clipId);
  const mediaItem = clip ? getMediaItem(clip.mediaId) : undefined;
  const hasAudio = mediaItem?.type === "audio" || mediaItem?.type === "video";

  const updateSettings = useCallback((updates: Partial<SilenceSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    setAnalysisResult(null);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!clipId) return;

    setIsAnalyzing(true);
    setProgress(0);
    setProgressMessage("Initializing...");
    onActivity?.({
      stage: 2,
      status: "running",
      progress: 0,
      message: "Analyzing dialogue",
    });

    try {
      const bridge = getSilenceCutBridge();
      const result = await bridge.analyzeClip(clipId, settings, (prog, msg) => {
        setProgress(prog);
        setProgressMessage(msg);
        onActivity?.({
          stage: 2,
          status: "running",
          progress: prog,
          message: msg,
        });
      });

      setAnalysisResult(result);
      onActivity?.({
        stage: 3,
        status: "ready",
        progress: 100,
        message: result.silentRegions.length
          ? "Review the proposed cuts"
          : "No pauses found",
      });

      if (result.silentRegions.length === 0) {
        toast.info(
          "No Silence Detected",
          "No silent sections found with current settings. Try lowering the threshold.",
        );
      }
    } catch (error) {
      onActivity?.({
        stage: 2,
        status: "error",
        progress: 0,
        message: "Analysis failed",
      });
      console.error("Silence analysis failed:", error);
      toast.error(
        "Analysis Failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [clipId, settings, onActivity]);

  const handleCutSilence = useCallback(async () => {
    if (!analysisResult || analysisResult.silentRegions.length === 0) return;

    setIsCutting(true);
    setProgress(0);
    setProgressMessage("Preparing...");
    onActivity?.({
      stage: 4,
      status: "running",
      progress: 0,
      message: "Applying cuts",
    });

    try {
      const bridge = getSilenceCutBridge();
      const result = await bridge.cutSilence(
        clipId,
        analysisResult.silentRegions,
        (prog, msg) => {
          setProgress(prog);
          setProgressMessage(msg);
          onActivity?.({
            stage: 4,
            status: "running",
            progress: prog,
            message: msg,
          });
        },
      );

      if (result.success) {
        onActivity?.({
          stage: 4,
          status: "done",
          progress: 100,
          message: "Silence removed",
        });
        toast.success(
          "Silence Removed",
          `Removed ${analysisResult.silentRegions.length} silent section${analysisResult.silentRegions.length > 1 ? "s" : ""}`,
        );
        setAnalysisResult(null);
      } else {
        onActivity?.({
          stage: 4,
          status: "error",
          progress: 0,
          message: result.error ?? "Cut failed",
        });
        toast.error("Cut Failed", result.error ?? "Unknown error");
      }
    } catch (error) {
      onActivity?.({
        stage: 4,
        status: "error",
        progress: 0,
        message: "Cut failed",
      });
      console.error("Cut silence failed:", error);
      toast.error(
        "Cut Failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsCutting(false);
    }
  }, [clipId, analysisResult, onActivity]);

  if (!hasAudio) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <SilenceSlider
          label="Silence Threshold"
          min={-80}
          max={-20}
          step={1}
          value={settings.threshold}
          onChange={(threshold) => updateSettings({ threshold })}
          unit=" dB"
          description="Lower values detect more silence"
        />

        <SilenceSlider
          label="Min Duration"
          min={0.1}
          max={2.0}
          step={0.1}
          value={settings.minSilenceDuration}
          onChange={(minSilenceDuration) =>
            updateSettings({ minSilenceDuration })
          }
          unit="s"
          description="Minimum silence length to detect"
        />

        <div className="grid grid-cols-2 gap-2">
          <SilenceSlider
            label="Pad Before"
            min={0}
            max={2}
            step={0.05}
            value={settings.paddingBefore}
            onChange={(paddingBefore) => updateSettings({ paddingBefore })}
            unit="s"
          />
          <SilenceSlider
            label="Pad After"
            min={0}
            max={2}
            step={0.05}
            value={settings.paddingAfter}
            onChange={(paddingAfter) => updateSettings({ paddingAfter })}
            unit="s"
          />
        </div>

        {analysisResult && (
          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] leading-5 text-fg-2 font-normal">
                Silent Sections Found
              </span>
              <span className="text-[13px] leading-5 text-fg font-bold">
                {analysisResult.silentRegions.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] leading-5 text-fg-2 font-normal">
                Total Silence
              </span>
              <span className="text-[12px] leading-5 text-fg font-normal">
                {analysisResult.totalSilenceDuration.toFixed(1)}s of{" "}
                {analysisResult.clipDuration.toFixed(1)}s (
                {Math.round(
                  (analysisResult.totalSilenceDuration /
                    analysisResult.clipDuration) *
                    100,
                )}
                %)
              </span>
            </div>
          </Card>
        )}

        {(isAnalyzing || isCutting) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-fg-2 font-normal text-[9px]">
                {progressMessage}
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                {progress}%
              </span>
            </div>
            <Progress
              aria-label={isCutting ? "Silence cutting progress" : "Silence analysis progress"}
              value={progress}
              className="h-1 rounded-full bg-bg-1 [&>div]:bg-primary"
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleAnalyze} type="button" aria-label={(isAnalyzing
                ? "Analyzing..."
                : analysisResult
                  ? "Re-analyze"
                  : "Analyze").trim() || undefined} disabled={(isAnalyzing || isCutting)} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (analysisResult ? "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" : "bg-accent text-accent-fg hover:bg-accent/90"), `flex-1 py-2 rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2 ${
              analysisResult
                ? "bg-bg-1 hover:bg-background-primary border border-border text-fg"
                : "bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white"
            }`)}>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isAnalyzing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Search size={14} aria-hidden />
              )}</span>
            <span className="truncate">{isAnalyzing
                ? "Analyzing..."
                : analysisResult
                  ? "Re-analyze"
                  : "Analyze"}</span>
          </Button>

          {analysisResult && analysisResult.silentRegions.length > 0 && (
            <Button onClick={handleCutSilence} type="button" aria-label={(isCutting
                  ? "Cutting..."
                  : `Cut ${analysisResult.silentRegions.length}`).trim() || undefined} disabled={(isCutting)} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 flex-1 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isCutting ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Scissors size={14} aria-hidden />
                )}</span>
              <span className="truncate">{isCutting
                  ? "Cutting..."
                  : `Cut ${analysisResult.silentRegions.length}`}</span>
            </Button>
          )}
        </div>

        <span className="text-fg-2 font-normal text-center text-[9px]"
        >
          Tip: Use Ctrl+Z to undo all cuts at once
        </span>
      </div>
    </div>
  );
};

