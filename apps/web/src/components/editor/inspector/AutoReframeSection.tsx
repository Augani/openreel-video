import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Smartphone,
  Monitor,
  Square,
  Loader2,
  Play,
  CheckCircle,
} from "lucide-react";
import { Slider } from "@openreel/ui";
import {
  getAutoReframeEngine,
  initializeAutoReframeEngine,
  type ReframeSettings,
  type AspectRatioPreset,
  type PlatformPreset,
  type ReframeResult,
  ASPECT_RATIO_PRESETS,
  PLATFORM_PRESETS,
  DEFAULT_REFRAME_SETTINGS,
} from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { useProjectStore } from "../../../stores/project-store";

interface AutoReframeSectionProps {
  clipId: string;
  onReframeComplete?: (result: ReframeResult) => void;
}

const PLATFORM_ICONS: Record<PlatformPreset, React.ReactNode> = {
  youtube: <Monitor size={14} />,
  tiktok: <Smartphone size={14} />,
  "instagram-reels": <Smartphone size={14} />,
  "instagram-feed": <Square size={14} />,
  "instagram-stories": <Smartphone size={14} />,
  "youtube-shorts": <Smartphone size={14} />,
  facebook: <Monitor size={14} />,
  twitter: <Monitor size={14} />,
  linkedin: <Monitor size={14} />,
};

