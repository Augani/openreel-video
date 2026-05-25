import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  User,
  ImageIcon,
  Palette,
  Droplets,
  Loader2,
  Info,
} from "lucide-react";
import { Slider } from "@openreel/ui";
import {
  getBackgroundRemovalEngine,
  initializeBackgroundRemovalEngine,
  type BackgroundRemovalSettings,
  type BackgroundMode,
  DEFAULT_BACKGROUND_SETTINGS,
} from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { useProcessingStore } from "../../../services/processing-manager";

interface BackgroundRemovalSectionProps {
  clipId: string;
  onSettingsChange?: (settings: BackgroundRemovalSettings) => void;
}

const BACKGROUND_MODES: {
  value: BackgroundMode;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "blur", label: "Blur", icon: <Droplets size={14} /> },
  { value: "color", label: "Color", icon: <Palette size={14} /> },
  { value: "image", label: "Image", icon: <ImageIcon size={14} /> },
  { value: "transparent", label: "Transparent", icon: <User size={14} /> },
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
  const { t } = useTranslation();
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
      updateTaskProgress(taskId, 10, t("inspector.initializingModel"));

      if (!isInitialized) {
        await handleInitialize();
      }

      updateTaskProgress(taskId, 30, t("inspector.preparingDetection"));
      await new Promise((resolve) => setTimeout(resolve, 500));

      updateTaskProgress(taskId, 60, t("inspector.configuringPipeline"));
      await new Promise((resolve) => setTimeout(resolve, 400));

      updateTaskProgress(taskId, 90, t("inspector.finalizingSetup"));
      await new Promise((resolve) => setTimeout(resolve, 300));

      updateSettings({ enabled: true });
      completeTask(taskId);
      toast.success(
        t("inspector.bgRemovalReady"),
        t("inspector.bgRemovalPlayback"),
      );
    } catch (error) {
      failTask(
        taskId,
        error instanceof Error ? error.message : "Unknown error",
      );
      toast.error(t("inspector.bgRemovalFailed"), t("inspector.bgRemovalCouldNotEnable"));
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
      toast.info(t("inspector.bgRemovalDisabled"));
    } else {
      processBackgroundRemoval();
    }
  }, [settings.enabled, updateSettings, processBackgroundRemoval]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleToggleEnabled}
          disabled={isInitializing || isProcessing}
          className={`px-3 py-1 text-[10px] font-medium rounded transition-colors ${
            settings.enabled
              ? "bg-primary text-white"
              : "bg-background-tertiary text-text-secondary hover:bg-background-secondary"
          }`}
        >
          {isInitializing || isProcessing ? (
            <Loader2 size={12} className="animate-spin" />
            ) : settings.enabled ? (
            t("inspector.enableEffect")
          ) : (
            t("inspector.disableEffect")
          )}
        </button>
      </div>

      {settings.enabled && (
        <div className="space-y-3 p-3 bg-background-tertiary rounded-lg">
          <div>
            <label className="text-[10px] text-text-secondary block mb-2">
              {t("inspector.backgroundMode")}
            </label>
            <div className="grid grid-cols-4 gap-1">
              {BACKGROUND_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => updateSettings({ mode: mode.value })}
                  className={`flex flex-col items-center gap-1 p-2 rounded transition-colors ${
                    settings.mode === mode.value
                      ? "bg-primary/20 border border-primary"
                      : "bg-background-secondary hover:bg-background-primary border border-transparent"
                  }`}
                >
                  {mode.icon}
                  <span className="text-[9px] text-text-primary">
                    {t(`inspector.bg${mode.label}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {settings.mode === "blur" && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] text-text-secondary">
                  {t("inspector.blurAmount")}
                </label>
                <span className="text-[10px] text-text-muted font-mono">
                  {settings.blurAmount}px
                </span>
              </div>
              <Slider
                min={0}
                max={50}
                step={1}
                value={[settings.blurAmount]}
                onValueChange={(value) =>
                  updateSettings({ blurAmount: value[0] })
                }
              />
            </div>
          )}

          {settings.mode === "color" && (
            <div>
              <label className="text-[10px] text-text-secondary block mb-2">
                {t("inspector.backgroundColor")}
              </label>
              <div className="grid grid-cols-8 gap-1 mb-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
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
              <input
                type="color"
                value={settings.backgroundColor}
                onChange={(e) =>
                  updateSettings({ backgroundColor: e.target.value })
                }
                className="w-full h-8 rounded cursor-pointer"
              />
            </div>
          )}

          {settings.mode === "image" && (
            <div>
              <label className="text-[10px] text-text-secondary block mb-2">
                {t("inspector.backgroundImage")}
              </label>
              <button
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
                className="w-full py-2 bg-background-secondary hover:bg-background-primary text-text-primary rounded text-[10px] transition-colors flex items-center justify-center gap-2"
              >
                <ImageIcon size={14} />
                {t("inspector.chooseImage")}
              </button>
              {settings.backgroundImageUrl && (
                <div className="mt-2 text-[9px] text-text-muted truncate">
                  {t("inspector.imageLoaded")}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-text-secondary">
                  {t("inspector.edgeSmoothing")}
              </label>
              <span className="text-[10px] text-text-muted font-mono">
                {settings.edgeBlur}
              </span>
            </div>
            <Slider
              min={0}
              max={10}
              step={1}
              value={[settings.edgeBlur]}
              onValueChange={(value) =>
                updateSettings({ edgeBlur: value[0] })
              }
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-text-secondary">
                  {t("inspector.detectionThreshold")}
              </label>
              <span className="text-[10px] text-text-muted font-mono">
                {Math.round(settings.threshold * 100)}%
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[settings.threshold * 100]}
              onValueChange={(value) =>
                updateSettings({ threshold: value[0] / 100 })
              }
            />
          </div>

          <div className="flex items-start gap-2 p-2 bg-primary/10 rounded border border-primary/20">
            <Info size={14} className="text-primary flex-shrink-0 mt-0.5" />
            <p className="text-[9px] text-text-muted">
              {t("inspector.bgRemovalInfo")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackgroundRemovalSection;
