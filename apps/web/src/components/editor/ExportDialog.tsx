import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Download,
  Settings,
  Monitor,
  Archive,
  Globe,
  Music,
  Star,
  Play,
  Clock,
  HardDrive,
  Video,
  Share2,
  Cpu,
  Gauge,
  Zap,
  CheckCircle,
  Info,
  Minimize2,
  AlertTriangle,
} from "@/icons/lucide-compat";
import {
  ToolcraftSegmentedControl,
  ToolcraftSwitchControl,
} from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import {
  ToolcraftDialog as Dialog,
  ToolcraftDialogHeader as DialogHeader,
} from "@openreel/ui";
import {
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
  ToolcraftLayoutFooter as LayoutFooter,
} from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  exportPresetsManager,
  type PlatformExportPreset,
} from "../../services/export-presets";
import type {
  VideoExportSettings,
  UpscaleQuality,
  CompressionQuality,
  CompressionSource,
  CompressionTarget,
  CompressionPlan,
} from "@openreel/core";
import type { SourceExportMatch } from "../../services/export-source-match";
import {
  getDeviceProfile,
  estimateExportTime,
  runBenchmark,
  getCodecRecommendations,
  formatDeviceSummary,
  shouldRecommendBenchmark,
  computeCompressionPlan,
  estimateCompressedBytes,
  compressionPlanToExportSettings,
  COMPRESSION_SIZE_PRESETS,
  exportSettingsRequireNativeEncoder,
  resolveWebCodecsExportLimits,
  checkBrowserExportCapability,
  getVideoExportValidationError,
  type DeviceProfile,
  type BenchmarkProgress,
  type TimeEstimate,
  type CodecRecommendation,
} from "@openreel/core";
import { EDITING_FRAME_RATE_OPTIONS } from "./editing-frame-rate";
import type { ExportDeliveryMode } from "../../services/export-runner";

const WEB_EXPORT_GUARDRAIL_MESSAGE =
  "ProRes, transparency, and high bit depth require the desktop encoder. You can export an H.264 MP4 without transparency in this browser.";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (settings: VideoExportSettings, delivery?: ExportDeliveryMode) => void;
  duration?: number;
  projectWidth?: number;
  projectHeight?: number;
  frameRate?: number;
  sourceMatch?: SourceExportMatch | null;
  hasAudio?: boolean;
}

type AspectRatioType = "vertical" | "square" | "horizontal";

function getAspectRatioType(width: number, height: number): AspectRatioType {
  const ratio = width / height;
  if (ratio < 0.9) return "vertical";
  if (ratio > 1.1) return "horizontal";
  return "square";
}

function getRecommendedPresetsForAspectRatio(
  presets: PlatformExportPreset[],
  aspectType: AspectRatioType,
): PlatformExportPreset[] {
  const aspectRatioMap: Record<string, AspectRatioType> = {
    "9:16": "vertical",
    "1:1": "square",
    "16:9": "horizontal",
    "4:5": "vertical",
  };

  return presets.filter((preset) => {
    if (!preset.aspectRatio) return false;
    const presetAspectType = aspectRatioMap[preset.aspectRatio];
    return presetAspectType === aspectType;
  });
}

function getAspectRatioLabel(aspectType: AspectRatioType): string {
  switch (aspectType) {
    case "vertical":
      return "Vertical (TikTok, Reels, Shorts)";
    case "square":
      return "Square (Instagram Feed)";
    case "horizontal":
      return "Horizontal (YouTube, Twitter)";
  }
}

const getExportValidationError = getVideoExportValidationError;

type PlatformIcon = typeof Video;