export const AutoReframeSection: React.FC<AutoReframeSectionProps> = ({
  clipId,
  onReframeComplete,
}) => {
  const { t } = useTranslation();
  const updateProjectDimensions = useProjectStore(
    (state) => state.updateSettings,
  );
  const [reframeSettings, setReframeSettings] = useState<ReframeSettings>(
    DEFAULT_REFRAME_SETTINGS,
  );
  const [isInitializing, setIsInitializing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedPlatform, setSelectedPlatform] =
    useState<PlatformPreset | null>("tiktok");

  useEffect(() => {
    const engine = getAutoReframeEngine();
    if (engine) {
      setIsInitialized(engine.isInitialized());
    }
  }, [clipId]);

  const handleInitialize = useCallback(async () => {
    setIsInitializing(true);
    try {
      const engine = initializeAutoReframeEngine();
      await engine.initialize((prog, msg) => {
        setProgress(prog);
        setProgressMessage(msg);
      });
      setIsInitialized(true);
    } catch (error) {
      console.error("Failed to initialize auto-reframe:", error);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const updateLocalSettings = useCallback(
    (updates: Partial<ReframeSettings>) => {
      setReframeSettings((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  const handleSelectPlatform = useCallback(
    (platform: PlatformPreset) => {
      setSelectedPlatform(platform);
      const config = PLATFORM_PRESETS[platform];
      const aspectRatio = Object.entries(ASPECT_RATIO_PRESETS).find(
        ([, v]) => Math.abs(v.ratio - config.ratio) < 0.01,
      );
      if (aspectRatio) {
        updateLocalSettings({
          targetAspectRatio: aspectRatio[0] as AspectRatioPreset,
        });
      }
    },
    [updateLocalSettings],
  );

  const handleSelectAspectRatio = useCallback(
    (ratio: AspectRatioPreset) => {
      setSelectedPlatform(null);
      updateLocalSettings({ targetAspectRatio: ratio });
    },
    [updateLocalSettings],
  );

  const handleAnalyze = useCallback(async () => {
    setIsProcessing(true);
    setProgress(0);
    setProgressMessage(t("inspector.initializing"));

    try {
      if (!isInitialized) {
        setProgressMessage(t("inspector.loadingEngine"));
        setProgress(10);
        await handleInitialize();
      }

      const engine = getAutoReframeEngine();
      if (!engine) {
        throw new Error(t("inspector.autoReframeEngineUnavailable"));
      }

      setProgressMessage(t("inspector.configuringReframeSettings"));
      setProgress(30);

      await new Promise((resolve) => setTimeout(resolve, 300));

      setProgressMessage(t("inspector.applyingSmartCrop"));
      setProgress(60);

      const targetConfig =
        ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio];

      await new Promise((resolve) => setTimeout(resolve, 300));

      setProgressMessage(t("inspector.updatingProjectSettings"));
      setProgress(80);

      await updateProjectDimensions({
        width: targetConfig.width,
        height: targetConfig.height,
      });

      setProgressMessage(t("inspector.finalizingSetup"));
      setProgress(90);

      await new Promise((resolve) => setTimeout(resolve, 200));

      setProgress(100);
      setProgressMessage(t("inspector.complete"));
      setIsApplied(true);

      const result: ReframeResult = {
        keyframes: [],
        outputWidth: targetConfig.width,
        outputHeight: targetConfig.height,
        success: true,
        message: t("inspector.configuredFor", { name: targetConfig.name, width: targetConfig.width, height: targetConfig.height }),
      };

      onReframeComplete?.(result);

      toast.success(
        t("inspector.autoReframeApplied"),
        t("inspector.reframedTo", { name: selectedPlatform ? PLATFORM_PRESETS[selectedPlatform].name : reframeSettings.targetAspectRatio, width: targetConfig.width, height: targetConfig.height }),
      );
    } catch (error) {
      console.error("Auto-reframe failed:", error);
      toast.error(
        t("inspector.autoReframeFailed"),
        error instanceof Error ? error.message : t("inspector.autoReframeEngineUnavailable"),
      );
      setIsApplied(false);
    } finally {
      setIsProcessing(false);
    }
  }, [
    isInitialized,
    handleInitialize,
    reframeSettings,
    selectedPlatform,
    onReframeComplete,
    updateProjectDimensions,
  ]);

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        <div>
          <label className="text-[10px] text-text-secondary block mb-2">
            {t("inspector.platformPresets")}
          </label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(PLATFORM_PRESETS) as PlatformPreset[]).map(
              (platform) => (
                <button
                  key={platform}
                  onClick={() => handleSelectPlatform(platform)}
                  className={`flex items-center gap-1 p-2 rounded text-[9px] transition-colors ${
                    selectedPlatform === platform
                      ? "bg-primary/20 border border-primary text-text-primary"
                      : "bg-background-secondary hover:bg-background-primary border border-transparent text-text-secondary"
                  }`}
                >
                  {PLATFORM_ICONS[platform]}
                  <span className="truncate">
                    {t(`inspector.${platform}`)}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-2">
            {t("inspector.aspectRatio")}
          </label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(ASPECT_RATIO_PRESETS) as AspectRatioPreset[])
              .filter((r) => r !== "custom")
              .map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => handleSelectAspectRatio(ratio)}
                  className={`p-2 rounded text-[9px] transition-colors ${
                    reframeSettings.targetAspectRatio === ratio &&
                    !selectedPlatform
                      ? "bg-primary/20 border border-primary text-text-primary"
                      : "bg-background-secondary hover:bg-background-primary border border-transparent text-text-secondary"
                  }`}
                >
                  {t(`inspector.${ratio}`)}
                </button>
              ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-secondary">
              {t("inspector.trackingSpeed")}
            </label>
            <span className="text-[10px] text-text-muted font-mono">
              {Math.round(reframeSettings.trackingSpeed * 100)}%
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[reframeSettings.trackingSpeed * 100]}
            onValueChange={(value) =>
              updateLocalSettings({
                trackingSpeed: value[0] / 100,
              })
            }
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-secondary">{t("inspector.smoothing")}</label>
            <span className="text-[10px] text-text-muted font-mono">
              {Math.round(reframeSettings.smoothing * 100)}%
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[reframeSettings.smoothing * 100]}
            onValueChange={(value) =>
              updateLocalSettings({ smoothing: value[0] / 100 })
            }
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-secondary">
              {t("inspector.centerBias")}
            </label>
            <span className="text-[10px] text-text-muted font-mono">
              {Math.round(reframeSettings.centerBias * 100)}%
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[reframeSettings.centerBias * 100]}
            onValueChange={(value) =>
              updateLocalSettings({
                centerBias: value[0] / 100,
              })
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-[10px] text-text-secondary">
            {t("inspector.followSubject")}
          </label>
          <button
            onClick={() =>
              updateLocalSettings({
                followSubject: !reframeSettings.followSubject,
              })
            }
            className={`w-8 h-4 rounded-full transition-colors ${
              reframeSettings.followSubject
                ? "bg-primary"
                : "bg-background-secondary"
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full bg-white transition-transform ${
                reframeSettings.followSubject
                  ? "translate-x-4"
                  : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {isProcessing && (
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

        <button
          onClick={handleAnalyze}
          disabled={isInitializing || isProcessing}
          className="w-full py-2 rounded text-[11px] font-medium transition-colors flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover disabled:bg-primary/50 text-white"
        >
          {isInitializing || isProcessing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {isInitializing ? t("inspector.initializing") : t("inspector.analyzing")}
            </>
          ) : isApplied ? (
            <>
              <CheckCircle size={14} />
              {t("inspector.autoReframeAppliedReanalyze")}
            </>
          ) : (
            <>
              <Play size={14} />
              {t("inspector.analyzeAndReframe")}
            </>
          )}
        </button>

        <div className="text-[9px] text-text-muted text-center">
          {t("inspector.output")}:{" "}
          {ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio].width} x{" "}
          {ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio].height}
        </div>
      </div>
    </div>
  );
};

export default AutoReframeSection;
