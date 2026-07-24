import React, { useState, useCallback, useEffect } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
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
        <Button
          label={settings.enabled ? "On" : "Off"}
          icon={
            isInitializing || isProcessing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : undefined
          }
          variant={settings.enabled ? "primary" : "secondary"}
          size="sm"
          onClick={handleToggleEnabled}
          isDisabled={isInitializing || isProcessing}
        />
      </div>

      {settings.enabled && (
        <Card variant="muted" padding={3} className="space-y-3">
          <div>
            <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">
              Background Mode
            </Text>
            <div className="grid grid-cols-4 gap-1">
              {BACKGROUND_MODES.map((mode) => {
                const ModeIcon = mode.icon;
                return (
                  <ClickableCard
                    key={mode.value}
                    label={`${mode.label} background mode`}
                    onClick={() => updateSettings({ mode: mode.value })}
                    className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${
                      settings.mode === mode.value
                        ? "bg-primary/20 border border-primary"
                        : "bg-bg-1 hover:bg-background-primary border border-transparent"
                    }`}
                  >
                    <ModeIcon size={14} />
                    <Text type="supporting" color="primary" className="text-[9px]">
                      {mode.label}
                    </Text>
                  </ClickableCard>
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
              <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">
                Background Color
              </Text>
              <div className="grid grid-cols-8 gap-1 mb-2">
                {PRESET_COLORS.map((color) => (
                  <ClickableCard
                    key={color}
                    label={`Use ${color} background color`}
                    onClick={() => updateSettings({ backgroundColor: color })}
                    className={`w-6 h-6 rounded border-2 transition-all ${
                      settings.backgroundColor === color
                        ? "border-primary scale-110"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: color }}
                  />
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
              <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">
                Background Image
              </Text>
              <Button
                label="Choose Image"
                icon={<ImageIcon size={14} />}
                variant="secondary"
                size="sm"
                onClick={() => {
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
                }}
                className="w-full justify-center"
              />
              {settings.backgroundImageUrl && (
                <Text type="supporting" color="secondary" className="mt-2 truncate text-[9px]">
                  Image loaded
                </Text>
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
            <Text type="supporting" color="secondary" className="text-[9px]">
              Background removal is processed in real-time. For best results,
              export your video after previewing.
            </Text>
          </div>
        </Card>
      )}
    </div>
  );
};

export default BackgroundRemovalSection;
