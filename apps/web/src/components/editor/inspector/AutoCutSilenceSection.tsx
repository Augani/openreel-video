import React, { useState, useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
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
}) => {
  const { getClip, getMediaItem } = useProjectStore();
  const [settings, setSettings] = useState<SilenceSettings>(
    DEFAULT_SILENCE_SETTINGS,
  );
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

    try {
      const bridge = getSilenceCutBridge();
      const result = await bridge.analyzeClip(clipId, settings, (prog, msg) => {
        setProgress(prog);
        setProgressMessage(msg);
      });

      setAnalysisResult(result);

      if (result.silentRegions.length === 0) {
        toast.info(
          "No Silence Detected",
          "No silent sections found with current settings. Try lowering the threshold.",
        );
      }
    } catch (error) {
      console.error("Silence analysis failed:", error);
      toast.error(
        "Analysis Failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [clipId, settings]);

  const handleCutSilence = useCallback(async () => {
    if (!analysisResult || analysisResult.silentRegions.length === 0) return;

    setIsCutting(true);
    setProgress(0);
    setProgressMessage("Preparing...");

    try {
      const bridge = getSilenceCutBridge();
      const result = await bridge.cutSilence(
        clipId,
        analysisResult.silentRegions,
        (prog, msg) => {
          setProgress(prog);
          setProgressMessage(msg);
        },
      );

      if (result.success) {
        toast.success(
          "Silence Removed",
          `Removed ${analysisResult.silentRegions.length} silent section${analysisResult.silentRegions.length > 1 ? "s" : ""}`,
        );
        setAnalysisResult(null);
      } else {
        toast.error("Cut Failed", result.error ?? "Unknown error");
      }
    } catch (error) {
      console.error("Cut silence failed:", error);
      toast.error(
        "Cut Failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsCutting(false);
    }
  }, [clipId, analysisResult]);

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
          <Card variant="muted" padding={3}>
            <div className="flex items-center justify-between mb-1">
              <Text type="supporting" color="secondary">
                Silent Sections Found
              </Text>
              <Text type="body" color="primary" weight="bold">
                {analysisResult.silentRegions.length}
              </Text>
            </div>
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary">
                Total Silence
              </Text>
              <Text type="supporting" color="primary">
                {analysisResult.totalSilenceDuration.toFixed(1)}s of{" "}
                {analysisResult.clipDuration.toFixed(1)}s (
                {Math.round(
                  (analysisResult.totalSilenceDuration /
                    analysisResult.clipDuration) *
                    100,
                )}
                %)
              </Text>
            </div>
          </Card>
        )}

        {(isAnalyzing || isCutting) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[9px]">
                {progressMessage}
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {progress}%
              </Text>
            </div>
            <div className="h-1 bg-bg-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            label={isAnalyzing ? "Analyzing..." : analysisResult ? "Re-analyze" : "Analyze"}
            size="sm"
            variant={analysisResult ? "secondary" : "primary"}
            icon={
              isAnalyzing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Search size={14} aria-hidden />
              )
            }
            onClick={handleAnalyze}
            isDisabled={isAnalyzing || isCutting}
            className={`flex-1 py-2 rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2 ${
              analysisResult
                ? "bg-bg-1 hover:bg-background-primary border border-border text-fg"
                : "bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white"
            }`}
          />

          {analysisResult && analysisResult.silentRegions.length > 0 && (
            <Button
              label={
                isCutting
                  ? "Cutting..."
                  : `Cut ${analysisResult.silentRegions.length}`
              }
              size="sm"
              variant="primary"
              icon={
                isCutting ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Scissors size={14} aria-hidden />
                )
              }
              onClick={handleCutSilence}
              isDisabled={isCutting}
              className="flex-1 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2"
            />
          )}
        </div>

        <Text type="supporting" color="secondary" className="text-center text-[9px]">
          Tip: Use Ctrl+Z to undo all cuts at once
        </Text>
      </div>
    </div>
  );
};

export default AutoCutSilenceSection;
