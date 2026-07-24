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
import { ToolcraftSegmentedControl, ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
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
  type DeviceProfile,
  type BenchmarkProgress,
  type TimeEstimate,
  type CodecRecommendation,
} from "@openreel/core";

const WEB_EXPORT_GUARDRAIL_MESSAGE =
  "Web export can't produce ProRes or alpha — this will encode H.264 without transparency. Use the desktop app for ProRes/alpha.";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (settings: VideoExportSettings) => void;
  duration?: number;
  projectWidth?: number;
  projectHeight?: number;
  frameRate?: number;
  sourceMatch?: SourceExportMatch | null;
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
}) => {
  const [activeTab, setActiveTab] = useState<
    "presets" | "custom" | "reduce"
  >("presets");
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
    frameRate: 30,
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

  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [timeEstimate, setTimeEstimate] = useState<TimeEstimate | null>(null);
  const [codecRecommendations, setCodecRecommendations] = useState<CodecRecommendation[]>([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkProgress | null>(null);
  const [showDeviceInfo, setShowDeviceInfo] = useState(false);
  const [h264FallbackAcknowledged, setH264FallbackAcknowledged] =
    useState(false);

  useEffect(() => {
    if (isOpen) {
      setPresets(exportPresetsManager.getAllPresets());
      setPlatforms(exportPresetsManager.getPlatforms());
      setSelectedPlatform("recommended");
      setSelectedPreset(null);

      getDeviceProfile().then((profile) => {
        setDeviceProfile(profile);
        setCodecRecommendations(
          getCodecRecommendations(profile, { width: projectWidth, height: projectHeight })
        );
      });
    }
  }, [isOpen, projectWidth, projectHeight]);

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
        getCodecRecommendations(updatedProfile, { width: projectWidth, height: projectHeight })
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
  );

  const filteredPresets =
    selectedPlatform === "recommended"
      ? recommendedForVideo.length > 0
        ? recommendedForVideo
        : exportPresetsManager.getRecommendedPresets()
      : selectedPlatform
        ? presets.filter((p) => p.platform === selectedPlatform)
        : exportPresetsManager.getRecommendedPresets();

  const isDesktop =
    typeof window !== "undefined" && window.openreel?.platform === "desktop";
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
    if (guardrailBlocking) return;
    if (activeTab === "reduce") {
      if (!reducePlan) return;
      onExport(compressionPlanToExportSettings(reducePlan));
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
    onExport(settings);
    onClose();
  }, [
    activeTab,
    selectedPreset,
    reducePlan,
    customSettings,
    onExport,
    onClose,
    guardrailBlocking,
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
    onExport(settings);
    onClose();
  }, [sourceMatch, customSettings, onExport, onClose]);

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
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} width={896} purpose="form">
      <Layout
        header={
          <DialogHeader
            title="Export Video"
            onOpenChange={(open) => !open && onClose()}
            startContent={<Download size={20} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent className="flex max-h-[85vh] flex-col overflow-hidden p-0">
        <div className="border-b border-border p-2">
          <ToolcraftSegmentedControl<"presets" | "custom" | "reduce">
            ariaLabel="Export mode"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: "presets", label: "Presets" },
              { value: "reduce", label: "Reduce Size" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </div>

          {sourceMatch && (
            <Button
              label="Quick Export Match Source"
              variant="ghost"
              onClick={handleMatchSourceExport}
              className="flex items-center justify-between gap-3 mx-3 mt-3 p-3 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/15 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Zap size={16} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary">
                    Quick Export — Match Source
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {sourceMatch.width}×{sourceMatch.height}
                    {sourceMatch.frameRate ? ` • ${sourceMatch.frameRate}fps` : ""} • MP4 · matches “{sourceMatch.sourceName}”
                  </div>
                </div>
              </div>
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-black text-xs font-medium shrink-0">
                <Download size={14} />
                Export
              </span>
            </Button>
          )}

          {activeTab === "presets" && (
          <div className="flex flex-1 overflow-hidden">
              <div className="w-48 border-r border-border overflow-y-auto">
                <SelectableCard
                  label="For Your Video"
                  isSelected={selectedPlatform === "recommended"}
                  onClick={() => setSelectedPlatform("recommended")}
                  onChange={() => setSelectedPlatform("recommended")}
                  padding={3}
                  variant={selectedPlatform === "recommended" ? "green" : "muted"}
                  className={`w-full flex flex-col items-start p-3 text-sm transition-colors ${
                    selectedPlatform === "recommended"
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-text-secondary hover:bg-background-tertiary"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Zap size={14} />
                    <span className="font-medium">For Your Video</span>
                  </div>
                  <span className="text-[10px] text-text-muted mt-0.5 ml-5">
                    {getAspectRatioLabel(aspectType)}
                  </span>
                </SelectableCard>
                <div className="h-px bg-border my-1" />
                {platforms.map((platform) => {
                  const PlatformIcon = PLATFORM_ICONS[platform] ?? Globe;
                  return (
                    <SelectableCard
                      key={platform}
                      label={platform}
                      isSelected={selectedPlatform === platform}
                      onClick={() => setSelectedPlatform(platform)}
                      onChange={() => setSelectedPlatform(platform)}
                      padding={3}
                      variant={selectedPlatform === platform ? "green" : "muted"}
                      className={`w-full flex items-center gap-2 p-3 text-sm transition-colors ${
                        selectedPlatform === platform
                          ? "bg-primary/10 text-primary border-r-2 border-primary"
                          : "text-text-secondary hover:bg-background-tertiary"
                      }`}
                    >
                      <PlatformIcon size={14} />
                      {platform}
                    </SelectableCard>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3">
                  {filteredPresets.map((preset) => {
                    const PlatformIcon = PLATFORM_ICONS[preset.platform] ?? Globe;
                    return (
                      <SelectableCard
                        key={preset.id}
                        label={preset.name}
                        isSelected={selectedPreset?.id === preset.id}
                        onClick={() => setSelectedPreset(preset)}
                        onChange={() => setSelectedPreset(preset)}
                        padding={4}
                        variant={selectedPreset?.id === preset.id ? "green" : "muted"}
                        className={`p-4 rounded-lg border text-left transition-colors ${
                          selectedPreset?.id === preset.id
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <PlatformIcon size={16} />
                            <span className="font-medium text-text-primary">
                              {preset.name}
                            </span>
                          </div>
                          {preset.recommended && (
                            <Star
                              size={12}
                              className="text-yellow-500 fill-yellow-500"
                            />
                          )}
                        </div>
                        <Text type="supporting" color="secondary" display="block" className="mb-2 text-[10px]">
                          {preset.description}
                        </Text>
                        {"width" in preset.settings && (
                          <div className="flex items-center gap-3 text-[10px] text-text-secondary">
                            <span>
                              {(preset.settings as VideoExportSettings).width}x
                              {(preset.settings as VideoExportSettings).height}
                            </span>
                            <span>
                              {(preset.settings as VideoExportSettings).frameRate}
                              fps
                            </span>
                            <span>{preset.aspectRatio}</span>
                          </div>
                        )}
                        {preset.maxDuration && (
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-yellow-500">
                            <Clock size={10} />
                            Max {preset.maxDuration}s
                          </div>
                        )}
                      </SelectableCard>
                    );
                  })}
                </div>
              </div>
          </div>
          )}

          {activeTab === "reduce" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-xl mx-auto space-y-5">
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-border bg-background-tertiary/40">
                <Minimize2 size={16} className="text-primary shrink-0 mt-0.5" />
                <Text type="supporting" color="secondary" display="block" className="text-xs">
                  Re-encode your project to a smaller file. Pick a quality tier,
                  or a target size for sharing on email, WhatsApp, or Discord.
                </Text>
              </div>

              <div>
                <Text type="label" color="secondary" weight="bold" display="block" className="mb-2 text-xs">
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
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-2 text-xs">
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
                        variant={reduceQuality === value ? "green" : "muted"}
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
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-2 text-xs">
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
                        variant={reduceSizePresetId === preset.id ? "green" : "muted"}
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
                      {reducePlan.videoBitrateKbps.toLocaleString()} kbps video
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
          <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Selector
                    label="Format"
                    value={customSettings.format}
                    onChange={(value) =>
                      setCustomSettings({
                        ...customSettings,
                        format: value as "mp4" | "webm" | "mov",
                      })
                    }
                    options={[
                      { value: "mp4", label: "MP4" },
                      { value: "webm", label: "WebM" },
                      { value: "mov", label: "MOV" },
                    ]}
                    width="100%"
                  />
                </div>

                <div>
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
                    ]}
                    width="100%"
                  />
                </div>

                <div>
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
                        ].includes(`${sourceMatch.width}x${sourceMatch.height}`)
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
                </div>

                <div>
                  <Selector
                    label="Frame Rate"
                    value={String(customSettings.frameRate)}
                    onChange={(value) =>
                      setCustomSettings({
                        ...customSettings,
                        frameRate: Number(value),
                      })
                    }
                    options={[
                      { value: "24", label: "24 fps" },
                      { value: "25", label: "25 fps" },
                      { value: "30", label: "30 fps" },
                      { value: "50", label: "50 fps" },
                      { value: "60", label: "60 fps" },
                    ]}
                    width="100%"
                  />
                </div>

                <div>
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
                </div>

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
                  <div className="flex justify-between text-[10px] text-text-muted mt-1">
                    <span>Smaller</span>
                    <span>{customSettings.quality}%</span>
                    <span>Better</span>
                  </div>
                </div>

                {isDesktop && (
                  <div className="col-span-2">
                    <Text type="supporting" color="secondary" weight="bold" display="block" className="mb-2 text-xs">
                      Export mode
                    </Text>
                    <div className="flex gap-2">
                      {(
                        [
                          ["fast", "Fast", "Hardware, quickest"],
                          ["balanced", "Balanced", "Hardware, great quality + small"],
                        ["smallest", "Smallest", "Software, tiniest files (slow)"],
                      ] as const
                      ).map(([value, label]) => (
                        <SelectableCard
                          key={value}
                          label={label}
                          isSelected={customSettings.encodeMode === value}
                          onChange={() =>
                            setCustomSettings({ ...customSettings, encodeMode: value })
                          }
                          padding={2}
                          variant={customSettings.encodeMode === value ? "green" : "muted"}
                          className="flex-1 text-center text-[10px]"
                        >
                          {label}
                        </SelectableCard>
                      ))}
                    </div>
                  </div>
                )}

                <div className="col-span-2">
                  <Text type="supporting" color="secondary" weight="bold" display="block" className="mb-2 text-xs">
                    Audio Settings
                  </Text>
                  <div className="grid grid-cols-3 gap-2">
                    <Selector
                      label="Audio format"
                      isLabelHidden
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
                    <Selector
                      label="Sample rate"
                      isLabelHidden
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
                      isLabelHidden
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
                </div>

                <div className="col-span-2 border-t border-border pt-4 mt-2">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-primary" />
                      <Text type="supporting" color="secondary" weight="bold" className="text-xs">
                        Enhance Quality (Upscaling)
                      </Text>
                    </div>
                    <ToolcraftSwitchControl
                      ariaLabel="Enhance Quality (Upscaling)"
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
                    <div className="space-y-3 pl-6">
                      <div>
                        <Text type="supporting" color="secondary" display="block" className="mb-1.5 text-[10px]">
                          Quality Mode
                        </Text>
                        <div className="flex gap-2">
                          {(["fast", "balanced", "quality"] as const).map(
                            (mode) => (
                              <SelectableCard
                                key={mode}
                                label={mode}
                                isSelected={customSettings.upscaling?.quality === mode}
                                onChange={() =>
                                  setCustomSettings({
                                    ...customSettings,
                                    upscaling: {
                                      ...customSettings.upscaling!,
                                      quality: mode as UpscaleQuality,
                                    },
                                  })
                                }
                                padding={2}
                                variant={customSettings.upscaling?.quality === mode ? "green" : "muted"}
                                className="flex-1 text-center text-[10px]"
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
                          value={Math.round((customSettings.upscaling?.sharpening ?? 0.3) * 100)}
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
                        <div className="flex justify-between text-[10px] text-text-muted mt-1">
                          <span>None</span>
                          <span>
                            {Math.round(
                              (customSettings.upscaling?.sharpening ?? 0.3) *
                                100,
                            )}
                            %
                          </span>
                          <span>Max</span>
                        </div>
                      </div>

                      <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                        Enhance quality when exporting to higher resolutions
                        than source. Uses edge-directed interpolation for
                        sharper details.
                      </Text>
                    </div>
                  )}
                </div>
              </div>
          </div>
          )}

        {deviceProfile && (
          <div className="px-4 py-3 border-t border-border bg-background-tertiary/50">
            <div className="flex items-center justify-between">
              <Button
                label="Show device export estimate details"
                variant="ghost"
                onClick={() => setShowDeviceInfo(!showDeviceInfo)}
                className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                <Cpu size={12} />
                <span>{formatDeviceSummary(deviceProfile)}</span>
                <Info size={10} className="text-text-muted" />
              </Button>

              {timeEstimate && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    {timeEstimate.confidence === "measured" ? (
                      <CheckCircle size={12} className="text-green-500" />
                    ) : (
                      <Gauge size={12} className="text-yellow-500" />
                    )}
                    <span className="text-text-secondary">Est. time:</span>
                    <span className="font-medium text-text-primary">
                      {timeEstimate.formatted}
                    </span>
                  </div>

                  {shouldRecommendBenchmark(deviceProfile) && !isBenchmarking && (
                    <Button
                      label="Get accurate estimate"
                      variant="ghost"
                      onClick={handleRunBenchmark}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors"
                    >
                      <Zap size={10} />
                      Get accurate estimate
                    </Button>
                  )}

                  {isBenchmarking && benchmarkProgress && (
                    <div className="flex items-center gap-2 text-[10px] text-text-muted">
                      <div className="w-16 h-1 bg-background-tertiary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${benchmarkProgress.progress * 100}%` }}
                        />
                      </div>
                      <span>Testing...</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {showDeviceInfo && (
              <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-3 gap-4 text-[10px]">
                <div>
                  <span className="text-text-muted">CPU</span>
                  <Text type="supporting" weight="bold" display="block" className="text-text-primary">
                    {deviceProfile.cpu.cores} cores
                  </Text>
                </div>
                <div>
                  <span className="text-text-muted">GPU</span>
                  <Text type="supporting" weight="bold" display="block" className="truncate text-text-primary">
                    {deviceProfile.gpu.renderer !== "Unknown"
                      ? deviceProfile.gpu.renderer.replace(/ANGLE \(|, .*\)/g, "").replace(/Direct3D11.*$/g, "").trim()
                      : "Unknown"}
                  </Text>
                  <Text type="supporting" color="secondary" display="block" className="text-[9px]">
                    {deviceProfile.gpu.hasHardwareEncoding ? "HW Encode" : "Software only"}
                  </Text>
                </div>
                <div>
                  <span className="text-text-muted">Codecs</span>
                  <div className="flex gap-1 flex-wrap">
                    {codecRecommendations.slice(0, 3).map((rec) => (
                      <span
                        key={rec.codec}
                        className={`px-1 py-0.5 rounded text-[9px] ${
                          rec.speedRating === "fast"
                            ? "bg-green-500/20 text-green-400"
                            : rec.speedRating === "medium"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-red-500/20 text-red-400"
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
        <LayoutFooter hasDivider>
        {guardrailActive && (
          <div
            role="alert"
            className="mb-3 flex flex-col gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3"
          >
            <span className="flex items-start gap-2 text-xs leading-snug text-yellow-500">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              {WEB_EXPORT_GUARDRAIL_MESSAGE}
            </span>
            {h264FallbackAcknowledged ? (
              <span className="text-[11px] text-text-muted">
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
          <div className="flex items-center gap-4 text-xs text-text-muted">
            {duration > 0 && (
              <>
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatDuration(duration)}
                </div>
                <div className="flex items-center gap-1">
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
                {timeEstimate && deviceProfile?.encoding[customSettings.codec as keyof typeof deviceProfile.encoding]?.hardware && (
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
              label={activeTab === "reduce" ? "Compress & Export" : "Start Export"}
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
