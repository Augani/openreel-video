import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Slider,
  Switch,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";
import {
  exportPresetsManager,
  type PlatformExportPreset,
} from "../../services/export-presets";
import type { VideoExportSettings, UpscaleQuality } from "@openreel/core";
import {
  getDeviceProfile,
  estimateExportTime,
  runBenchmark,
  getCodecRecommendations,
  formatDeviceSummary,
  shouldRecommendBenchmark,
  type DeviceProfile,
  type BenchmarkProgress,
  type TimeEstimate,
  type CodecRecommendation,
} from "@openreel/core";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (settings: VideoExportSettings) => void;
  duration?: number;
  projectWidth?: number;
  projectHeight?: number;
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

function getAspectRatioLabel(
  aspectType: AspectRatioType,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (aspectType) {
    case "vertical":
      return t("export.aspectRatio.vertical");
    case "square":
      return t("export.aspectRatio.square");
    case "horizontal":
      return t("export.aspectRatio.horizontal");
  }
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  YouTube: <Video size={16} />,
  Instagram: <Share2 size={16} />,
  Twitter: <Share2 size={16} />,
  TikTok: <Music size={16} />,
  Facebook: <Share2 size={16} />,
  LinkedIn: <Share2 size={16} />,
  Broadcast: <Monitor size={16} />,
  Web: <Globe size={16} />,
  Archive: <Archive size={16} />,
  Audio: <Music size={16} />,
  Custom: <Settings size={16} />,
};

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  duration = 0,
  projectWidth = 1920,
  projectHeight = 1080,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"presets" | "custom">("presets");
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

  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [timeEstimate, setTimeEstimate] = useState<TimeEstimate | null>(null);
  const [codecRecommendations, setCodecRecommendations] = useState<CodecRecommendation[]>([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState<BenchmarkProgress | null>(null);
  const [showDeviceInfo, setShowDeviceInfo] = useState(false);

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

    const settings =
      activeTab === "presets" && selectedPreset
        ? (selectedPreset.settings as VideoExportSettings)
        : customSettings;

    const estimate = estimateExportTime(deviceProfile, {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      duration,
      codec: settings.codec as "h264" | "h265" | "vp9" | "av1",
    });

    setTimeEstimate(estimate);
  }, [deviceProfile, duration, activeTab, selectedPreset, customSettings]);

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

  const handleExport = useCallback(() => {
    const settings =
      activeTab === "presets" && selectedPreset
        ? (selectedPreset.settings as VideoExportSettings)
        : customSettings;
    onExport(settings);
    onClose();
  }, [activeTab, selectedPreset, customSettings, onExport, onClose]);

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

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] p-0 gap-0 bg-background-secondary border-border overflow-hidden flex flex-col">
        <DialogHeader className="p-4 border-b border-border bg-background-tertiary space-y-0">
          <div className="flex items-center gap-3">
            <Download size={20} className="text-primary" />
            <DialogTitle className="text-lg font-bold text-text-primary">
              {t("export.title")}
            </DialogTitle>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "presets" | "custom")}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="flex border-b border-border bg-transparent rounded-none">
            <TabsTrigger
              value="presets"
              className="flex-1 flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary text-text-secondary hover:text-text-primary"
            >
              <Star size={16} />
              {t("export.presets")}
            </TabsTrigger>
            <TabsTrigger
              value="custom"
              className="flex-1 flex items-center justify-center gap-2 p-3 text-sm font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary text-text-secondary hover:text-text-primary"
            >
              <Settings size={16} />
              {t("export.custom")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="flex-1 overflow-hidden flex mt-0">
              <div className="w-48 border-r border-border overflow-y-auto">
                <button
                  onClick={() => setSelectedPlatform("recommended")}
                  className={`w-full flex flex-col items-start p-3 text-sm transition-colors ${
                    selectedPlatform === "recommended"
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-text-secondary hover:bg-background-tertiary"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Zap size={14} />
                    <span className="font-medium">{t("export.forYourVideo")}</span>
                  </div>
                  <span className="text-[10px] text-text-muted mt-0.5 ml-5">
                    {getAspectRatioLabel(aspectType, t)}
                  </span>
                </button>
                <div className="h-px bg-border my-1" />
                {platforms.map((platform) => (
                  <button
                    key={platform}
                    onClick={() => setSelectedPlatform(platform)}
                    className={`w-full flex items-center gap-2 p-3 text-sm transition-colors ${
                      selectedPlatform === platform
                        ? "bg-primary/10 text-primary border-r-2 border-primary"
                        : "text-text-secondary hover:bg-background-tertiary"
                    }`}
                  >
                    {PLATFORM_ICONS[platform] || <Globe size={14} />}
                    {platform}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-3">
                  {filteredPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedPreset(preset)}
                      className={`p-4 rounded-lg border text-left transition-colors ${
                        selectedPreset?.id === preset.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {PLATFORM_ICONS[preset.platform]}
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
                      <p className="text-[10px] text-text-muted mb-2">
                        {preset.description}
                      </p>
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
                          {t("export.maxDuration", { duration: preset.maxDuration })}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

          <TabsContent value="custom" className="flex-1 overflow-y-auto p-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.format")}
                  </label>
                  <Select
                    value={customSettings.format}
                    onValueChange={(value) =>
                      setCustomSettings({
                        ...customSettings,
                        format: value as "mp4" | "webm" | "mov",
                      })
                    }
                  >
                    <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      <SelectItem value="mp4">{t("export.formatOptions.mp4")}</SelectItem>
                      <SelectItem value="webm">{t("export.formatOptions.webm")}</SelectItem>
                      <SelectItem value="mov">{t("export.formatOptions.mov")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.codec")}
                  </label>
                  <Select
                    value={customSettings.codec}
                    onValueChange={(value) =>
                      setCustomSettings({
                        ...customSettings,
                        codec: value as VideoExportSettings["codec"],
                      })
                    }
                  >
                    <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      <SelectItem value="h264">{t("export.codecOptions.h264")}</SelectItem>
                      <SelectItem value="h265">{t("export.codecOptions.h265")}</SelectItem>
                      <SelectItem value="prores">{t("export.codecOptions.prores")}</SelectItem>
                      <SelectItem value="vp9">{t("export.codecOptions.vp9")}</SelectItem>
                      <SelectItem value="av1">{t("export.codecOptions.av1")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.resolution")}
                  </label>
                  <Select
                    value={`${customSettings.width}x${customSettings.height}`}
                    onValueChange={(value) => {
                      const [w, h] = value.split("x").map(Number);
                      setCustomSettings({
                        ...customSettings,
                        width: w,
                        height: h,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      <SelectItem value="3840x2160">{t("export.resolutionOptions.4k")}</SelectItem>
                      <SelectItem value="2560x1440">{t("export.resolutionOptions.2k")}</SelectItem>
                      <SelectItem value="1920x1080">{t("export.resolutionOptions.1080p")}</SelectItem>
                      <SelectItem value="1280x720">{t("export.resolutionOptions.720p")}</SelectItem>
                      <SelectItem value="854x480">{t("export.resolutionOptions.480p")}</SelectItem>
                      <SelectItem value="1080x1920">{t("export.resolutionOptions.vertical1080p")}</SelectItem>
                      <SelectItem value="1080x1080">{t("export.resolutionOptions.square1080")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.frameRate")}
                  </label>
                  <Select
                    value={String(customSettings.frameRate)}
                    onValueChange={(value) =>
                      setCustomSettings({
                        ...customSettings,
                        frameRate: Number(value),
                      })
                    }
                  >
                    <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-background-secondary border-border">
                      <SelectItem value="24">{t("export.frameRateOptions.24")}</SelectItem>
                      <SelectItem value="25">{t("export.frameRateOptions.25")}</SelectItem>
                      <SelectItem value="30">{t("export.frameRateOptions.30")}</SelectItem>
                      <SelectItem value="50">{t("export.frameRateOptions.50")}</SelectItem>
                      <SelectItem value="60">{t("export.frameRateOptions.60")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.bitrate")}
                  </Label>
                  <Input
                    type="number"
                    value={customSettings.bitrate}
                    onChange={(e) =>
                      setCustomSettings({
                        ...customSettings,
                        bitrate: Number(e.target.value),
                      })
                    }
                    className="bg-background-tertiary border-border text-text-primary"
                    min={1000}
                    max={150000}
                    step={1000}
                  />
                </div>

                <div>
                  <Label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.quality")}
                  </Label>
                  <Slider
                    value={[customSettings.quality]}
                    onValueChange={(value) =>
                      setCustomSettings({
                        ...customSettings,
                        quality: value[0],
                      })
                    }
                    min={50}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-text-muted mt-1">
                    <span>{t("export.smaller")}</span>
                    <span>{customSettings.quality}%</span>
                    <span>{t("export.better")}</span>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-text-secondary mb-2">
                    {t("export.audioSettings")}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={customSettings.audioSettings.format}
                      onValueChange={(value) =>
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
                    >
                      <SelectTrigger className="bg-background-tertiary border-border text-text-primary text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background-secondary border-border">
                        <SelectItem value="aac">{t("export.audioCodecOptions.aac")}</SelectItem>
                        <SelectItem value="mp3">{t("export.audioCodecOptions.mp3")}</SelectItem>
                        <SelectItem value="wav">{t("export.audioCodecOptions.wav")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(customSettings.audioSettings.sampleRate)}
                      onValueChange={(value) =>
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
                    >
                      <SelectTrigger className="bg-background-tertiary border-border text-text-primary text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background-secondary border-border">
                        <SelectItem value="44100">{t("export.sampleRateOptions.44100")}</SelectItem>
                        <SelectItem value="48000">{t("export.sampleRateOptions.48000")}</SelectItem>
                        <SelectItem value="96000">{t("export.sampleRateOptions.96000")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(customSettings.audioSettings.bitrate)}
                      onValueChange={(value) =>
                        setCustomSettings({
                          ...customSettings,
                          audioSettings: {
                            ...customSettings.audioSettings,
                            bitrate: Number(value),
                          },
                        })
                      }
                    >
                      <SelectTrigger className="bg-background-tertiary border-border text-text-primary text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background-secondary border-border">
                        <SelectItem value="128">{t("export.bitrateOptions.128")}</SelectItem>
                        <SelectItem value="192">{t("export.bitrateOptions.192")}</SelectItem>
                        <SelectItem value="256">{t("export.bitrateOptions.256")}</SelectItem>
                        <SelectItem value="320">{t("export.bitrateOptions.320")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="col-span-2 border-t border-border pt-4 mt-2">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-primary" />
                      <Label htmlFor="upscaling-switch" className="text-xs font-medium text-text-secondary">
                        {t("export.enhanceQuality")}
                      </Label>
                    </div>
                    <Switch
                      id="upscaling-switch"
                      checked={customSettings.upscaling?.enabled ?? false}
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
                        <label className="block text-[10px] text-text-muted mb-1.5">
                          {t("export.qualityMode")}
                        </label>
                        <div className="flex gap-2">
                          {(["fast", "balanced", "quality"] as const).map(
                            (mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() =>
                                  setCustomSettings({
                                    ...customSettings,
                                    upscaling: {
                                      ...customSettings.upscaling!,
                                      quality: mode as UpscaleQuality,
                                    },
                                  })
                                }
                                className={`flex-1 px-2 py-1.5 text-[10px] rounded border transition-colors ${
                                  customSettings.upscaling?.quality === mode
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border text-text-secondary hover:border-primary/50"
                                }`}
                              >
                                {t(`export.qualityModes.${mode}`)}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <div>
                        <Label className="block text-[10px] text-text-muted mb-1.5">
                          {t("export.sharpening")}
                        </Label>
                        <Slider
                          value={[Math.round((customSettings.upscaling?.sharpening ?? 0.3) * 100)]}
                          onValueChange={(value) =>
                            setCustomSettings({
                              ...customSettings,
                              upscaling: {
                                ...customSettings.upscaling!,
                                sharpening: value[0] / 100,
                              },
                            })
                          }
                          min={0}
                          max={100}
                          step={1}
                          className="w-full"
                        />
                        <div className="flex justify-between text-[10px] text-text-muted mt-1">
                          <span>{t("export.none")}</span>
                          <span>
                            {Math.round(
                              (customSettings.upscaling?.sharpening ?? 0.3) *
                                100,
                            )}
                            %
                          </span>
                          <span>{t("export.max")}</span>
                        </div>
                      </div>

                      <p className="text-[10px] text-text-muted">
                        {t("export.enhanceQualityHelp")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
          </TabsContent>
        </Tabs>

        {deviceProfile && (
          <div className="px-4 py-3 border-t border-border bg-background-tertiary/50">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowDeviceInfo(!showDeviceInfo)}
                className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                <Cpu size={12} />
                <span>{formatDeviceSummary(deviceProfile)}</span>
                <Info size={10} className="text-text-muted" />
              </button>

              {timeEstimate && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    {timeEstimate.confidence === "measured" ? (
                      <CheckCircle size={12} className="text-green-500" />
                    ) : (
                      <Gauge size={12} className="text-yellow-500" />
                    )}
                    <span className="text-text-secondary">{t("export.estTime")}</span>
                    <span className="font-medium text-text-primary">
                      {timeEstimate.formatted}
                    </span>
                  </div>

                  {shouldRecommendBenchmark(deviceProfile) && !isBenchmarking && (
                    <button
                      onClick={handleRunBenchmark}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-primary bg-primary/10 rounded hover:bg-primary/20 transition-colors"
                    >
                      <Zap size={10} />
                      {t("export.accurateEstimate")}
                    </button>
                  )}

                  {isBenchmarking && benchmarkProgress && (
                    <div className="flex items-center gap-2 text-[10px] text-text-muted">
                      <div className="w-16 h-1 bg-background-tertiary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${benchmarkProgress.progress * 100}%` }}
                        />
                      </div>
                      <span>{t("export.testing")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {showDeviceInfo && (
              <div className="mt-3 pt-3 border-t border-border/50 grid grid-cols-3 gap-4 text-[10px]">
                <div>
                  <span className="text-text-muted">{t("export.deviceInfo.cpu")}</span>
                  <p className="text-text-primary font-medium">
                    {t("export.deviceInfo.cores", { count: deviceProfile.cpu.cores })}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">{t("export.deviceInfo.gpu")}</span>
                  <p className="text-text-primary font-medium truncate" title={deviceProfile.gpu.renderer}>
                    {deviceProfile.gpu.renderer !== "Unknown"
                      ? deviceProfile.gpu.renderer.replace(/ANGLE \(|, .*\)/g, "").replace(/Direct3D11.*$/g, "").trim()
                      : t("export.deviceInfo.unknown")}
                  </p>
                  <p className="text-[9px] text-text-muted">
                    {deviceProfile.gpu.hasHardwareEncoding ? t("export.deviceInfo.hwEncode") : t("export.deviceInfo.softwareOnly")}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">{t("export.deviceInfo.codecs")}</span>
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

        <div className="flex items-center justify-between p-4 border-t border-border bg-background-tertiary">
          <div className="flex items-center gap-4 text-xs text-text-muted">
            {duration > 0 && (
              <>
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatDuration(duration)}
                </div>
                <div className="flex items-center gap-1">
                  <HardDrive size={12} />~
                  {formatFileSize(
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
                    {t("export.hardwareAccelerated")}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("export.cancel")}
            </Button>
            <Button
              onClick={handleExport}
              disabled={activeTab === "presets" && !selectedPreset}
            >
              <Play size={16} />
              {t("export.startExport")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExportDialog;
