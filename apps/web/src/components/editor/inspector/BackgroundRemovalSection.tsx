import React, { useState, useCallback, useEffect } from "react";
import { Button, cn } from "@openreel/ui";
import { Card } from "@openreel/ui";


import { PropertySlider } from "./shell/PropertySlider";
import {
  User,
  ImageIcon,
  Palette,
  Droplets,
  Loader2,
  Info,
} from "@/icons/lucide-compat";
import {
  getBackgroundRemovalEngine,
  initializeBackgroundRemovalEngine,
  type BackgroundRemovalSettings,
  type BackgroundMode,
  DEFAULT_BACKGROUND_SETTINGS,
} from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { useProcessingStore } from "../../../services/processing-manager";
import { ColorSelector } from "../../../motion/components/primitives";

interface BackgroundRemovalSectionProps {
  clipId: string;
  onSettingsChange?: (settings: BackgroundRemovalSettings) => void;
}

const BACKGROUND_MODES: {
  value: BackgroundMode;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "blur", label: "Blur", icon: Droplets },
  { value: "color", label: "Color", icon: Palette },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "transparent", label: "Transparent", icon: User },
];

const PRESET_COLORS = [
  "#00ff00",
  "#0000ff",
  "#ffffff",
  "#000000",
  "#ff0000",
  "#ffff00",
  "#00ffff",
  "#ff00ff",
];

export const BackgroundRemovalSection: React.FC<
  BackgroundRemovalSectionProps
