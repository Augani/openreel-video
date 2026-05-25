import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Scissors, Search, Loader2, Volume2 } from "lucide-react";
import { Slider } from "@openreel/ui";
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

export const AutoCutSilenceSection: React.FC<AutoCutSilenceSectionProps> = ({
  clipId,
}) => {
  const { t } = useTranslation();
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
      setProgressMessage(t("inspector.initializing"));

    try {
      const bridge = getSilenceCutBridge();
      const result = await bridge.analyzeClip(clipId, settings, (prog, msg) => {
        setProgress(prog);
        setProgressMessage(msg);
      });

      setAnalysisResult(result);

      if (result.silentRegions.length === 0) {
        toast.info(
          t("inspector.autoCutNoSilence"),
          t("inspector.autoCutNoSilenceHint"),
        );
      }
    } catch (error) {
      console.error("Silence analysis failed:", error);
      toast.error(
        t("inspector.autoCutAnalysisFailed"),
        error instanceof Error ? error.message : t("inspector.autoCutUnknownError"),
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [clipId, settings]);

  const handleCutSilence = useCallback(async () => {
    if (!analysisResult || analysisResult.silentRegions.length === 0) return;

    setIsCutting(true);
    setProgress(0);
    setProgressMessage(t("inspector.preparing"));

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
          t("inspector.autoCutSilenceRemoved"),
          t("inspector.autoCutSilenceRemovedCount", { count: analysisResult.silentRegions.length }),
        );
        setAnalysisResult(null);
      } else {
        toast.error(t("inspector.autoCutFailed"), result.error ?? t("inspector.autoCutUnknownError"));
      }
    } catch (error) {
      console.error("Cut silence failed:", error);
      toast.error(
        t("inspector.autoCutFailed"),
        error instanceof Error ? error.message : t("inspector.autoCutUnknownError"),
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
        <div>
          <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-text-secondary flex items-center gap-1">
                <Volume2 size={10} />
                {t("inspector.silenceThreshold")}
              </label>
            <span className="text-[10px] text-text-muted font-mono">
              {settings.threshold} dB
            </span>
          </div>
          <Slider
            min={-80}
            max={-20}
            step={1}
            value={[settings.threshold]}
            onValueChange={(value) => updateSettings({ threshold: value[0] })}
          />
          <p className="text-[8px] text-text-muted mt-1">
            {t("inspector.autoCutLowerValues")}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-secondary">
              {t("inspector.minDuration")}
            </label>
            <span className="text-[10px] text-text-muted font-mono">
              {settings.minSilenceDuration.toFixed(1)}s
            </span>
          </div>
          <Slider
            min={0.1}
            max={2.0}
            step={0.1}
            value={[settings.minSilenceDuration]}
            onValueChange={(value) =>
              updateSettings({ minSilenceDuration: value[0] })
            }
          />
          <p className="text-[8px] text-text-muted mt-1">
            {t("inspector.autoCutMinDurationHint")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-text-secondary">
                {t("inspector.padBefore")}
              </label>
              <span className="text-[10px] text-text-muted font-mono">
                {settings.paddingBefore.toFixed(1)}s
              </span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[settings.paddingBefore]}
              onValueChange={(value) =>
                updateSettings({ paddingBefore: value[0] })
              }
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-text-secondary">
                {t("inspector.padAfter")}
              </label>
              <span className="text-[10px] text-text-muted font-mono">
                {settings.paddingAfter.toFixed(1)}s
              </span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[settings.paddingAfter]}
              onValueChange={(value) =>
                updateSettings({ paddingAfter: value[0] })
              }
            />
          </div>
        </div>

        {analysisResult && (
          <div className="p-2 bg-background-secondary rounded border border-primary/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-text-secondary">
                {t("inspector.silentSectionsFound")}
              </span>
              <span className="text-sm font-bold text-primary">
                {analysisResult.silentRegions.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-secondary">
                {t("inspector.totalSilence")}
              </span>
              <span className="text-[10px] text-text-primary">
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
          </div>
        )}

        {(isAnalyzing || isCutting) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-text-muted">
                {progressMessage}
              </span>
              <span className="text-[9px] text-text-muted">{progress}%</span>
            </div>
            <div className="h-1 bg-background-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || isCutting}
            className={`flex-1 py-2 rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2 ${
              analysisResult
                ? "bg-background-secondary hover:bg-background-primary border border-border text-text-primary"
                : "bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white"
            }`}
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("inspector.analyzing")}
              </>
            ) : (
              <>
                <Search size={14} />
                {analysisResult ? t("inspector.reanalyze") : t("inspector.analyze")}
              </>
            )}
          </button>

          {analysisResult && analysisResult.silentRegions.length > 0 && (
            <button
              onClick={handleCutSilence}
              disabled={isCutting}
              className="flex-1 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isCutting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("inspector.cutting")}
                </>
              ) : (
                <>
                  <Scissors size={14} />
                  {t("inspector.cut")} {analysisResult.silentRegions.length}
                </>
              )}
            </button>
          )}
        </div>

        <p className="text-[9px] text-text-muted text-center">
          {t("inspector.autoCutTip")}
        </p>
      </div>
    </div>
  );
};

export default AutoCutSilenceSection;