const PLATFORM_ICONS: Record<string, PlatformIcon> = {
  YouTube: Video,
  Instagram: Share2,
  Twitter: Share2,
  TikTok: Music,
  Facebook: Share2,
  LinkedIn: Share2,
  Broadcast: Monitor,
  Web: Globe,
  Archive: Archive,
  Audio: Music,
  Custom: Settings,
};

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  duration = 0,
  projectWidth = 1920,
  projectHeight = 1080,
  frameRate = 30,
  sourceMatch = null,
  hasAudio = true,
}) => {
  const isDesktop =
    typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const [delivery, setDelivery] = useState<ExportDeliveryMode>(isDesktop ? "file" : "download");
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(false);
  const [browserAudioCodec, setBrowserAudioCodec] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"presets" | "custom" | "reduce">(
    "presets",
  );
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(
    "recommended",
  );
  const [selectedPreset, setSelectedPreset] =
    useState<PlatformExportPreset | null>(null);
  const [presets, setPresets] = useState<PlatformExportPreset[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);

  const aspectType = getAspectRatioType(projectWidth, projectHeight);

  const [customSettings, setCustomSettings] = useState<VideoExportSettings>({
    format: "mp4",
    codec: "h264",
    encodeMode: "balanced",
    width: projectWidth,
    height: projectHeight,
    frameRate,
    bitrate: 15000,
    bitrateMode: "vbr",
    quality: 90,
    keyframeInterval: 60,
    audioSettings: {
      format: "aac",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 256,
      channels: 2,
    },
    upscaling: {
      enabled: false,
      quality: "balanced",
      sharpening: 0.3,
    },
  });

  useEffect(() => {
    setCustomSettings((current) => ({
      ...current,
      width: projectWidth,
      height: projectHeight,
      frameRate,
    }));
  }, [projectWidth, projectHeight, frameRate]);

  const projectPreset = useMemo<PlatformExportPreset>(() => ({
    id: "project-settings",
    name: "Project settings",
    description: "Keep your canvas size and frame rate",
    platform: "Custom",
    category: "custom",
    settings: {
      format: "mp4",
      codec: "h264",
      width: projectWidth,
      height: projectHeight,
      frameRate,
      bitrate: 12000,
      bitrateMode: "vbr",
      quality: 85,
      keyframeInterval: Math.max(1, Math.round(frameRate * 2)),
      audioSettings: {
        format: "aac", sampleRate: 48000, bitDepth: 16, bitrate: 256, channels: 2,
      },
    },
  }), [projectWidth, projectHeight, frameRate]);

  const [reduceMode, setReduceMode] = useState<"quality" | "size">("quality");
  const [reduceQuality, setReduceQuality] =
    useState<CompressionQuality>("balanced");
  const [reduceSizePresetId, setReduceSizePresetId] =
    useState<string>("whatsapp");

  const reducePlan = useMemo<CompressionPlan | null>(() => {
    if (duration <= 0 || projectWidth <= 0 || projectHeight <= 0) return null;
    const source: CompressionSource = {
      durationSec: duration,
      width: projectWidth,
      height: projectHeight,
      frameRate,
      hasAudio: true,
    };
    const target: CompressionTarget =
      reduceMode === "size"
        ? {
            mode: "size",
            targetBytes:
              COMPRESSION_SIZE_PRESETS.find((p) => p.id === reduceSizePresetId)
                ?.bytes ?? COMPRESSION_SIZE_PRESETS[0].bytes,
          }
        : { mode: "quality", quality: reduceQuality };
    return computeCompressionPlan(source, target);
  }, [
    duration,
    projectWidth,
    projectHeight,
    frameRate,
    reduceMode,
    reduceQuality,
    reduceSizePresetId,
  ]);

  const reduceEstimatedBytes = useMemo(
    () => (reducePlan ? estimateCompressedBytes(reducePlan, duration) : 0),
    [reducePlan, duration],
  );

  const reduceSourceBytes = useMemo(() => {
    if (!sourceMatch || sourceMatch.bitrate <= 0 || duration <= 0) return 0;
    return (sourceMatch.bitrate * 1000 * duration) / 8;
  }, [sourceMatch, duration]);

  const reduceSavingsPercent = useMemo(() => {
    if (reduceSourceBytes <= 0 || reduceEstimatedBytes <= 0) return 0;
    return Math.max(
      0,
      Math.round((1 - reduceEstimatedBytes / reduceSourceBytes) * 100),
    );
  }, [reduceSourceBytes, reduceEstimatedBytes]);

  const effectiveSettings = useMemo<VideoExportSettings>(() => {
    if (activeTab === "presets" && selectedPreset) {
      return selectedPreset.settings as VideoExportSettings;
    }
    if (activeTab === "reduce" && reducePlan) {
      return compressionPlanToExportSettings(reducePlan);
    }
    return customSettings;
  }, [activeTab, selectedPreset, reducePlan, customSettings]);

  const validationError = getExportValidationError(effectiveSettings, duration);

  const webExportAdjustment = useMemo(
    () =>
      isDesktop
        ? null
        : resolveWebCodecsExportLimits(effectiveSettings, duration),
    [duration, effectiveSettings, isDesktop],
  );

  const matchSourceWebAdjustment = useMemo(() => {
    if (isDesktop || !sourceMatch) return null;
    return resolveWebCodecsExportLimits(
      {
        ...customSettings,
        format: "mp4",
        codec: "h264",
        width: sourceMatch.width,
        height: sourceMatch.height,
        frameRate: sourceMatch.frameRate,
        bitrate: sourceMatch.bitrate,
      },
      duration,
    );
  }, [customSettings, duration, isDesktop, sourceMatch]);

  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(
    null,
  );
  const [timeEstimate, setTimeEstimate] = useState<TimeEstimate | null>(null);
  const [codecRecommendations, setCodecRecommendations] = useState<
    CodecRecommendation[]
  >([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] =
    useState<BenchmarkProgress | null>(null);
  const [showDeviceInfo, setShowDeviceInfo] = useState(false);
  const [h264FallbackAcknowledged, setH264FallbackAcknowledged] =
    useState(false);

  const resolveBrowserSettings = useCallback((chosen: VideoExportSettings): VideoExportSettings => {
    if (isDesktop || !exportSettingsRequireNativeEncoder(chosen)) return chosen;
    return { ...chosen, format: "mp4", codec: "h264", colorDepth: 8, pixelFormat: "yuv420", proresProfile: undefined };
  }, [isDesktop]);

  useEffect(() => {
    if (!isOpen || isDesktop || validationError) return;
    let active = true;
    setCapabilityError(null);
    setCheckingCapability(true);
    const settings = resolveWebCodecsExportLimits(resolveBrowserSettings(effectiveSettings), duration).settings;
    checkBrowserExportCapability(settings, undefined, hasAudio).then((capability) => {
      if (!active) return;
      setCapabilityError(capability.reason);
      setBrowserAudioCodec(capability.audioCodec ?? null);
      setCheckingCapability(false);
    });
    return () => { active = false; };
  }, [isOpen, isDesktop, validationError, effectiveSettings, duration, resolveBrowserSettings, hasAudio]);

  useEffect(() => {
    if (isOpen) {
      const videoPresets = exportPresetsManager.getAllPresets().filter((preset) => "width" in preset.settings);
      setPresets(videoPresets);
      setPlatforms(Array.from(new Set(videoPresets.map((preset) => preset.platform))));
      setSelectedPlatform("recommended");
      setSelectedPreset(projectPreset);

      getDeviceProfile().then((profile) => {
        setDeviceProfile(profile);
        setCodecRecommendations(
          getCodecRecommendations(profile, {
            width: projectWidth,
            height: projectHeight,
          }),
        );
      });
    }
  }, [isOpen, projectWidth, projectHeight, projectPreset]);

  useEffect(() => {
    if (!deviceProfile || duration <= 0) {
      setTimeEstimate(null);
      return;
    }

    const settings = effectiveSettings;

    const estimate = estimateExportTime(deviceProfile, {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      duration,
      codec: settings.codec as "h264" | "h265" | "vp9" | "av1",
    });

    setTimeEstimate(estimate);
  }, [deviceProfile, duration, effectiveSettings]);

  const handleRunBenchmark = useCallback(async () => {
    if (isBenchmarking) return;

    setIsBenchmarking(true);
    setBenchmarkProgress(null);

    try {
      await runBenchmark((progress) => {
        setBenchmarkProgress(progress);
      });

      const updatedProfile = await getDeviceProfile(true);
      setDeviceProfile(updatedProfile);
      setCodecRecommendations(
        getCodecRecommendations(updatedProfile, {
          width: projectWidth,
          height: projectHeight,
        }),
      );
    } catch (error) {
      console.error("Benchmark failed:", error);
    } finally {
      setIsBenchmarking(false);
      setBenchmarkProgress(null);
    }
  }, [isBenchmarking, projectWidth, projectHeight]);

  const recommendedForVideo = getRecommendedPresetsForAspectRatio(
    presets,
    aspectType,
  ).filter((preset) => {
    const settings = preset.settings as VideoExportSettings;
    return settings.width <= projectWidth && settings.height <= projectHeight &&
      (isDesktop || !exportSettingsRequireNativeEncoder(settings));
  }).slice(0, 5);

  const filteredPresets =
    selectedPlatform === "recommended"
      ? [projectPreset, ...recommendedForVideo]
      : selectedPlatform
        ? presets.filter((p) => p.platform === selectedPlatform)
        : exportPresetsManager.getRecommendedPresets();

  const isNativeExportAvailable = isDesktop;

  const guardrailActive =
    activeTab !== "reduce" &&
    !isNativeExportAvailable &&
    exportSettingsRequireNativeEncoder(effectiveSettings);
  const guardrailBlocking = guardrailActive && !h264FallbackAcknowledged;

  useEffect(() => {
    if (!guardrailActive) {
      setH264FallbackAcknowledged(false);
    }
  }, [guardrailActive]);

  const handleExport = useCallback(() => {
    if (guardrailBlocking || validationError || capabilityError) return;
    if (activeTab === "reduce") {
      if (!reducePlan) return;
      onExport(resolveBrowserSettings(compressionPlanToExportSettings(reducePlan)), delivery);
      onClose();
      return;
    }
    const chosen =
      activeTab === "presets" && selectedPreset
        ? (selectedPreset.settings as VideoExportSettings)
        : customSettings;
    const settings: VideoExportSettings = {
      ...chosen,
      encodeMode: customSettings.encodeMode ?? "balanced",
    };
    onExport(resolveBrowserSettings(settings), delivery);
    onClose();
  }, [
    activeTab,
    selectedPreset,
    reducePlan,
    customSettings,
    onExport,
    onClose,
    guardrailBlocking,
    validationError,
    capabilityError,
    resolveBrowserSettings,
    delivery,
  ]);

  const handleMatchSourceExport = useCallback(() => {
    if (!sourceMatch) return;
    const settings: VideoExportSettings = {
      ...customSettings,
      format: "mp4",
      codec: "h264",
      width: sourceMatch.width,
      height: sourceMatch.height,
      frameRate: sourceMatch.frameRate,
      bitrate: sourceMatch.bitrate,
      encodeMode: customSettings.encodeMode ?? "balanced",
    };
    if (getExportValidationError(settings, duration)) return;
    onExport(settings, delivery);
    onClose();
  }, [sourceMatch, customSettings, duration, onExport, onClose, delivery]);

  const formatFileSize = (bitrate: number, durationSec: number): string => {
    const bytes = (bitrate * 1000 * durationSec) / 8;
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return "0 MB";
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={1000}
      purpose="form"
      className="rounded-xl"
    >
      <Layout
        className="h-[min(820px,calc(100vh-40px))]"
        header={
          <DialogHeader
            title="Export Video"
            subtitle="Choose a ready-made preset or fine-tune every setting."
            onOpenChange={(open) => !open && onClose()}
            startContent={
              <Download size={20} className="text-primary" aria-hidden />
            }
          />
        }
        content={
          <LayoutContent className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg p-0">
            <div className="shrink-0 space-y-3 border-b border-border bg-bg-1 px-5 py-4">
              <ToolcraftSegmentedControl<"presets" | "custom" | "reduce">
                ariaLabel="Export mode"
                value={activeTab}
                onChange={setActiveTab}
                className="max-w-[440px] bg-bg-2"
                options={[
                  { value: "presets", label: "Presets" },
                  { value: "reduce", label: "Smaller File" },
                  { value: "custom", label: "Custom Settings" },
                ]}
              />

              {sourceMatch && activeTab === "presets" && (
                <div
                  data-testid="quick-export-card"
                  className="flex min-h-[72px] items-center justify-between gap-4 rounded-[10px] border border-accent/30 bg-accent/5 px-4 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                      <Zap size={16} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-fg">
                        Match source
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-fg-muted">
                        {sourceMatch.width}×{sourceMatch.height}
                        {sourceMatch.frameRate
                          ? ` · ${sourceMatch.frameRate} fps`
                          : ""}
                        {" · MP4 · "}
                        {sourceMatch.sourceName}
                      </div>
                      {matchSourceWebAdjustment?.wasAdjusted && (
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-status-warning">
                          <AlertTriangle
                            size={11}
                            className="shrink-0"
                            aria-hidden
                          />
                          Browser limit: exports at{" "}
                          {matchSourceWebAdjustment.settings.width}×
                          {matchSourceWebAdjustment.settings.height} ·{" "}
                          {matchSourceWebAdjustment.settings.frameRate} fps
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    label="Quick Export"
                    icon={<Download size={14} aria-hidden />}
                    variant="primary"
                    size="sm"
                    onClick={handleMatchSourceExport}
                    isDisabled={duration <= 0}
                    className="shrink-0"
                  />
                </div>
              )}
            </div>

            {activeTab === "presets" && (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <aside className="w-52 shrink-0 overflow-y-auto border-r border-border bg-bg-1 p-3">
                  <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                    Browse presets
                  </div>
                  <SelectableCard
                    label="For Your Video"
                    isSelected={selectedPlatform === "recommended"}
                    onClick={() => setSelectedPlatform("recommended")}
                    onChange={() => setSelectedPlatform("recommended")}
                    padding={0}
                    variant="transparent"
                    className={`mb-2 flex w-full flex-col items-start px-3 py-2.5 text-[12px] transition-colors ${
                      selectedPlatform === "recommended"
                        ? "border-accent/30 bg-selected text-fg shadow-none"
                        : "text-fg-2"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-accent" />
                      <span className="font-semibold">Recommended</span>
                    </div>
                    <span className="ml-5 mt-1 text-[10px] leading-4 text-fg-muted">
                      {getAspectRatioLabel(aspectType)}
                    </span>
                  </SelectableCard>
                  <div className="mb-2 h-px bg-border" />
                  {platforms.map((platform) => {
                    const PlatformIcon = PLATFORM_ICONS[platform] ?? Globe;
                    return (
                      <SelectableCard
                        key={platform}
                        label={platform}
                        isSelected={selectedPlatform === platform}
                        onClick={() => setSelectedPlatform(platform)}
                        onChange={() => setSelectedPlatform(platform)}
                        padding={0}
                        variant="transparent"
                        className={`mb-1 flex w-full items-center gap-2.5 px-3 py-2 text-[12px] transition-colors ${
                          selectedPlatform === platform
                            ? "border-accent/30 bg-selected text-fg shadow-none"
                            : "text-fg-2"
                        }`}
                      >
                        <PlatformIcon
                          size={14}
                          className={
                            selectedPlatform === platform
                              ? "text-accent"
                              : "text-fg-muted"
                          }
                        />
                        {platform}
                      </SelectableCard>
                    );
                  })}
                </aside>

                <main className="min-w-0 flex-1 overflow-y-auto p-5">
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                      <h3 className="text-[14px] font-semibold text-fg">
                        {selectedPlatform === "recommended"
                          ? "Recommended for this video"
                          : selectedPlatform}
                      </h3>
                      <p className="mt-1 text-[11px] text-fg-muted">
                        Select a preset to see its estimated size and export
                        time.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-bg-2 px-2.5 py-1 text-[10px] font-medium text-fg-muted">
                      {filteredPresets.length} options
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {filteredPresets.map((preset) => {
                      const PlatformIcon =
                        PLATFORM_ICONS[preset.platform] ?? Globe;
                      const isSelected = selectedPreset?.id === preset.id;
                      return (
                        <SelectableCard
                          key={preset.id}
                          label={preset.name}
                          isSelected={selectedPreset?.id === preset.id}
                          onClick={() => setSelectedPreset(preset)}
                          onChange={() => setSelectedPreset(preset)}
                          padding={0}
                          variant="default"
                          className={`min-h-[118px] rounded-[10px] p-4 text-left ${
                            isSelected
                              ? "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]"
                              : "border-border bg-bg-1 hover:border-accent/40 hover:bg-bg-2"
                          }`}
                        >
                          <div className="mb-2.5 flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-2 text-fg-2">
                                <PlatformIcon size={14} />
                              </span>
                              <span className="truncate text-[12px] font-semibold text-fg">
                                {preset.name}
                              </span>
                            </div>
                            {isSelected ? (
                              <CheckCircle
                                size={15}
                                className="shrink-0 text-accent"
                                aria-hidden
                              />
                            ) : preset.recommended ? (
                              <Star
                                size={13}
                                className="shrink-0 fill-status-warning text-status-warning"
                              />
                            ) : null}
                          </div>
                          <Text
                            type="supporting"
                            color="secondary"
                            display="block"
                            className="mb-3 line-clamp-2 min-h-8 text-[11px] leading-4"
                          >
                            {preset.description}
                          </Text>
                          {"width" in preset.settings && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-muted">
                              <span className="rounded bg-bg-2 px-1.5 py-0.5">
                                {(preset.settings as VideoExportSettings).width}
                                x
                                {
                                  (preset.settings as VideoExportSettings)
                                    .height
                                }
                              </span>
                              <span className="rounded bg-bg-2 px-1.5 py-0.5">
                                {
                                  (preset.settings as VideoExportSettings)
                                    .frameRate
                                }
                                {" fps"}
                              </span>
                              <span className="rounded bg-bg-2 px-1.5 py-0.5">
                                {preset.aspectRatio}
                              </span>
                            </div>
                          )}
                          {preset.maxDuration && (
                            <div className="mt-2 flex items-center gap-1 text-[10px] text-status-warning">
                              <Clock size={10} />
                              Max {preset.maxDuration}s
                            </div>
                          )}
                        </SelectableCard>
                      );
                    })}
                  </div>
                </main>
              </div>
            )}

            {activeTab === "reduce" && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-xl mx-auto space-y-5">
                  <div className="flex items-start gap-2.5 p-3 rounded-lg border border-border bg-background-tertiary/40">
                    <Minimize2
                      size={16}
                      className="text-primary shrink-0 mt-0.5"
                    />
                    <Text
                      type="supporting"
                      color="secondary"
                      display="block"
                      className="text-xs"
                    >
                      Re-encode your project to a smaller file. Pick a quality
                      tier, or a target size for sharing on email, WhatsApp, or
                      Discord.
                    </Text>
                  </div>

                  <div>
                    <Text
                      type="label"
                      color="secondary"
                      weight="bold"
                      display="block"
                      className="mb-2 text-xs"
                    >
                      Reduce by
                    </Text>
                    <div className="flex gap-2">
                      {(
                        [
                          ["quality", "Quality"],
                          ["size", "Target size"],
                        ] as const
                      ).map(([value, label]) => (
                        <SelectableCard
                          key={value}
                          label={label}
                          isSelected={reduceMode === value}
                          onClick={() => setReduceMode(value)}
                          onChange={() => setReduceMode(value)}
                          padding={2}
                          variant={reduceMode === value ? "green" : "muted"}
                          className={`flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                            reduceMode === value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-text-secondary hover:border-primary/50"
                          }`}
                        >
                          {label}
                        </SelectableCard>
                      ))}
                    </div>
                  </div>

                  {reduceMode === "quality" ? (
                    <div>
                      <Text
                        type="label"
                        color="secondary"
                        weight="bold"
                        display="block"
                        className="mb-2 text-xs"
                      >
                        Quality
                      </Text>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            ["light", "Light", "Trim a little"],
                            ["balanced", "Balanced", "Best of both"],
                            ["strong", "Strong", "Smallest file"],
                          ] as const
                        ).map(([value, label, hint]) => (
                          <SelectableCard
                            key={value}
                            label={label}
                            isSelected={reduceQuality === value}
                            onClick={() => setReduceQuality(value)}
                            onChange={() => setReduceQuality(value)}
                            padding={2}
                            variant={
                              reduceQuality === value ? "green" : "muted"
                            }
                            className={`px-3 py-2.5 text-left rounded-md border transition-colors ${
                              reduceQuality === value
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-primary/50"
                            }`}
                          >
                            <div
                              className={`text-xs font-semibold ${
                                reduceQuality === value
                                  ? "text-primary"
                                  : "text-text-primary"
                              }`}
                            >
                              {label}
                            </div>
                            <div className="text-[10px] text-text-muted mt-0.5">
                              {hint}
                            </div>
                          </SelectableCard>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Text
                        type="label"
                        color="secondary"
                        weight="bold"
                        display="block"
                        className="mb-2 text-xs"
                      >
                        Target size
                      </Text>
                      <div className="grid grid-cols-3 gap-2">
                        {COMPRESSION_SIZE_PRESETS.map((preset) => (
                          <SelectableCard
                            key={preset.id}
                            label={preset.label}
                            isSelected={reduceSizePresetId === preset.id}
                            onClick={() => setReduceSizePresetId(preset.id)}
                            onChange={() => setReduceSizePresetId(preset.id)}
                            padding={2}
                            variant={
                              reduceSizePresetId === preset.id
                                ? "green"
                                : "muted"
                            }
                            className={`px-3 py-2.5 rounded-md border text-xs font-medium capitalize transition-colors ${
                              reduceSizePresetId === preset.id
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-text-secondary hover:border-primary/50"
                            }`}
                          >
                            {preset.label}
                          </SelectableCard>
                        ))}
                      </div>
                    </div>
                  )}

                  {reducePlan ? (
                    <div className="rounded-lg border border-border bg-background-tertiary/40 p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-secondary">
                          Estimated output
                        </span>
                        <span className="text-sm font-semibold text-text-primary">
                          {reducePlan.width}×{reducePlan.height} · ~
                          {formatBytes(reduceEstimatedBytes)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">
                          {reducePlan.videoBitrateKbps.toLocaleString()} kbps
                          video
                          {reducePlan.audioBitrateKbps > 0
                            ? ` · ${reducePlan.audioBitrateKbps} kbps audio`
                            : ""}{" "}
                          · {reducePlan.frameRate}fps
                        </span>
                        {reduceSavingsPercent > 0 && (
                          <span className="font-bold text-primary">
                            −{reduceSavingsPercent}% vs source
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-background-tertiary/40 p-4 text-xs text-text-muted">
                      Add clips to the timeline to estimate a compressed size.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "custom" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-[760px] space-y-4">
                  <div>
                    <h3 className="text-[14px] font-semibold text-fg">
                      Custom export
                    </h3>
                    <p className="mt-1 text-[11px] text-fg-muted">
                      Control the video, encoding, and audio settings for this
                      file.
                    </p>
                  </div>

                  <section className="rounded-[10px] border border-border bg-bg-1 p-4">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-2 text-fg-2">
                        <Video size={14} aria-hidden />
                      </span>
                      <div>
                        <h4 className="text-[12px] font-semibold text-fg">
                          Video
                        </h4>
                        <p className="text-[10px] text-fg-muted">
                          Container, codec, resolution, and frame rate
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Selector
                        label="Format"
                        value={customSettings.format}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            format: value as "mp4" | "webm" | "mov",
                            codec: value === "webm" ? "vp9" : customSettings.codec === "vp9" || customSettings.codec === "vp8" ? "h264" : customSettings.codec,
                          })
                        }
                        options={[
                          { value: "mp4", label: "MP4" },
                          { value: "webm", label: "WebM" },
                          { value: "mov", label: "MOV" },
                        ]}
                        width="100%"
                      />

                      <Selector
                        label="Codec"
                        value={customSettings.codec}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            codec: value as VideoExportSettings["codec"],
                          })
                        }
                        options={[
                          { value: "h264", label: "H.264" },
                          { value: "h265", label: "H.265 (HEVC)" },
                          { value: "prores", label: "ProRes" },
                          { value: "vp9", label: "VP9" },
                          { value: "av1", label: "AV1" },
                        ].filter((option) => customSettings.format !== "webm" || ["vp9", "av1"].includes(option.value))}
                        width="100%"
                      />

                      <Selector
                        label="Resolution"
                        value={`${customSettings.width}x${customSettings.height}`}
                        onChange={(value) => {
                          const [w, h] = value.split("x").map(Number);
                          setCustomSettings({
                            ...customSettings,
                            width: w,
                            height: h,
                          });
                        }}
                        options={[
                          ...(sourceMatch &&
                          ![
                            "3840x2160",
                            "2560x1440",
                            "1920x1080",
                            "1280x720",
                            "854x480",
                            "1080x1920",
                            "1080x1080",
                          ].includes(
                            `${sourceMatch.width}x${sourceMatch.height}`,
                          )
                            ? [
                                {
                                  value: `${sourceMatch.width}x${sourceMatch.height}`,
                                  label: `Original (${sourceMatch.width}x${sourceMatch.height})`,
                                },
                              ]
                            : []),
                          { value: "3840x2160", label: "4K (3840x2160)" },
                          { value: "2560x1440", label: "2K (2560x1440)" },
                          { value: "1920x1080", label: "1080p (1920x1080)" },
                          { value: "1280x720", label: "720p (1280x720)" },
                          { value: "854x480", label: "480p (854x480)" },
                          { value: "1080x1920", label: "Vertical 1080p" },
                          { value: "1080x1080", label: "Square 1080" },
                        ]}
                        width="100%"
                      />

                      <Selector
                        label="Frame rate"
                        value={String(customSettings.frameRate)}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            frameRate: Number(value),
                          })
                        }
                        options={EDITING_FRAME_RATE_OPTIONS.map((option) => ({
                          value: String(option.value),
                          label: option.label,
                        }))}
                        width="100%"
                      />
                    </div>
                  </section>

                  <section className="rounded-[10px] border border-border bg-bg-1 p-4">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-2 text-fg-2">
                        <Gauge size={14} aria-hidden />
                      </span>
                      <div>
                        <h4 className="text-[12px] font-semibold text-fg">
                          Quality & encoding
                        </h4>
                        <p className="text-[10px] text-fg-muted">
                          Balance output quality, speed, and file size
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <ToolcraftNumberInputControl
                        label="Bitrate (kbps)"
                        value={customSettings.bitrate}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            bitrate: value || 0,
                          })
                        }
                        min={1000}
                        max={150000}
                        step={1000}
                        width="100%"
                      />

                      <div>
                        <ToolcraftSliderControl
                          label="Quality"
                          value={customSettings.quality}
                          onChange={(quality: number) =>
                            setCustomSettings({
                              ...customSettings,
                              quality,
                            })
                          }
                          min={50}
                          max={100}
                          step={1}
                          valueDisplay="none"
                        />
                        <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
                          <span>Smaller</span>
                          <span className="font-semibold text-fg-2">
                            {customSettings.quality}%
                          </span>
                          <span>Better</span>
                        </div>
                      </div>

                      {isDesktop && (
                        <div className="col-span-2 border-t border-border pt-4">
                          <Text
                            type="supporting"
                            color="secondary"
                            weight="bold"
                            display="block"
                            className="mb-2 text-[11px]"
                          >
                            Export mode
                          </Text>
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                ["fast", "Fast", "Hardware, quickest"],
                                [
                                  "balanced",
                                  "Balanced",
                                  "Hardware, great quality + small",
                                ],
                                [
                                  "smallest",
                                  "Smallest",
                                  "Software, smallest file",
                                ],
                              ] as const
                            ).map(([value, label, hint]) => (
                              <SelectableCard
                                key={value}
                                label={label}
                                isSelected={customSettings.encodeMode === value}
                                onChange={() =>
                                  setCustomSettings({
                                    ...customSettings,
                                    encodeMode: value,
                                  })
                                }
                                padding={0}
                                variant="default"
                                className="min-h-[58px] px-3 py-2.5 text-left"
                              >
                                <span className="block text-[11px] font-semibold text-fg">
                                  {label}
                                </span>
                                <span className="mt-0.5 block text-[9px] leading-3 text-fg-muted">
                                  {hint}
                                </span>
                              </SelectableCard>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-[10px] border border-border bg-bg-1 p-4">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-2 text-fg-2">
                        <Music size={14} aria-hidden />
                      </span>
                      <div>
                        <h4 className="text-[12px] font-semibold text-fg">
                          Audio
                        </h4>
                        <p className="text-[10px] text-fg-muted">
                          Format, sample rate, and bitrate
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {!isDesktop ? (
                        <div className="space-y-1 text-[11px]">
                          <p className="text-fg-muted">Audio format</p>
                          <p className="min-h-[32px] rounded-md border border-border bg-bg-2 px-2 py-2 text-fg">{!hasAudio ? "No audio" : browserAudioCodec?.toUpperCase() ?? (customSettings.format === "webm" ? "Opus" : "Automatic")}</p>
                          <p className="text-[10px] text-fg-muted">Compatible with this container</p>
                        </div>
                      ) : (
                      <Selector
                        label="Audio format"
                        value={customSettings.audioSettings.format}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            audioSettings: {
                              ...customSettings.audioSettings,
                              format: value as
                                | "mp3"
                                | "wav"
                                | "aac"
                                | "flac"
                                | "ogg",
                            },
                          })
                        }
                        options={[
                          { value: "aac", label: "AAC" },
                          { value: "mp3", label: "MP3" },
                          { value: "wav", label: "WAV" },
                        ]}
                        size="sm"
                        width="100%"
                      />
                      )}
                      <Selector
                        label="Sample rate"
                        value={String(customSettings.audioSettings.sampleRate)}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            audioSettings: {
                              ...customSettings.audioSettings,
                              sampleRate: Number(value) as
                                | 44100
                                | 48000
                                | 96000,
                            },
                          })
                        }
                        options={[
                          { value: "44100", label: "44.1 kHz" },
                          { value: "48000", label: "48 kHz" },
                          { value: "96000", label: "96 kHz" },
                        ]}
                        size="sm"
                        width="100%"
                      />
                      <Selector
                        label="Audio bitrate"
                        value={String(customSettings.audioSettings.bitrate)}
                        onChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            audioSettings: {
                              ...customSettings.audioSettings,
                              bitrate: Number(value),
                            },
                          })
                        }
                        options={[
                          { value: "128", label: "128 kbps" },
                          { value: "192", label: "192 kbps" },
                          { value: "256", label: "256 kbps" },
                          { value: "320", label: "320 kbps" },
                        ]}
                        size="sm"
                        width="100%"
                      />
                    </div>
                  </section>

                  <section className="rounded-[10px] border border-border bg-bg-1 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent">
                          <Zap size={14} aria-hidden />
                        </span>
                        <div>
                          <h4 className="text-[12px] font-semibold text-fg">
                            Enhance quality
                          </h4>
                          <p className="text-[10px] text-fg-muted">
                            Sharpen exports above the source resolution
                          </p>
                        </div>
                      </div>
                      <ToolcraftSwitchControl
                        ariaLabel="Enhance quality with upscaling"
                        checked={customSettings.upscaling?.enabled ?? false}
                        showLabel={false}
                        onCheckedChange={(checked) =>
                          setCustomSettings({
                            ...customSettings,
                            upscaling: {
                              ...customSettings.upscaling!,
                              enabled: checked,
                            },
                          })
                        }
                      />
                    </div>

                    {customSettings.upscaling?.enabled && (
                      <div className="mt-4 space-y-4 border-t border-border pt-4">
                        <div>
                          <Text
                            type="supporting"
                            color="secondary"
                            display="block"
                            className="mb-2 text-[10px] font-semibold"
                          >
                            Quality Mode
                          </Text>
                          <div className="grid grid-cols-3 gap-2">
                            {(["fast", "balanced", "quality"] as const).map(
                              (mode) => (
                                <SelectableCard
                                  key={mode}
                                  label={mode}
                                  isSelected={
                                    customSettings.upscaling?.quality === mode
                                  }
                                  onChange={() =>
                                    setCustomSettings({
                                      ...customSettings,
                                      upscaling: {
                                        ...customSettings.upscaling!,
                                        quality: mode as UpscaleQuality,
                                      },
                                    })
                                  }
                                  padding={0}
                                  variant="default"
                                  className="px-3 py-2 text-center text-[10px] font-semibold"
                                >
                                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                                </SelectableCard>
                              ),
                            )}
                          </div>
                        </div>

                        <div>
                          <ToolcraftSliderControl
                            label="Sharpening"
                            value={Math.round(
                              (customSettings.upscaling?.sharpening ?? 0.3) *
                                100,
                            )}
                            onChange={(value: number) =>
                              setCustomSettings({
                                ...customSettings,
                                upscaling: {
                                  ...customSettings.upscaling!,
                                  sharpening: value / 100,
                                },
                              })
                            }
                            min={0}
                            max={100}
                            step={1}
                            valueDisplay="none"
                          />
                          <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
                            <span>None</span>
                            <span className="font-semibold text-fg-2">
                              {Math.round(
                                (customSettings.upscaling?.sharpening ?? 0.3) *
                                  100,
                              )}
                              %
                            </span>
                            <span>Max</span>
                          </div>
                        </div>

                        <p className="rounded-md bg-bg-2 px-3 py-2 text-[10px] leading-4 text-fg-muted">
                          Best used when exporting above the project resolution.
                          It adds processing time.
                        </p>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {deviceProfile && (
              <div className="shrink-0 border-t border-border bg-bg-1 px-5 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <Button
                    label="Show device export estimate details"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeviceInfo(!showDeviceInfo)}
                    className="-ml-2 text-[11px] text-fg-muted"
                  >
                    <Cpu size={12} />
                    <span>{formatDeviceSummary(deviceProfile)}</span>
                    <Info size={10} className="text-fg-muted" />
                  </Button>

                  {timeEstimate && (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 rounded-full bg-bg-2 px-2.5 py-1 text-[11px]">
                        {timeEstimate.confidence === "measured" ? (
                          <CheckCircle
                            size={12}
                            className="text-status-success"
                          />
                        ) : (
                          <Gauge size={12} className="text-status-warning" />
                        )}
                        <span className="text-fg-muted">Estimate</span>
                        <span className="font-semibold text-fg">
                          {timeEstimate.formatted}
                        </span>
                      </div>

                      {shouldRecommendBenchmark(deviceProfile) &&
                        !isBenchmarking && (
                          <Button
                            label="Get accurate estimate"
                            variant="ghost"
                            size="sm"
                            onClick={handleRunBenchmark}
                            className="text-[10px] text-accent"
                          >
                            <Zap size={10} />
                            Get accurate estimate
                          </Button>
                        )}

                      {isBenchmarking && benchmarkProgress && (
                        <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-bg-3">
                            <div
                              className="h-full bg-accent transition-all"
                              style={{
                                width: `${benchmarkProgress.progress * 100}%`,
                              }}
                            />
                          </div>
                          <span>Testing...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {showDeviceInfo && (
                  <div className="mt-2 grid grid-cols-3 gap-4 rounded-lg bg-bg-2 px-3 py-2.5 text-[10px]">
                    <div>
                      <span className="text-fg-muted">CPU</span>
                      <Text
                        type="supporting"
                        weight="bold"
                        display="block"
                        className="text-fg"
                      >
                        {deviceProfile.cpu.cores} cores
                      </Text>
                    </div>
                    <div>
                      <span className="text-fg-muted">GPU</span>
                      <Text
                        type="supporting"
                        weight="bold"
                        display="block"
                        className="truncate text-fg"
                      >
                        {deviceProfile.gpu.renderer !== "Unknown"
                          ? deviceProfile.gpu.renderer
                              .replace(/ANGLE \(|, .*\)/g, "")
                              .replace(/Direct3D11.*$/g, "")
                              .trim()
                          : "Unknown"}
                      </Text>
                      <Text
                        type="supporting"
                        color="secondary"
                        display="block"
                        className="text-[9px]"
                      >
                        {deviceProfile.gpu.hasHardwareEncoding
                          ? "HW Encode"
                          : "Software only"}
                      </Text>
                    </div>
                    <div>
                      <span className="text-fg-muted">Codecs</span>
                      <div className="flex flex-wrap gap-1">
                        {codecRecommendations.slice(0, 3).map((rec) => (
                          <span
                            key={rec.codec}
                            className={`px-1 py-0.5 rounded text-[9px] ${
                              rec.speedRating === "fast"
                                ? "bg-status-success/15 text-status-success"
                                : rec.speedRating === "medium"
                                  ? "bg-status-warning/15 text-status-warning"
                                  : "bg-status-error/15 text-status-error"
                            }`}
                          >
                            {rec.codec.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter
            hasDivider
            className="flex-col items-stretch gap-3 px-5 py-3"
          >
            {!isDesktop && (
              <div className="space-y-1.5">
                <Selector label="Save video" value={delivery} onChange={(value) => setDelivery(value as ExportDeliveryMode)} options={[
                  { value: "download", label: "Download to this device" },
                  { value: "file", label: "Choose a file location" },
                ]} width="100%" />
                <p className="text-[11px] text-fg-muted">Export uses your original media at the selected quality. Choose a file location to stream large exports directly to disk.</p>
              </div>
            )}
            {!isDesktop && (
              <p role="status" className="text-[11px] text-fg-muted">{checkingCapability ? "Checking this browser’s encoder support…" : capabilityError ? "Choose another format to export in this browser." : "Codec availability depends on this browser. Try H.264 / MP4 or VP9 / WebM with Opus audio."}</p>
            )}
            {capabilityError && <div role="alert" className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning">{capabilityError}</div>}
            {validationError && (
              <div role="alert" className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning">
                {validationError}
              </div>
            )}
            {webExportAdjustment?.wasAdjusted && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] leading-4 text-status-warning"
              >
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0"
                  aria-hidden
                />
                Browser safety limits will export this video at{" "}
                {webExportAdjustment.settings.width}×
                {webExportAdjustment.settings.height} •{" "}
                {webExportAdjustment.settings.frameRate}fps.
              </div>
            )}
            {guardrailActive && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2"
              >
                <span className="flex items-start gap-2 text-[11px] leading-4 text-status-warning">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0"
                    aria-hidden
                  />
                  {WEB_EXPORT_GUARDRAIL_MESSAGE}
                </span>
                {h264FallbackAcknowledged ? (
                  <span className="text-[11px] text-fg-muted">
                    Will encode H.264 without transparency.
                  </span>
                ) : (
                  <div>
                    <Button
                      label="Export as H.264 anyway"
                      variant="secondary"
                      onClick={() => setH264FallbackAcknowledged(true)}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                {duration > 0 && (
                  <>
                    <div className="flex items-center gap-1 rounded-full bg-bg-2 px-2.5 py-1">
                      <Clock size={12} />
                      {formatDuration(duration)}
                    </div>
                    <div className="flex items-center gap-1 rounded-full bg-bg-2 px-2.5 py-1">
                      <HardDrive size={12} />~
                      {activeTab === "reduce" && reducePlan
                        ? formatBytes(reduceEstimatedBytes)
                        : formatFileSize(
                            activeTab === "presets" && selectedPreset
                              ? (selectedPreset.settings as VideoExportSettings)
                                  .bitrate || 8000
                              : customSettings.bitrate,
                            duration,
                          )}
                    </div>
                    {timeEstimate &&
                      deviceProfile?.encoding[
                        customSettings.codec as keyof typeof deviceProfile.encoding
                      ]?.hardware && (
                        <div className="flex items-center gap-1 text-green-500">
                          <Zap size={12} />
                          Hardware accelerated
                        </div>
                      )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button label="Cancel" variant="ghost" onClick={onClose} />
                <Button
                  label={
                    activeTab === "reduce"
                      ? "Compress & Export"
                      : "Export Video"
                  }
                  icon={
                    activeTab === "reduce" ? (
                      <Minimize2 size={16} aria-hidden />
                    ) : (
                      <Play size={16} aria-hidden />
                    )
                  }
                  variant="primary"
                  onClick={handleExport}
                  isDisabled={
                    (activeTab === "presets" && !selectedPreset) ||
                    (activeTab === "reduce" && !reducePlan) ||
                    Boolean(validationError) ||
                    Boolean(capabilityError) ||
                    guardrailBlocking
                  }
                />
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

export default ExportDialog;