> = ({ clipId, onSettingsChange }) => {
  const [settings, setSettings] = useState<BackgroundRemovalSettings>(
    DEFAULT_BACKGROUND_SETTINGS,
  );
  const [isInitializing, setIsInitializing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { addTask, updateTaskProgress, completeTask, failTask } =
    useProcessingStore();

  useEffect(() => {
    const engine = getBackgroundRemovalEngine();
    if (engine) {
      setSettings(engine.getSettings(clipId));
      setIsInitialized(engine.isInitialized());
    }
  }, [clipId]);

  const handleInitialize = useCallback(async () => {
    setIsInitializing(true);
    try {
      const engine = initializeBackgroundRemovalEngine();
      await engine.initialize();
      setIsInitialized(true);
    } catch (error) {
      console.error("Failed to initialize background removal:", error);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<BackgroundRemovalSettings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);

      const engine = getBackgroundRemovalEngine();
      if (engine) {
        engine.setSettings(clipId, newSettings);
      }

      onSettingsChange?.(newSettings);
      window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
    },
    [settings, clipId, onSettingsChange],
  );

  const processBackgroundRemoval = useCallback(async () => {
    const taskId = addTask(clipId, "background-removal");
    setIsProcessing(true);

    try {
      updateTaskProgress(taskId, 10, "Initializing AI model...");

      if (!isInitialized) {
        await handleInitialize();
      }

      updateTaskProgress(taskId, 30, "Preparing background detection...");
      await new Promise((resolve) => setTimeout(resolve, 500));

      updateTaskProgress(taskId, 60, "Configuring effect pipeline...");
      await new Promise((resolve) => setTimeout(resolve, 400));

      updateTaskProgress(taskId, 90, "Finalizing setup...");
      await new Promise((resolve) => setTimeout(resolve, 300));

      updateSettings({ enabled: true });
      completeTask(taskId);
      toast.success(
        "Background Removal Ready",
        "Effect will be applied during playback",
      );
    } catch (error) {
      failTask(
        taskId,
        error instanceof Error ? error.message : "Unknown error",
      );
      toast.error("Processing Failed", "Could not enable background removal");
    } finally {
      setIsProcessing(false);
    }
  }, [
    clipId,
    isInitialized,
    handleInitialize,
    updateSettings,
    addTask,
    updateTaskProgress,
    completeTask,
    failTask,
  ]);

  const handleToggleEnabled = useCallback(() => {
    if (settings.enabled) {
      updateSettings({ enabled: false });
      toast.info("Background Removal Disabled");
    } else {
      processBackgroundRemoval();
    }
  }, [settings.enabled, updateSettings, processBackgroundRemoval]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={handleToggleEnabled} type="button" aria-label={(settings.enabled ? "On" : "Off").trim() || undefined} disabled={(isInitializing || isProcessing)} className={cn("inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 px-2.5 text-[12px]", (settings.enabled ? "bg-accent text-accent-fg hover:bg-accent/90" : "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"))}>
          {(isInitializing || isProcessing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : undefined) ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{isInitializing || isProcessing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : undefined}</span> : null}
          <span className="truncate">{settings.enabled ? "On" : "Off"}</span>
        </Button>
      </div>

      {settings.enabled && (
        <Card className="min-w-0 rounded-[7px] border shadow-none border-transparent bg-bg-2 text-fg p-3 space-y-3">
          <div>
            <span className="text-fg-2 font-normal mb-2 block text-[10px]">
              Background Mode
            </span>
            <div className="grid grid-cols-4 gap-1">
              {BACKGROUND_MODES.map((mode) => {
                const ModeIcon = mode.icon;
                return (
                  <Button variant="ghost" key={mode.value} onClick={() => updateSettings({ mode: mode.value })} type="button" aria-label={`${mode.label} background mode`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `flex flex-col items-center gap-1 rounded p-2 transition-colors ${
                      settings.mode === mode.value
                        ? "bg-primary/20 border border-primary"
                        : "bg-bg-1 hover:bg-background-primary border border-transparent"
                    }`)}>
                    <ModeIcon size={14} />
                    <span className="text-fg font-normal text-[9px]">
                      {mode.label}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>

          {settings.mode === "blur" && (
            <PropertySlider
              label="Blur Amount"
              min={0}
              max={50}
              step={1}
              value={settings.blurAmount}
              onChange={(value: number) => updateSettings({ blurAmount: value })}
              formatValue={(value) => `${Math.round(value)}px`}
            />
          )}

          {settings.mode === "color" && (
            <div>
              <span className="text-fg-2 font-normal mb-2 block text-[10px]">
                Background Color
              </span>
              <div className="grid grid-cols-8 gap-1 mb-2">
                {PRESET_COLORS.map((color) => (
                  <Button variant="ghost" key={color} onClick={() => updateSettings({ backgroundColor: color })} style={{ backgroundColor: color }} type="button" aria-label={`Use ${color} background color`} className={cn("group/card block h-auto min-w-0 whitespace-normal rounded-[7px] border text-left transition-[background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", "border-border bg-bg-1 hover:bg-bg-2", "p-3", `w-6 h-6 rounded border-2 transition-all ${
                      settings.backgroundColor === color
                        ? "border-primary scale-110"
                        : "border-transparent hover:scale-105"
                    }`)} />
                ))}
              </div>
              <ColorSelector
                value={settings.backgroundColor}
                onChange={(value) => updateSettings({ backgroundColor: value })}
                label="Select replacement background color"
              />
            </div>
          )}

          {settings.mode === "image" && (
            <div>
              <span className="text-fg-2 font-normal mb-2 block text-[10px]">
                Background Image
              </span>
              <Button onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      const url = URL.createObjectURL(file);
                      updateSettings({ backgroundImageUrl: url });
                      const engine = getBackgroundRemovalEngine();
                      if (engine) {
                        await engine.setBackgroundImage(url);
                      }
                    }
                  };
                  input.click();
                }} type="button" aria-label="Choose Image" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ImageIcon size={14} />}</span>
                <span className="truncate">{"Choose Image"}</span>
              </Button>
              {settings.backgroundImageUrl && (
                <span className="text-fg-2 font-normal mt-2 truncate text-[9px]">
                  Image loaded
                </span>
              )}
            </div>
          )}

          <PropertySlider
            label="Edge Smoothing"
            min={0}
            max={10}
            step={1}
            value={settings.edgeBlur}
            onChange={(value: number) => updateSettings({ edgeBlur: value })}
            formatValue={(value) => `${Math.round(value)}`}
          />

          <PropertySlider
            label="Detection Threshold"
            min={0}
            max={100}
            step={1}
            value={settings.threshold * 100}
            onChange={(value: number) => updateSettings({ threshold: value / 100 })}
            formatValue={(value) => `${Math.round(value)}%`}
          />

          <div className="flex items-start gap-2 p-2 bg-primary/10 rounded border border-primary/20">
            <Info size={14} className="text-primary flex-shrink-0 mt-0.5" />
            <span className="text-fg-2 font-normal text-[9px]">
              Background removal is processed in real-time. For best results,
              export your video after previewing.
            </span>
          </div>
        </Card>
      )}
    </div>
  );
};

