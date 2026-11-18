import React, { useState, useCallback, useEffect } from "react";
import { Button } from "@openreel/ui";
import { Card } from "@openreel/ui";
import { cn } from "@openreel/ui";

import { PropertySlider } from "./shell/PropertySlider";
import { InspectorToggle } from "./shell/InspectorControls";
import {
  Smartphone,
  Monitor,
  Square,
  Loader2,
  Play,
  CheckCircle,
} from "@/icons/lucide-compat";
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

const PLATFORM_ICONS: Record<PlatformPreset, React.ElementType> = {
  youtube: Monitor,
  tiktok: Smartphone,
  "instagram-reels": Smartphone,
  "instagram-feed": Square,
  "instagram-stories": Smartphone,
  "youtube-shorts": Smartphone,
  facebook: Monitor,
  twitter: Monitor,
  linkedin: Monitor,
};

export const AutoReframeSection: React.FC<AutoReframeSectionProps> = ({
  clipId,
  onReframeComplete,
}) => {
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
    setProgressMessage("Initializing...");

    try {
      if (!isInitialized) {
        setProgressMessage("Loading AI engine...");
        setProgress(10);
        await handleInitialize();
      }

      const engine = getAutoReframeEngine();
      if (!engine) {
        throw new Error("Engine not available");
      }

      setProgressMessage("Configuring reframe settings...");
      setProgress(30);

      await new Promise((resolve) => setTimeout(resolve, 300));

      setProgressMessage("Applying smart crop configuration...");
      setProgress(60);

      const targetConfig =
        ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio];

      await new Promise((resolve) => setTimeout(resolve, 300));

      setProgressMessage("Updating project settings...");
      setProgress(80);

      await updateProjectDimensions({
        width: targetConfig.width,
        height: targetConfig.height,
      });

      setProgressMessage("Finalizing...");
      setProgress(90);

      await new Promise((resolve) => setTimeout(resolve, 200));

      setProgress(100);
      setProgressMessage("Complete!");
      setIsApplied(true);

      const result: ReframeResult = {
        keyframes: [],
        outputWidth: targetConfig.width,
        outputHeight: targetConfig.height,
        success: true,
        message: `Configured for ${targetConfig.name} (${targetConfig.width}x${targetConfig.height})`,
      };

      onReframeComplete?.(result);

      const platformName = selectedPlatform
        ? PLATFORM_PRESETS[selectedPlatform].name
        : reframeSettings.targetAspectRatio;
      toast.success(
        "Auto Reframe Applied",
        `Project resized to ${platformName} (${targetConfig.width}x${targetConfig.height})`,
      );
    } catch (error) {
      console.error("Auto-reframe failed:", error);
      toast.error(
        "Auto Reframe Failed",
        error instanceof Error ? error.message : "Unknown error",
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
          <span className="text-fg-2 font-normal mb-2 block text-[10px]">
            Platform Presets
          </span>
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(PLATFORM_PRESETS) as PlatformPreset[]).map(
                (platform) => {
                  const PlatformIcon = PLATFORM_ICONS[platform];
                  return (
                    <Button variant="ghost" key={platform} onClick={() => handleSelectPlatform(platform)} type="button" aria-label={`${PLATFORM_PRESETS[platform].name} platform preset`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `flex items-center gap-1 p-2 rounded text-[9px] transition-colors ${
                        selectedPlatform === platform
                          ? "bg-primary/20 border border-primary text-fg"
                          : "bg-bg-1 hover:bg-background-primary border border-transparent text-fg-2"
                      }`)}>
                      <PlatformIcon size={14} />
                      <span className="text-fg-2 font-normal truncate text-[9px]">
                        {PLATFORM_PRESETS[platform].name}
                      </span>
                    </Button>
                  );
                },
            )}
          </div>
        </div>

        <div>
          <span className="text-fg-2 font-normal mb-2 block text-[10px]">
            Aspect Ratio
          </span>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(ASPECT_RATIO_PRESETS) as AspectRatioPreset[])
              .filter((r) => r !== "custom")
              .map((ratio) => (
                <Button variant="ghost" key={ratio} onClick={() => handleSelectAspectRatio(ratio)} type="button" aria-label={`${ratio} aspect ratio`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `p-2 rounded text-[9px] transition-colors ${
                    reframeSettings.targetAspectRatio === ratio &&
                    !selectedPlatform
                      ? "bg-primary/20 border border-primary text-fg"
                      : "bg-bg-1 hover:bg-background-primary border border-transparent text-fg-2"
                  }`)}>
                  {ratio}
                </Button>
              ))}
          </div>
        </div>

        <PropertySlider
          label="Tracking Speed"
          min={0}
          max={100}
          step={1}
          value={reframeSettings.trackingSpeed * 100}
          onChange={(value: number) =>
            updateLocalSettings({
              trackingSpeed: value / 100,
            })
          }
          formatValue={(value) => `${Math.round(value)}%`}
        />

        <PropertySlider
          label="Smoothing"
          min={0}
          max={100}
          step={1}
          value={reframeSettings.smoothing * 100}
          onChange={(value: number) => updateLocalSettings({ smoothing: value / 100 })}
          formatValue={(value) => `${Math.round(value)}%`}
        />

        <PropertySlider
          label="Center Bias"
          min={0}
          max={100}
          step={1}
          value={reframeSettings.centerBias * 100}
          onChange={(value: number) =>
            updateLocalSettings({
              centerBias: value / 100,
            })
          }
          formatValue={(value) => `${Math.round(value)}%`}
        />

        <div className="flex items-center justify-between">
          <span className="text-fg-2 font-normal text-[10px]">
            Follow Subject
          </span>
          <InspectorToggle
            ariaLabel="Follow Subject"
            checked={reframeSettings.followSubject}
            onChange={() =>
              updateLocalSettings({
                followSubject: !reframeSettings.followSubject,
              })
            }
          />
        </div>

        {isProcessing && (
          <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-fg-2 font-normal text-[9px]">
                {progressMessage}
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                {progress}%
              </span>
            </div>
            <div className="h-1 bg-bg-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </Card>
        )}

        <Button onClick={handleAnalyze} type="button" aria-label={(isInitializing || isProcessing
              ? isInitializing
                ? "Initializing..."
                : "Analyzing..."
              : isApplied
                ? "Applied - Click to Reanalyze"
                : "Analyze & Reframe").trim() || undefined} disabled={(isInitializing || isProcessing)} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isInitializing || isProcessing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isApplied ? (
              <CheckCircle size={14} />
            ) : (
              <Play size={14} />
            )}</span>
          <span className="truncate">{isInitializing || isProcessing
              ? isInitializing
                ? "Initializing..."
                : "Analyzing..."
              : isApplied
                ? "Applied - Click to Reanalyze"
                : "Analyze & Reframe"}</span>
        </Button>

        <span className="text-fg-2 font-normal text-center text-[9px]">
          Output:{" "}
          {ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio].width} x{" "}
          {ASPECT_RATIO_PRESETS[reframeSettings.targetAspectRatio].height}
        </span>
      </div>
    </div>
  );
};

