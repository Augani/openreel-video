import React, {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { ExportStemsSection } from "./ExportStemsSection";
import { ExportPresetManager } from "./ExportPresetManager";
import { estimatePresetBytes, formatEstimatedSize } from "./export-preset-estimate";
import { sampleProgramFrame } from "../../services/color-sampling";
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
  Youtube,
  Instagram,
  Twitter,
  Facebook,
  Linkedin,
  Cpu,
  Gauge,
  Zap,
  CheckCircle,
  Info,
  Minimize2,
  ListPlus,
  AlertTriangle,
  X,
} from "@/icons/lucide-compat";
import { isBroadcastCodec, isDolbyFormat, dolbyContainerProblem, defaultDolbyBitrate, DOLBY_LABEL, DOLBY_VIDEO_CONTAINERS, DOLBY_VIDEO_DESKTOP_ONLY_REASON, effectiveRateControl, twoPassAvailability, BURN_IN_POSITIONS, DEFAULT_TIMECODE_BURN_IN, type TimecodeBurnInSettings, type BurnInPosition } from "@openreel/core";
import { EncoderPicker } from "./EncoderPicker";
import {
  Button,
  Alert,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  RadioGroup,
  RadioGroupItem,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Progress,
  cn,
} from "@openreel/ui";

import {
  exportPresetsManager,
  type PlatformExportPreset,
} from "../../services/export-presets";
import type {
  VideoExportSettings,
  AudioExportSettings,
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
  cacheFrameSize,
  DEFAULT_LOUDNESS_TARGET,
  LOUDNESS_PRESETS,
  MAX_LOUDNESS_TARGET_LUFS,
  MIN_LOUDNESS_TARGET_LUFS,
  isValidLoudnessTarget,
  getChannelLayout,
  type LoudnessTargetSettings,
  type DeviceProfile,
  type BenchmarkProgress,
  type TimeEstimate,
  type CodecRecommendation,
  type HdrExportSupport,
  probeHdrExportSupport,
  resolveWorkingColorSpace,
} from "@openreel/core";
import { EDITING_FRAME_RATE_OPTIONS } from "./editing-frame-rate";
import type { ExportDeliveryMode } from "../../services/export-runner";
import { getUseExportPreviews, setUseExportPreviews } from "../../services/export-queue/export-queue-activity";
import { useRenderCacheSnapshot } from "../../services/render-cache-service";
import { formatFrameTimecode } from "../../utils/frame-timecode";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { ExportCaptionOptions } from "./ExportCaptionOptions";
import { ExportStillPanel } from "./ExportStillPanel";
import { ExportBroadcastOptions } from "./ExportBroadcastOptions";
import { ExportDolbyOptions } from "./ExportDolbyOptions";
import { saveCaptionSidecars, sidecarFilesFor } from "../../services/caption-sidecar";
import { exportFilename } from "../../services/export-runner";
import type { CaptionExportSettings } from "@openreel/core";

const MobileExportSheet = lazy(() =>
  import("./mobile/MobileExportSheet").then((module) => ({
    default: module.MobileExportSheet,
  })),
);

const settingsFormatIsWebm = (settings: { format?: string }): boolean => settings.format === "webm";

const WEB_EXPORT_GUARDRAIL_MESSAGE =
  "ProRes, DNxHR, XDCAM HD422, AVC-Intra, MXF, mono audio tracks, timecode tracks, transparency, and high bit depth require the desktop encoder. You can export an H.264 MP4 without transparency in this browser.";

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (
    settings: VideoExportSettings,
    delivery?: ExportDeliveryMode,
  ) => void;
  /** When set, the dialog offers "Add to queue" next to "Export". */
  onAddToQueue?: (
    settings: VideoExportSettings,
    meta: { presetLabel: string; usePreviews: boolean },
  ) => void;
  duration?: number;
  projectWidth?: number;
  projectHeight?: number;
  frameRate?: number;
  sourceMatch?: SourceExportMatch | null;
  hasAudio?: boolean;
  markedRange?: VideoExportSettings["range"] | null;
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
  YouTube: Youtube,
  Instagram: Instagram,
  Twitter: Twitter,
  TikTok: Music,
  Facebook: Facebook,
  LinkedIn: Linkedin,
  Broadcast: Monitor,
  Web: Globe,
  Archive: Archive,
  Audio: Music,
  Custom: Settings,
};

/** The preset's real aspect ratio with the current Program frame cropped (cover) into it. */
const PresetAspectFrame: React.FC<{
  width: number;
  height: number;
  fallbackIcon: PlatformIcon;
  frameUrl?: string | null;
}> = ({ width, height, fallbackIcon: Fallback, frameUrl }) => {
  if (!(width > 0 && height > 0)) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-bg-2 text-fg-2">
        <Fallback size={16} />
      </span>
    );
  }
  const box = 40;
  const ratio = width / height;
  const w = ratio >= 1 ? box : Math.max(14, Math.round(box * ratio));
  const h = ratio >= 1 ? Math.max(14, Math.round(box / ratio)) : box;
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-bg-2"
      data-testid="preset-aspect-frame"
      data-aspect={ratio.toFixed(3)}
      aria-hidden
    >
      <span
        className="overflow-hidden rounded-[3px] border border-fg-muted bg-bg-3"
        style={{ width: w, height: h }}
      >
        {frameUrl ? (
          <img src={frameUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : null}
      </span>
    </span>
  );
};

/**
 * "Burn in timecode": one switch draws the sequence timecode (drop-frame aware) into every exported frame, above all
 * tracks and captions. Position and source are one click away; size and opacity keep the defaults.
 */
function TimecodeBurnInControl({
  value,
  onChange,
}: {
  value: TimecodeBurnInSettings;
  onChange: (next: TimecodeBurnInSettings) => void;
}) {
  const position = value.position ?? DEFAULT_TIMECODE_BURN_IN.position;
  const source = value.source ?? DEFAULT_TIMECODE_BURN_IN.source;
  return (
    <div className="space-y-2" data-testid="export-timecode-burn-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="export-burn-in-timecode" className="text-[12px] font-semibold text-fg">
            Burn in timecode
          </Label>
          <p className="text-[10px] text-fg-muted">
            Draws the {source === "source" ? "source file" : "sequence"} timecode into every frame. Frames are re-rendered, so no stream copy.
          </p>
        </div>
        <Switch
          id="export-burn-in-timecode"
          aria-label="Burn in timecode"
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      {value.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="export-burn-in-source" className="text-[10px] text-fg-muted">Timecode</Label>
            <Select value={source} onValueChange={(next) => onChange({ ...value, source: next as "sequence" | "source" })}>
              <SelectTrigger id="export-burn-in-source" aria-label="Burn-in timecode source" className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequence" className="text-xs">Sequence</SelectItem>
                <SelectItem value="source" className="text-xs">Source file (topmost clip)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="export-burn-in-position" className="text-[10px] text-fg-muted">Position</Label>
            <Select value={position} onValueChange={(next) => onChange({ ...value, position: next as BurnInPosition })}>
              <SelectTrigger id="export-burn-in-position" aria-label="Burn-in position" className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BURN_IN_POSITIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

/** A small JPEG of the Program frame at the playhead, captured once when the dialog opens. */
function useProgramFrameUrl(active: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const frame = await sampleProgramFrame();
        if (!frame || cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = frame.width;
        canvas.height = frame.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
        if (!cancelled) setUrl(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        // No frame to show: the card keeps the plain outline.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);
  return url;
}

/** Which sequence to render; hidden while the project has a single sequence. */
const ExportSequencePicker: React.FC = () => {
  const sequences = useProjectStore((state) => state.project.sequences);
  const activeId = useProjectStore((state) => state.project.activeSequenceId);
  const chosen = useUIStore((state) => state.exportSequenceId);
  const setChosen = useUIStore((state) => state.setExportSequenceId);
  if (!sequences || sequences.length < 2) return null;
  return (
    <label className="flex items-center gap-2 pt-1 text-xs text-fg-muted">
      Sequence
      <select
        data-testid="export-sequence"
        aria-label="Sequence to export"
        value={chosen ?? activeId ?? ""}
        onChange={(event) => setChosen(event.target.value === activeId ? null : event.target.value)}
        className="h-7 max-w-[220px] rounded-md border border-border bg-bg-2 px-2 text-xs text-fg"
      >
        {sequences.map((sequence) => (
          <option key={sequence.id} value={sequence.id}>
            {sequence.name}{sequence.id === activeId ? " (active)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
};

/**
 * "Use previews" switch. Lives in its own component so the render-cache
 * subscription exists only while the dialog is open: the dialog is mounted
 * for the whole session and the cache snapshot changes on every cached frame.
 */
const UsePreviewsToggle: React.FC<{
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  settings: Pick<VideoExportSettings, "width" | "height" | "frameRate" | "upscaling">;
  projectWidth: number;
  projectHeight: number;
}> = ({ checked, onCheckedChange, settings, projectWidth, projectHeight }) => {
  const snapshot = useRenderCacheSnapshot();
  const match = useMemo(() => {
    if (snapshot.frameCount === 0 || settings.upscaling?.enabled) return false;
    const size = cacheFrameSize(projectWidth, projectHeight);
    return (
      snapshot.frameRate === settings.frameRate &&
      size.width === settings.width &&
      size.height === settings.height
    );
  }, [snapshot.frameCount, snapshot.frameRate, settings, projectWidth, projectHeight]);
  return (
    <label
      className="flex items-center gap-1.5"
      title={
        match
          ? "Frames already rendered with Render In to Out are reused instead of re-rendering. Cached frames are lossy-encoded previews, so output can differ slightly from a fresh render."
          : "No frames rendered with Render In to Out match this export's resolution and frame rate, so everything renders fresh."
      }
    >
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label="Use previews" />
      <span>Use previews</span>
      <span className="text-fg-muted/70">{match ? "Rendered frames available" : "Nothing rendered yet"}</span>
    </label>
  );
};

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  onAddToQueue,
  duration: timelineDuration = 0,
  projectWidth = 1920,
  projectHeight = 1080,
  frameRate = 30,
  sourceMatch = null,
  hasAudio = true,
  markedRange = null,
}) => {
  const phone = usePhoneEditor();
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!isOpen) setAdvanced(false);
  }, [isOpen]);
  const [exportSection, setExportSection] = useState<"all" | "range">("all");
  const validMarkedRange =
    markedRange &&
    Number.isFinite(markedRange.startTime) &&
    Number.isFinite(markedRange.endTime) &&
    markedRange.startTime >= 0 &&
    markedRange.endTime > markedRange.startTime &&
    markedRange.endTime <= timelineDuration + 1e-7
      ? markedRange
      : null;
  const duration =
    exportSection === "range"
      ? validMarkedRange
        ? validMarkedRange.endTime - validMarkedRange.startTime
        : 0
      : timelineDuration;
  useEffect(() => {
    if (isOpen) setExportSection("all");
  }, [isOpen]);
  const isDesktop =
    typeof window !== "undefined" && window.openreel?.platform === "desktop";
  const [delivery, setDelivery] = useState<ExportDeliveryMode>(
    isDesktop ? "file" : "download",
  );
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [checkingCapability, setCheckingCapability] = useState(false);
  const sequenceStartTimecode = useProjectStore((state) => state.project.settings.startTimecode);
  const workingColorSpace = useProjectStore((state) =>
    resolveWorkingColorSpace(state.project.settings),
  );
  const [hdrSupport, setHdrSupport] = useState<HdrExportSupport | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    // Desktop: the ffmpeg sidecar writes the 10-bit file, so ask it which encoders this build has.
    const hardware = isDesktop
      ? (window.openreel?.probeHardware?.() ?? Promise.resolve(null)).catch(() => null)
      : Promise.resolve(null);
    void hardware
      .then((info) => probeHdrExportSupport({ native: isDesktop, encoders: info?.encoders }))
      .then((result) => {
        if (active) setHdrSupport(result);
      });
    return () => {
      active = false;
    };
  }, [isOpen, isDesktop]);
  const [browserAudioCodec, setBrowserAudioCodec] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"presets" | "custom" | "reduce" | "stills">(
    "presets",
  );
  const [loudness, setLoudness] = useState<LoudnessTargetSettings>(
    DEFAULT_LOUDNESS_TARGET,
  );
  const [loudnessPreset, setLoudnessPreset] = useState<string>("streaming");
  // 5.1 sequences deliver six channels by default; "stereo" mixes in 5.1 and downmixes (ITU-R BS.775).
  const sequenceIsSurround = useProjectStore((state) => getChannelLayout(state.project.settings) === "5.1");
  const [audioChannelChoice, setAudioChannelChoice] = useState<"5.1" | "stereo">("5.1");
  const subtitles = useProjectStore((state) => state.project.timeline.subtitles);
  const projectName = useProjectStore((state) => state.project.name);
  const [captionExport, setCaptionExport] = useState<CaptionExportSettings>({ tracks: [] });
  const [timecodeBurnIn, setTimecodeBurnIn] = useState<TimecodeBurnInSettings>({ enabled: false });
  const loudnessInvalid =
    activeTab === "custom" && loudness.enabled && !isValidLoudnessTarget(loudness);
  const applyExportSection = useCallback(
    (settings: VideoExportSettings): VideoExportSettings => ({
      ...settings,
      audioSettings: {
        ...settings.audioSettings,
        // The control lives on the Custom tab, so only Custom exports use it.
        loudness:
          activeTab === "custom" && loudness.enabled && isValidLoudnessTarget(loudness)
            ? { ...loudness }
            : undefined,
        // Only a 5.1 sequence has a choice; a stereo one never carries the field.
        ...(activeTab === "custom" && sequenceIsSurround && audioChannelChoice === "stereo" ? { channelLayout: "stereo" as const } : {}),
      },
      range:
        exportSection === "range" && validMarkedRange
          ? { ...validMarkedRange }
          : undefined,
      // Like loudness, the caption controls live on the Custom tab.
      captions:
        activeTab === "custom" && captionExport.tracks.length > 0
          ? captionExport
          : undefined,
      // One click, on every video tab: the sequence timecode is drawn into each frame.
      burnInTimecode: timecodeBurnIn.enabled && activeTab !== "stills" ? { ...timecodeBurnIn } : undefined,
    }),
    [exportSection, validMarkedRange, loudness, activeTab, captionExport, timecodeBurnIn, sequenceIsSurround, audioChannelChoice],
  );

  /** Sidecar caption files are independent of the render: save them when the export starts. */
  const saveSidecars = useCallback(
    (settings: VideoExportSettings) => {
      const files = sidecarFilesFor(subtitles, settings.captions, {
        baseName: exportFilename(projectName, "").replace(/\.$/, ""),
        frameRate: settings.frameRate,
        range: settings.range,
      });
      if (files.length) void saveCaptionSidecars(files).catch(() => undefined);
    },
    [subtitles, projectName],
  );
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(
    "recommended",
  );
  const [selectedPreset, setSelectedPreset] =
    useState<PlatformExportPreset | null>(null);
  const [presets, setPresets] = useState<PlatformExportPreset[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);

  const aspectType = getAspectRatioType(projectWidth, projectHeight);

  const [bitrateDraft, setBitrateDraft] = useState("15000");
  const [encoderBlocked, setEncoderBlocked] = useState(false);
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

  const resolutionOptions = useMemo(() => {
    const options = [
      { value: "3840x2160", label: "4K (3840x2160)" },
      { value: "2560x1440", label: "2K (2560x1440)" },
      { value: "1920x1080", label: "1080p (1920x1080)" },
      { value: "1280x720", label: "720p (1280x720)" },
      { value: "854x480", label: "480p (854x480)" },
      { value: "1080x1920", label: "Vertical 1080p" },
      { value: "1080x1080", label: "Square 1080" },
    ];
    for (const size of [
      sourceMatch && { ...sourceMatch, label: "Original" },
      {
        width: customSettings.width,
        height: customSettings.height,
        label: "Current",
      },
    ]) {
      if (!size) continue;
      const value = size.width + "x" + size.height;
      if (!options.some((option) => option.value === value))
        options.unshift({ value, label: size.label + " (" + value + ")" });
    }
    return options;
  }, [sourceMatch, customSettings.width, customSettings.height]);
  const frameRateOptions = useMemo(() => {
    const options = EDITING_FRAME_RATE_OPTIONS.map((option) => ({
      value: String(option.value),
      label: option.label,
    }));
    const value = String(customSettings.frameRate);
    if (!options.some((option) => option.value === value))
      options.push({ value, label: value + " fps" });
    return options;
  }, [customSettings.frameRate]);

  const projectPreset = useMemo<PlatformExportPreset>(
    () => ({
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
          format: "aac",
          sampleRate: 48000,
          bitDepth: 16,
          bitrate: 256,
          channels: 2,
        },
      },
    }),
    [projectWidth, projectHeight, frameRate],
  );

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
    return {
      ...customSettings,
      bitrate: bitrateDraft.trim() ? Number(bitrateDraft) : NaN,
    };
  }, [activeTab, selectedPreset, reducePlan, customSettings, bitrateDraft]);

  const twoPass = twoPassAvailability(isDesktop, customSettings, workingColorSpace);
  const twoPassAvailable = twoPass.available;
  const twoPassReason = twoPass.available ? null : twoPass.reason;

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
  const [codecRecommendations, setCodecRecommendations] = useState<
    CodecRecommendation[]
  >([]);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] =
    useState<BenchmarkProgress | null>(null);
  const benchmarkSession = useRef({ version: 0 }),
    benchmarkRunning = useRef(false),
    mounted = useRef(false);
  useEffect(() => {
    const session = benchmarkSession.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.version++;
    };
  }, []);
  useEffect(() => {
    const session = benchmarkSession.current;
    session.version++;
    setBenchmarkProgress(null);
    return () => {
      session.version++;
    };
  }, [isOpen, projectWidth, projectHeight]);
  const [showDeviceInfo, setShowDeviceInfo] = useState(false);
  const [h264FallbackAcknowledged, setH264FallbackAcknowledged] =
    useState(false);

  const resolveBrowserSettings = useCallback(
    (chosen: VideoExportSettings): VideoExportSettings => {
      // The browser has no real two-pass: a stored two-pass choice (preset, agent) runs as one-pass VBR here.
      const wantsTwoPass = !isDesktop && effectiveRateControl(chosen) === "vbr2";
      if (wantsTwoPass) {
        chosen = { ...chosen, rateControl: "vbr", bitrateMode: chosen.bitrateMode === "vbr2" ? "vbr1" : chosen.bitrateMode };
      }
      if (isDesktop || !exportSettingsRequireNativeEncoder(chosen))
        return chosen;
      return {
        ...chosen,
        format: "mp4",
        codec: "h264",
        colorDepth: 8,
        pixelFormat: "yuv420",
        proresProfile: undefined,
        broadcast: undefined,
      };
    },
    [isDesktop],
  );

  useEffect(() => {
    if (!isOpen || isDesktop || validationError) return;
    let active = true;
    setCapabilityError(null);
    setCheckingCapability(true);
    const settings = resolveWebCodecsExportLimits(
      resolveBrowserSettings(effectiveSettings),
      duration,
    ).settings;
    checkBrowserExportCapability(settings, undefined, hasAudio).then(
      (capability) => {
        if (!active) return;
        setCapabilityError(capability.reason);
        setBrowserAudioCodec(capability.audioCodec ?? null);
        setCheckingCapability(false);
      },
      () => {
        if (!active) return;
        setCapabilityError(
          "Could not check encoder support. Try another format.",
        );
        setBrowserAudioCodec(null);
        setCheckingCapability(false);
      },
    );
    return () => {
      active = false;
    };
  }, [
    isOpen,
    isDesktop,
    validationError,
    effectiveSettings,
    duration,
    resolveBrowserSettings,
    hasAudio,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      const videoPresets = exportPresetsManager
        .getAllPresets()
        .filter((preset) => "width" in preset.settings);
      setPresets(videoPresets);
      setPlatforms(
        Array.from(new Set(videoPresets.map((preset) => preset.platform))),
      );
    };
    refresh();
    return exportPresetsManager.subscribe(refresh);
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    if (isOpen) {
      setSelectedPlatform("recommended");
      setSelectedPreset(projectPreset);

      getDeviceProfile().then(
        (profile) => {
          if (!active) return;
          setDeviceProfile(profile);
          setCodecRecommendations(
            getCodecRecommendations(profile, {
              width: projectWidth,
              height: projectHeight,
            }),
          );
        },
        () => {
          if (!active) return;
          setDeviceProfile(null);
          setCodecRecommendations([]);
        },
      );
    }
    return () => {
      active = false;
    };
  }, [isOpen, projectWidth, projectHeight, projectPreset]);

  const timeEstimate = useMemo<TimeEstimate | null>(() => {
    if (!deviceProfile || duration <= 0) return null;
    const settings = effectiveSettings;
    return estimateExportTime(deviceProfile, {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
      duration,
      codec: settings.codec as "h264" | "h265" | "vp9" | "av1",
    });
  }, [deviceProfile, duration, effectiveSettings]);

  const handleRunBenchmark = useCallback(async () => {
    if (!isOpen || benchmarkRunning.current) return;
    benchmarkRunning.current = true;
    const session = benchmarkSession.current.version;
    const current = () =>
      mounted.current && benchmarkSession.current.version === session;
    setIsBenchmarking(true);
    setBenchmarkProgress(null);

    try {
      await runBenchmark((progress) => {
        if (current()) setBenchmarkProgress(progress);
      });
      if (!current()) return;
      const updatedProfile = await getDeviceProfile(true);
      if (!current()) return;
      setDeviceProfile(updatedProfile);
      setCodecRecommendations(
        getCodecRecommendations(updatedProfile, {
          width: projectWidth,
          height: projectHeight,
        }),
      );
    } catch (error) {
      if (current()) console.error("Benchmark failed:", error);
    } finally {
      benchmarkRunning.current = false;
      if (mounted.current) {
        setIsBenchmarking(false);
        setBenchmarkProgress(null);
      }
    }
  }, [isOpen, projectWidth, projectHeight]);

  const recommendedForVideo = getRecommendedPresetsForAspectRatio(
    presets,
    aspectType,
  )
    .filter((preset) => {
      const settings = preset.settings as VideoExportSettings;
      return (
        settings.width <= projectWidth &&
        settings.height <= projectHeight &&
        (isDesktop || !exportSettingsRequireNativeEncoder(settings))
      );
    })
    .slice(0, 5);

  const programFrameUrl = useProgramFrameUrl(isOpen);
  const presetSize = (preset: PlatformExportPreset): string =>
    "width" in preset.settings
      ? formatEstimatedSize(estimatePresetBytes(preset.settings as VideoExportSettings, duration))
      : "";
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

  /** The settings the dialog would export with right now, plus a label for queue rows. */
  const buildExportRequest = useCallback((): {
    settings: VideoExportSettings;
    presetLabel: string;
  } | null => {
    if (
      guardrailBlocking ||
      validationError ||
      capabilityError ||
      checkingCapability
    )
      return null;
    if (activeTab === "reduce") {
      if (!reducePlan) return null;
      return {
        settings: applyExportSection(
          resolveBrowserSettings(compressionPlanToExportSettings(reducePlan)),
        ),
        presetLabel: "Compressed",
      };
    }
    const chosen =
      activeTab === "presets" && selectedPreset
        ? (selectedPreset.settings as VideoExportSettings)
        : customSettings;
    const settings: VideoExportSettings = {
      ...chosen,
      encodeMode: customSettings.encodeMode ?? "balanced",
    };
    // A stale two-pass choice (codec or HDR changed after picking it, or a stored preset) runs as one-pass VBR.
    if (effectiveRateControl(settings) === "vbr2" && !twoPassAvailability(isDesktop, settings, workingColorSpace).available) {
      settings.rateControl = "vbr";
      if (settings.bitrateMode === "vbr2") settings.bitrateMode = "vbr1";
    }
    // AV1 and the fixed-rate codecs have no target / max bitrate control: never send a stale VBR choice for them.
    if (["av1", "prores", "dnxhr", "xdcamhd422", "avcintra100"].includes(settings.codec)) {
      delete settings.rateControl;
      delete settings.maxBitrate;
    }
    return {
      settings: applyExportSection(resolveBrowserSettings(settings)),
      presetLabel:
        activeTab === "presets" && selectedPreset
          ? selectedPreset.name
          : "Custom",
    };
  }, [
    activeTab,
    selectedPreset,
    reducePlan,
    customSettings,
    guardrailBlocking,
    validationError,
    capabilityError,
    checkingCapability,
    resolveBrowserSettings,
    applyExportSection,
  ]);

  const handleExport = useCallback(() => {
    const request = buildExportRequest();
    if (!request) return;
    onExport(request.settings, delivery);
    saveSidecars(request.settings);
    onClose();
  }, [buildExportRequest, onExport, onClose, delivery, saveSidecars]);

  const [usePreviews, setUsePreviews] = useState<boolean>(() => getUseExportPreviews());
  useEffect(() => {
    setUseExportPreviews(usePreviews);
  }, [usePreviews]);

  const handleAddToQueue = useCallback(() => {
    const request = buildExportRequest();
    if (!request || !onAddToQueue) return;
    onAddToQueue(request.settings, {
      presetLabel: request.presetLabel,
      usePreviews,
    });
    saveSidecars(request.settings);
    onClose();
  }, [buildExportRequest, onAddToQueue, onClose, usePreviews, saveSidecars]);

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
    onExport(applyExportSection(settings), delivery);
    onClose();
  }, [
    sourceMatch,
    customSettings,
    duration,
    onExport,
    onClose,
    delivery,
    applyExportSection,
  ]);

  const exportDisabled =
    (encoderBlocked && activeTab === "custom") ||
    loudnessInvalid ||
    (activeTab === "presets" && !selectedPreset) ||
    (activeTab === "reduce" && !reducePlan) ||
    Boolean(validationError) ||
    Boolean(capabilityError) ||
    checkingCapability ||
    guardrailBlocking;

  const updateMobileSettings = (patch: Partial<VideoExportSettings>) => {
    setBitrateDraft(String(patch.bitrate ?? effectiveSettings.bitrate));
    setCustomSettings({
      ...effectiveSettings,
      encodeMode: customSettings.encodeMode ?? "balanced",
      ...patch,
    });
    setActiveTab("custom");
  };

  const openAdvanced = (platform?: string) => {
    if (platform) {
      setSelectedPlatform(platform);
      setActiveTab("presets");
    }
    setAdvanced(true);
  };

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

  if (phone && !advanced)
    return (
      <Suspense fallback={null}>
        <MobileExportSheet
          open
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          settings={effectiveSettings}
          onSettingsChange={updateMobileSettings}
          duration={duration}
          onExport={handleExport}
          onAdvanced={openAdvanced}
          disabled={exportDisabled}
          checking={checkingCapability}
          error={validationError ?? capabilityError}
          adjustment={
            webExportAdjustment?.wasAdjusted
              ? webExportAdjustment.settings
              : null
          }
          nativeEncoderRequired={guardrailActive}
          fallbackAcknowledged={h264FallbackAcknowledged}
          onAcknowledgeFallback={() => setH264FallbackAcknowledged(true)}
          section={exportSection}
          delivery={delivery}
          onAddToQueue={onAddToQueue ? handleAddToQueue : undefined}
        />
      </Suspense>
    );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        hideCloseButton
        className={cn(
          "flex h-[min(820px,calc(100dvh-32px))] w-[1000px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden rounded-xl border-border bg-bg p-0 text-fg",
          phone && "mobile-export-advanced",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 text-left sm:text-left [@media(max-height:760px)]:py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Download
                size={20}
                className="mt-0.5 shrink-0 text-primary"
                aria-hidden
              />
              <div className="space-y-1">
                <DialogTitle className="text-[15px] font-semibold">
                  Export Video
                </DialogTitle>
                <DialogDescription className="text-xs text-fg-muted">
                  Choose a ready-made preset or fine-tune every setting.
                </DialogDescription>
                <ExportSequencePicker />
              </div>
            </div>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close export dialog"
                className={cn(
                  "size-7 shrink-0 text-fg-muted",
                  phone && "size-11",
                )}
              >
                <X size={14} />
              </Button>
            </DialogClose>
          </div>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as typeof activeTab)}
          className="export-dialog-content flex min-h-0 flex-1 flex-col overflow-hidden bg-bg"
        >
          {phone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 self-start m-2 text-xs text-fg-2"
              onClick={() => setAdvanced(false)}
              type="button"
              aria-label="Back to export summary"
            >
              <span className="truncate">{"Back to export summary"}</span>
            </Button>
          )}
          <div className="shrink-0 space-y-3 border-b border-border bg-bg-1 px-5 py-4 [@media(max-height:760px)]:space-y-2 [@media(max-height:760px)]:py-2.5">
            <fieldset className="space-y-2">
              <legend className="text-[12px] font-semibold text-fg">
                Export section
              </legend>
              <RadioGroup
                aria-label="Export section"
                name="export-section"
                orientation="horizontal"
                value={exportSection}
                onValueChange={(value) =>
                  setExportSection(value as "all" | "range")
                }
                className="flex flex-wrap items-center gap-5 text-[12px] text-fg"
              >
                <Label className="flex items-center gap-2 text-xs">
                  <RadioGroupItem
                    value="all"
                    aria-label="Entire timeline"
                    className="size-3.5 [&_svg]:size-2"
                  />
                  Entire timeline
                </Label>
                <Label
                  className={`flex items-center gap-2 text-xs ${!validMarkedRange ? "text-fg-muted" : ""}`}
                >
                  <RadioGroupItem
                    value="range"
                    aria-label="Marked In/Out"
                    disabled={!validMarkedRange}
                    className="size-3.5 [&_svg]:size-2"
                  />
                  Marked In/Out
                </Label>
                <span className="text-fg-muted">
                  {validMarkedRange
                    ? `${formatFrameTimecode(validMarkedRange.startTime, frameRate)} – ${formatFrameTimecode(validMarkedRange.endTime, frameRate)}`
                    : "Mark In and Out on the timeline to export a section."}
                </span>
              </RadioGroup>
            </fieldset>
            {activeTab !== "stills" && (
              <TimecodeBurnInControl value={timecodeBurnIn} onChange={setTimecodeBurnIn} />
            )}
            <TabsList
              aria-label="Export mode"
              className="h-8 w-full max-w-[440px] justify-start bg-bg-2 p-0.5"
            >
              <TabsTrigger value="presets" className="h-7 flex-1 text-xs">
                Presets
              </TabsTrigger>
              <TabsTrigger value="reduce" className="h-7 flex-1 text-xs">
                Smaller File
              </TabsTrigger>
              <TabsTrigger value="custom" className="h-7 flex-1 text-xs">
                Custom Settings
              </TabsTrigger>
              <TabsTrigger value="stills" className="h-7 flex-1 text-xs">
                Images &amp; GIF
              </TabsTrigger>
            </TabsList>

            {sourceMatch && activeTab === "presets" && (
              <div
                data-testid="quick-export-card"
                className="flex min-h-[72px] items-center justify-between gap-4 rounded-[10px] border border-accent/30 bg-accent/5 px-4 py-3 [@media(max-height:760px)]:min-h-[52px] [@media(max-height:760px)]:py-2"
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
                  variant="default"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  onClick={handleMatchSourceExport}
                  type="button"
                  aria-label="Quick Export"
                  disabled={duration <= 0}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {<Download size={14} aria-hidden />}
                  </span>
                  <span className="truncate">{"Quick Export"}</span>
                </Button>
              </div>
            )}
          </div>

          <TabsContent
            value="presets"
            className={cn(
              "export-preset-browser flex min-h-0 flex-1 overflow-hidden",
              "mt-0 data-[state=inactive]:hidden",
            )}
          >
            <RadioGroup
              aria-label="Export platform"
              value={selectedPlatform ?? "recommended"}
              onValueChange={(value) => setSelectedPlatform(value)}
              className="export-platforms block w-52 shrink-0 overflow-y-auto border-r border-border bg-bg-1 p-3"
            >
              <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
                Browse presets
              </div>
              <Label
                data-selected={
                  selectedPlatform === "recommended" ? "true" : undefined
                }
                className={cn(
                  "relative block cursor-pointer rounded-md border border-transparent bg-transparent text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                  selectedPlatform === "recommended" &&
                    "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                  `mb-2 flex w-full flex-col items-start px-3 py-2.5 text-[12px] transition-colors ${
                    selectedPlatform === "recommended"
                      ? "border-accent/30 bg-selected text-fg shadow-none"
                      : "text-fg-2"
                  }`,
                )}
                htmlFor={`export-platform-${"recommended"}`}
              >
                <RadioGroupItem
                  id={`export-platform-${"recommended"}`}
                  value={"recommended"}
                  aria-label="For Your Video"
                  className="sr-only"
                />
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-accent" />
                  <span className="font-semibold">Recommended</span>
                </div>
                <span className="ml-5 mt-1 text-[10px] leading-4 text-fg-muted">
                  {getAspectRatioLabel(aspectType)}
                </span>
              </Label>
              <div className="mb-2 h-px bg-border" />
              {platforms.map((platform) => {
                const PlatformIcon = PLATFORM_ICONS[platform] ?? Globe;
                return (
                  <Label
                    key={platform}
                    data-selected={
                      selectedPlatform === platform ? "true" : undefined
                    }
                    className={cn(
                      "relative block cursor-pointer rounded-md border border-transparent bg-transparent text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                      selectedPlatform === platform &&
                        "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                      `mb-1 flex w-full items-center gap-2.5 px-3 py-2 text-[12px] transition-colors ${
                        selectedPlatform === platform
                          ? "border-accent/30 bg-selected text-fg shadow-none"
                          : "text-fg-2"
                      }`,
                    )}
                    htmlFor={`export-platform-${platform}`}
                  >
                    <RadioGroupItem
                      id={`export-platform-${platform}`}
                      value={platform}
                      aria-label={platform}
                      className="sr-only"
                    />
                    <PlatformIcon
                      size={14}
                      className={
                        selectedPlatform === platform
                          ? "text-accent"
                          : "text-fg-muted"
                      }
                    />
                    {platform}
                  </Label>
                );
              })}
            </RadioGroup>

            <main className="export-preset-list min-w-0 flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h3 className="text-[14px] font-semibold text-fg">
                    {selectedPlatform === "recommended"
                      ? "Recommended for this video"
                      : selectedPlatform}
                  </h3>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Select a preset to see its estimated size and export time.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-bg-2 px-2.5 py-1 text-[10px] font-medium text-fg-muted">
                  {filteredPresets.length} {filteredPresets.length === 1 ? "option" : "options"}
                </span>
              </div>
              <ExportPresetManager
                currentSettings={effectiveSettings}
                selectedPreset={selectedPreset}
                onSelect={(preset) => {
                  setSelectedPlatform(preset.platform);
                  setSelectedPreset(preset);
                }}
                onDeleted={() => {
                  setSelectedPlatform("recommended");
                  setSelectedPreset(projectPreset);
                }}
              />
              <RadioGroup
                aria-label="Export preset"
                value={selectedPreset?.id ?? ""}
                onValueChange={(value) => {
                  const preset = filteredPresets.find(
                    (item) => item.id === value,
                  );
                  if (preset) setSelectedPreset(preset);
                }}
                className="grid grid-cols-2 gap-3"
              >
                {filteredPresets.map((preset) => {
                  const PlatformIcon = PLATFORM_ICONS[preset.platform] ?? Globe;
                  const isSelected = selectedPreset?.id === preset.id;
                  return (
                    <Label
                      key={preset.id}
                      data-selected={
                        selectedPreset?.id === preset.id ? "true" : undefined
                      }
                      className={cn(
                        "relative block cursor-pointer rounded-md border border-border bg-bg-1 text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                        selectedPreset?.id === preset.id &&
                          "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                        `rounded-[10px] p-2.5 text-left ${
                          isSelected
                            ? "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]"
                            : "border-border bg-bg-1 hover:border-accent/40 hover:bg-bg-2"
                        }`,
                      )}
                      htmlFor={`export-preset-${preset.id}`}
                    >
                      <RadioGroupItem
                        id={`export-preset-${preset.id}`}
                        value={preset.id}
                        aria-label={preset.name}
                        className="sr-only"
                      />
                      <div className="mb-1.5 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <PresetAspectFrame
                            width={"width" in preset.settings ? (preset.settings as VideoExportSettings).width : 0}
                            height={"height" in preset.settings ? (preset.settings as VideoExportSettings).height : 0}
                            fallbackIcon={PlatformIcon}
                            frameUrl={programFrameUrl}
                          />
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
                      <span className="text-fg-2 font-normal mb-1.5 line-clamp-2 block text-[11px] leading-4">
                        {preset.description}
                      </span>
                      {"width" in preset.settings && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-muted">
                          <span className="rounded bg-bg-2 px-1.5 py-0.5">
                            {(preset.settings as VideoExportSettings).width}x
                            {(preset.settings as VideoExportSettings).height}
                          </span>
                          <span className="rounded bg-bg-2 px-1.5 py-0.5">
                            {(preset.settings as VideoExportSettings).frameRate}
                            {" fps"}
                          </span>
                          {preset.aspectRatio ? (
                            <span className="rounded bg-bg-2 px-1.5 py-0.5">
                              {preset.aspectRatio}
                            </span>
                          ) : null}
                          {presetSize(preset) ? (
                            <span
                              className="rounded bg-bg-2 px-1.5 py-0.5 text-fg-2"
                              data-testid="preset-size"
                            >
                              {presetSize(preset)}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {preset.maxDuration && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-status-warning">
                          <Clock size={10} />
                          Max {preset.maxDuration}s
                        </div>
                      )}
                    </Label>
                  );
                })}
              </RadioGroup>
            </main>
          </TabsContent>

          <TabsContent
            value="reduce"
            className={cn(
              "flex-1 overflow-y-auto p-4",
              "mt-0 data-[state=inactive]:hidden",
            )}
          >
            <div className="max-w-xl mx-auto space-y-5">
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-border bg-background-tertiary/40">
                <Minimize2 size={16} className="text-primary shrink-0 mt-0.5" />
                <span className="text-fg-2 font-normal block text-xs">
                  Re-encode your project to a smaller file. Pick a quality tier,
                  or a target size for sharing on email, WhatsApp, or Discord.
                </span>
              </div>

              <div>
                <span className="text-fg-2 font-bold block mb-2 text-xs">
                  Reduce by
                </span>
                <RadioGroup
                  aria-label="Reduce by"
                  value={reduceMode}
                  onValueChange={(value) =>
                    setReduceMode(value as typeof reduceMode)
                  }
                  className="flex gap-2"
                >
                  {(
                    [
                      ["quality", "Quality"],
                      ["size", "Target size"],
                    ] as const
                  ).map(([value, label]) => (
                    <Label
                      key={value}
                      data-selected={reduceMode === value ? "true" : undefined}
                      className={cn(
                        "relative block cursor-pointer rounded-md border border-border bg-bg-1 text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                        reduceMode === value &&
                          "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                        `flex-1 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
                          reduceMode === value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-text-secondary hover:border-primary/50"
                        }`,
                      )}
                      htmlFor={`export-reduce-${value}`}
                    >
                      <RadioGroupItem
                        id={`export-reduce-${value}`}
                        value={value}
                        aria-label={label}
                        className="sr-only"
                      />
                      {label}
                    </Label>
                  ))}
                </RadioGroup>
              </div>

              {reduceMode === "quality" ? (
                <div>
                  <span className="text-fg-2 font-bold block mb-2 text-xs">
                    Quality
                  </span>
                  <RadioGroup
                    aria-label="Compression quality"
                    value={reduceQuality}
                    onValueChange={(value) =>
                      setReduceQuality(value as CompressionQuality)
                    }
                    className="grid grid-cols-3 gap-2"
                  >
                    {(
                      [
                        ["light", "Light", "Trim a little"],
                        ["balanced", "Balanced", "Best of both"],
                        ["strong", "Strong", "Smallest file"],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <Label
                        key={value}
                        data-selected={
                          reduceQuality === value ? "true" : undefined
                        }
                        className={cn(
                          "relative block cursor-pointer rounded-md border border-border bg-bg-1 text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                          reduceQuality === value &&
                            "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                          `px-3 py-2.5 text-left rounded-md border transition-colors ${
                            reduceQuality === value
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          }`,
                        )}
                        htmlFor={`export-compression-quality-${value}`}
                      >
                        <RadioGroupItem
                          id={`export-compression-quality-${value}`}
                          value={value}
                          aria-label={label}
                          className="sr-only"
                        />
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
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
              ) : (
                <div>
                  <span className="text-fg-2 font-bold block mb-2 text-xs">
                    Target size
                  </span>
                  <RadioGroup
                    aria-label="Target file size"
                    value={reduceSizePresetId}
                    onValueChange={(value) => setReduceSizePresetId(value)}
                    className="grid grid-cols-3 gap-2"
                  >
                    {COMPRESSION_SIZE_PRESETS.map((preset) => (
                      <Label
                        key={preset.id}
                        data-selected={
                          reduceSizePresetId === preset.id ? "true" : undefined
                        }
                        className={cn(
                          "relative block cursor-pointer rounded-md border border-border bg-bg-1 text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                          reduceSizePresetId === preset.id &&
                            "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                          `px-3 py-2.5 rounded-md border text-xs font-medium capitalize transition-colors ${
                            reduceSizePresetId === preset.id
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-text-secondary hover:border-primary/50"
                          }`,
                        )}
                        htmlFor={`export-target-size-${preset.id}`}
                      >
                        <RadioGroupItem
                          id={`export-target-size-${preset.id}`}
                          value={preset.id}
                          aria-label={preset.label}
                          className="sr-only"
                        />
                        {preset.label}
                      </Label>
                    ))}
                  </RadioGroup>
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
          </TabsContent>

          <TabsContent
            value="custom"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-5",
              "mt-0 data-[state=inactive]:hidden",
            )}
          >
            <div className="mx-auto max-w-[760px] space-y-4">
              <div>
                <h3 className="text-[14px] font-semibold text-fg">
                  Custom export
                </h3>
                <p className="mt-1 text-[11px] text-fg-muted">
                  Control the video, encoding, and audio settings for this file.
                </p>
              </div>

              <ExportPresetManager
                variant="save"
                currentSettings={effectiveSettings}
                selectedPreset={selectedPreset}
                onSelect={(preset) => {
                  setSelectedPlatform(preset.platform);
                  setSelectedPreset(preset);
                }}
              />

              <section className="rounded-[10px] border border-border bg-bg-1 p-4">
                <div className="mb-4 flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-2 text-fg-2">
                    <Video size={14} aria-hidden />
                  </span>
                  <div>
                    <h4 className="text-[12px] font-semibold text-fg">Video</h4>
                    <p className="text-[10px] text-fg-muted">
                      Container, codec, resolution, and frame rate
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="export-format"
                      className="text-[11px] text-fg-2"
                    >
                      Format
                    </Label>
                    <Select
                      value={customSettings.format}
                      onValueChange={(value) =>
                        setCustomSettings({
                          ...customSettings,
                          format: value as VideoExportSettings["format"],
                          codec:
                            value === "webm"
                              ? "vp9"
                              : value === "mxf"
                                ? (customSettings.codec === "dnxhr" || isBroadcastCodec(customSettings.codec) ? customSettings.codec : "dnxhr")
                                : (customSettings.codec === "vp9" && value !== "mkv") ||
                                    customSettings.codec === "vp8" ||
                                    (customSettings.codec === "dnxhr" && value !== "mov") ||
                                    (isBroadcastCodec(customSettings.codec) && value !== "mov")
                                  ? "h264"
                                  : customSettings.codec,
                          // WebM and MXF cannot carry AC-3 / E-AC-3: the track goes back to AAC (or PCM for MXF).
                          audioSettings:
                            isDolbyFormat(customSettings.audioSettings.format) && dolbyContainerProblem(value)
                              ? { ...customSettings.audioSettings, format: "aac", bitrate: 192 }
                              : customSettings.audioSettings,
                          // OP-Atom only exists in MXF.
                          broadcast: value === "mxf" || !customSettings.broadcast?.mxfPattern
                            ? customSettings.broadcast
                            : { ...customSettings.broadcast, mxfPattern: undefined },
                        })
                      }
                    >
                      <SelectTrigger
                        id="export-format"
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { value: "mp4", label: "MP4" },
                          { value: "webm", label: "WebM" },
                          { value: "mov", label: "MOV" },
                          ...(isDesktop ? [{ value: "mxf", label: "MXF" }, { value: "mkv", label: "MKV" }] : []),
                        ].map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="text-xs"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="export-codec"
                      className="text-[11px] text-fg-2"
                    >
                      Codec
                    </Label>
                    <Select
                      value={customSettings.codec}
                      onValueChange={(value) => {
                        const codec = value as VideoExportSettings["codec"];
                        const hdrActive = !!customSettings.hdr && customSettings.hdr !== "none";
                        // HDR is H.265 Main10 or (desktop) ProRes 4444 XQ; any other codec turns it off.
                        const hdrOverride: Partial<VideoExportSettings> =
                          hdrActive && codec === "prores" && isDesktop
                            ? { proresProfile: "4444xq", format: "mov" }
                            : hdrActive && codec !== "h265"
                              ? { hdr: undefined }
                              : {};
                        setCustomSettings({
                          ...customSettings,
                          codec,
                          // ProRes and DNxHR are MOV (or MXF for DNxHR) masters, never MP4/WebM.
                          format:
                            isBroadcastCodec(codec)
                              ? (customSettings.format === "mov" ? "mov" : "mxf")
                              : codec === "prores" || (codec === "dnxhr" && customSettings.format !== "mxf")
                                ? "mov"
                                : customSettings.format === "mxf" && codec !== "dnxhr"
                                  ? "mov"
                                  : customSettings.format,
                          // XDCAM HD422 and AVC-Intra are 1920x1080 / 1280x720 deliveries.
                          ...(isBroadcastCodec(codec) && !(
                            (customSettings.width === 1920 && customSettings.height === 1080) ||
                            (customSettings.width === 1280 && customSettings.height === 720)
                          ) ? { width: 1920, height: 1080 } : {}),
                          proresProfile: codec === "prores" ? (customSettings.proresProfile ?? "hq") : undefined,
                          dnxhrProfile: codec === "dnxhr" ? (customSettings.dnxhrProfile ?? "hq") : undefined,
                          alpha: codec === "prores" ? customSettings.alpha : undefined,
                          broadcast: !isBroadcastCodec(codec) && customSettings.broadcast?.scan
                            ? { ...customSettings.broadcast, scan: undefined }
                            : customSettings.broadcast,
                          ...hdrOverride,
                        });
                      }}
                    >
                      <SelectTrigger
                        id="export-codec"
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { value: "h264", label: "H.264" },
                          { value: "h265", label: "H.265 (HEVC)" },
                          { value: "prores", label: "ProRes" },
                          { value: "dnxhr", label: "DNxHR" },
                          { value: "xdcamhd422", label: "XDCAM HD422 (50 Mb/s)" },
                          { value: "avcintra100", label: "AVC-Intra 100" },
                          { value: "vp9", label: "VP9" },
                          { value: "av1", label: "AV1" },
                        ]
                          .filter(
                            (option) =>
                              (customSettings.format !== "webm" ||
                                ["vp9", "av1"].includes(option.value)) &&
                              (customSettings.format !== "mxf" || option.value === "dnxhr" || isBroadcastCodec(option.value)) &&
                              (isDesktop || (option.value !== "dnxhr" && !isBroadcastCodec(option.value))),
                          )
                          .map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="text-xs"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(customSettings.codec === "prores" || customSettings.codec === "dnxhr") && (
                    <div className="space-y-1.5" data-testid="export-pro-profile">
                      <Label htmlFor="export-pro-profile" className="text-[11px] text-fg-2">
                        {customSettings.codec === "prores" ? "ProRes profile" : "DNxHR profile"}
                      </Label>
                      <Select
                        value={
                          customSettings.codec === "prores"
                            ? (customSettings.proresProfile ?? "hq")
                            : (customSettings.dnxhrProfile ?? "hq")
                        }
                        onValueChange={(value) =>
                          setCustomSettings(
                            customSettings.codec === "prores"
                              ? {
                                  ...customSettings,
                                  proresProfile: value as NonNullable<VideoExportSettings["proresProfile"]>,
                                  alpha: value === "4444" || value === "4444xq" ? customSettings.alpha : undefined,
                                }
                              : { ...customSettings, dnxhrProfile: value as NonNullable<VideoExportSettings["dnxhrProfile"]> },
                          )
                        }
                      >
                        <SelectTrigger id="export-pro-profile" aria-label="Codec profile" className="h-8 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(customSettings.codec === "prores"
                            ? [
                                { value: "proxy", label: "422 Proxy" },
                                { value: "lt", label: "422 LT" },
                                { value: "standard", label: "422" },
                                { value: "hq", label: "422 HQ" },
                                { value: "4444", label: "4444" },
                                { value: "4444xq", label: "4444 XQ" },
                              ]
                            : [
                                { value: "lb", label: "LB (proxy)" },
                                { value: "sq", label: "SQ" },
                                { value: "hq", label: "HQ (8-bit 4:2:2)" },
                                { value: "hqx", label: "HQX (10-bit 4:2:2)" },
                                { value: "444", label: "444 (10-bit 4:4:4)" },
                              ]
                          ).map((option) => (
                            <SelectItem key={option.value} value={option.value} className="text-xs">
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {customSettings.codec === "prores" &&
                        (customSettings.proresProfile === "4444" || customSettings.proresProfile === "4444xq") && (
                          <label className="flex items-center gap-2 pt-1 text-[11px] text-fg-2">
                            <Switch
                              checked={customSettings.alpha === true}
                              onCheckedChange={(checked) => setCustomSettings({ ...customSettings, alpha: checked || undefined })}
                              aria-label="Write alpha channel"
                            />
                            Write alpha channel (transparent background)
                          </label>
                        )}
                    </div>
                  )}

                  <div className="space-y-1.5" data-testid="export-hdr-control">
                    <Label
                      htmlFor="export-hdr"
                      className="text-[11px] text-fg-2"
                    >
                      Color / HDR
                    </Label>
                    <Select
                      value={customSettings.hdr ?? "none"}
                      onValueChange={(value) => {
                        const hdr = value as NonNullable<VideoExportSettings["hdr"]>;
                        setCustomSettings(
                          hdr === "none"
                            ? { ...customSettings, hdr: undefined }
                            : isDesktop && customSettings.codec === "prores"
                              ? {
                                  ...customSettings,
                                  hdr,
                                  codec: "prores",
                                  proresProfile: "4444xq",
                                  format: "mov",
                                }
                              : {
                                  ...customSettings,
                                  hdr,
                                  codec: "h265",
                                  format:
                                    customSettings.format === "webm"
                                      ? "mp4"
                                      : customSettings.format,
                                },
                        );
                      }}
                    >
                      <SelectTrigger
                        id="export-hdr"
                        aria-label="Color and HDR"
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">
                          {workingColorSpace === "rec2020"
                            ? "SDR, Rec.2020"
                            : "SDR, Rec.709"}
                        </SelectItem>
                        <SelectItem
                          value="pq"
                          disabled={!hdrSupport?.supported}
                          className="text-xs"
                        >
                          HDR10 (PQ, BT.2020)
                        </SelectItem>
                        <SelectItem
                          value="hlg"
                          disabled={!hdrSupport?.supported}
                          className="text-xs"
                        >
                          HLG (BT.2020)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {hdrSupport && !hdrSupport.supported && (
                      <p
                        className="text-[10px] leading-snug text-fg-3"
                        data-testid="export-hdr-unavailable"
                      >
                        HDR output unavailable. {hdrSupport.reason}
                      </p>
                    )}
                    {customSettings.hdr && customSettings.hdr !== "none" && (
                      <p className="text-[10px] leading-snug text-fg-3">
                        {customSettings.codec === "prores"
                          ? "Writes ProRes 4444 XQ (10-bit 4:4:4)"
                          : "Writes 10-bit H.265 (Main10)"}{" "}
                        tagged BT.2020 with a{" "}
                        {customSettings.hdr === "pq" ? "PQ" : "HLG"} transfer
                        {isDesktop && customSettings.codec !== "prores" && customSettings.hdr === "pq"
                          ? " and HDR10 mastering-display metadata"
                          : ""}
                        . The sequence is rendered and graded in half-float
                        scene-linear Rec.2020, so HDR sources keep their
                        highlights above SDR white all the way to the file;
                        8-bit sources, titles and graphics sit at SDR white
                        (203 nits).
                      </p>
                    )}
                    {(!customSettings.hdr || customSettings.hdr === "none") &&
                      workingColorSpace === "rec2020" && (
                        <p className="text-[10px] leading-snug text-fg-3">
                          The sequence is set to Rec.2020 (half-float HDR working
                          mode): it is rendered in scene-linear Rec.2020, then
                          tone-mapped to an SDR file tagged BT.2020 primaries.
                        </p>
                      )}
                  </div>

                  <ExportBroadcastOptions
                    settings={customSettings}
                    onChange={setCustomSettings}
                    isDesktop={isDesktop}
                    sequenceStartTimecode={sequenceStartTimecode}
                  />

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="export-resolution"
                      className="text-[11px] text-fg-2"
                    >
                      Resolution
                    </Label>
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
                      <SelectTrigger
                        id="export-resolution"
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {resolutionOptions.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="text-xs"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="export-frame-rate"
                      className="text-[11px] text-fg-2"
                    >
                      Frame rate
                    </Label>
                    <Select
                      value={String(customSettings.frameRate)}
                      onValueChange={(value) =>
                        setCustomSettings({
                          ...customSettings,
                          frameRate: Number(value),
                        })
                      }
                    >
                      <SelectTrigger
                        id="export-frame-rate"
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {frameRateOptions.map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="text-xs"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="export-bitrate"
                      className="text-[11px] text-fg-2"
                    >
                      Bitrate (kbps)
                    </Label>
                    <Input
                      id="export-bitrate"
                      type="number"
                      inputMode="numeric"
                      min={1000}
                      max={150000}
                      step={1000}
                      value={bitrateDraft}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setBitrateDraft(value);
                        if (value.trim() && Number.isFinite(Number(value)))
                          setCustomSettings((current) => ({
                            ...current,
                            bitrate: Number(value),
                          }));
                      }}
                      className="h-8 text-xs"
                    />
                  </div>

                  {!["prores", "dnxhr", "xdcamhd422", "avcintra100", "av1"].includes(customSettings.codec) && (
                    <div className="col-span-2 grid grid-cols-2 gap-4" data-testid="export-rate-control">
                      <div className="space-y-1.5">
                        <Label htmlFor="export-rate-control" className="text-[11px] text-fg-2">
                          Rate control
                        </Label>
                        <select
                          id="export-rate-control"
                          value={effectiveRateControl(customSettings)}
                          onChange={(event) => {
                            const picked = event.currentTarget.value;
                            const mode = picked === "vbr2" ? "vbr2" : picked === "vbr" ? "vbr" : "quality";
                            setCustomSettings((current) => {
                              const { maxBitrate: _drop, ...rest } = current;
                              void _drop;
                              return mode === "quality" ? { ...rest, rateControl: "quality" } : { ...current, rateControl: mode };
                            });
                          }}
                          className="h-8 w-full rounded border border-border bg-bg-2 px-2 text-xs"
                          data-testid="export-rate-control-mode"
                        >
                          <option value="quality">Constant quality</option>
                          <option value="vbr">Target bitrate (VBR, 1-pass)</option>
                          <option value="vbr2" disabled={!twoPassAvailable} title={twoPassReason ?? undefined} data-testid="export-rate-control-vbr2">
                            {twoPassAvailable ? "Target bitrate (VBR, 2-pass)" : `Target bitrate (VBR, 2-pass) - unavailable: ${twoPassReason}`}
                          </option>
                        </select>
                      </div>
                      {effectiveRateControl(customSettings) !== "quality" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="export-max-bitrate" className="text-[11px] text-fg-2">
                            Max bitrate (kbps)
                          </Label>
                          <Input
                            id="export-max-bitrate"
                            type="number"
                            inputMode="numeric"
                            min={customSettings.bitrate}
                            step={1000}
                            placeholder={String(Math.round(customSettings.bitrate * 1.5))}
                            value={customSettings.maxBitrate ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value.trim();
                              setCustomSettings((current) => {
                                const { maxBitrate: _drop, ...rest } = current;
                                void _drop;
                                return value && Number.isFinite(Number(value)) ? { ...current, maxBitrate: Number(value) } : rest;
                              });
                            }}
                            className="h-8 text-xs"
                            data-testid="export-max-bitrate"
                          />
                        </div>
                      )}
                      <p className="col-span-2 text-[10px] leading-snug text-fg-muted">
                        Target bitrate holds the average near the Bitrate above and keeps peaks under the max. The desktop app applies both; the browser applies the average only. Two-pass (desktop, H.264 / H.265) analyses the whole timeline first, keeps a lossless copy on disk, then encodes it to hit the target more precisely; it takes about twice as long and, on clips shorter than about 10 seconds, can overshoot the target by 6-7 %. Not available with Rec.2020 / HDR sequences. AV1 exports use constant quality.
                      </p>
                    </div>
                  )}

                  <div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="export-quality"
                        className="text-[11px] text-fg-2"
                      >
                        Quality
                      </Label>
                      <Slider
                        id="export-quality"
                        aria-label="Quality"
                        value={[customSettings.quality]}
                        onValueChange={([value]) =>
                          ((quality: number) =>
                            setCustomSettings({
                              ...customSettings,
                              quality,
                            }))(value)
                        }
                        min={50}
                        max={100}
                        step={1}
                        className="py-1"
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
                      <span>Smaller</span>
                      <span className="font-semibold text-fg-2">
                        {customSettings.quality}%
                      </span>
                      <span>Better</span>
                    </div>
                  </div>

                  {["h264", "h265", "av1"].includes(customSettings.codec) && (
                    <EncoderPicker
                      codec={customSettings.codec}
                      width={customSettings.width}
                      height={customSettings.height}
                      frameRate={customSettings.frameRate}
                      value={customSettings.encoderChoice ?? "auto"}
                      onChange={(encoderChoice) => setCustomSettings((current) => ({ ...current, encoderChoice }))}
                      onBlockedChange={setEncoderBlocked}
                    />
                  )}

                  {isDesktop && (
                    <div className="col-span-2 border-t border-border pt-4">
                      <span className="text-fg-2 font-bold block mb-2 text-[11px]">
                        Export mode
                      </span>
                      <RadioGroup
                        aria-label="Encoding mode"
                        value={customSettings.encodeMode ?? "balanced"}
                        onValueChange={(value) =>
                          setCustomSettings((current) => ({
                            ...current,
                            encodeMode:
                              value as VideoExportSettings["encodeMode"],
                          }))
                        }
                        className="grid grid-cols-3 gap-2"
                      >
                        {(
                          [
                            ["fast", "Fast", "Hardware, quickest"],
                            [
                              "balanced",
                              "Balanced",
                              "Hardware, great quality + small",
                            ],
                            ["smallest", "Smallest", "Software, smallest file"],
                          ] as const
                        ).map(([value, label, hint]) => (
                          <Label
                            key={value}
                            data-selected={
                              customSettings.encodeMode === value
                                ? "true"
                                : undefined
                            }
                            className={cn(
                              "relative block cursor-pointer rounded-md border border-border bg-bg-1 text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                              customSettings.encodeMode === value &&
                                "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                              "min-h-[58px] px-3 py-2.5 text-left",
                            )}
                            htmlFor={`export-encoding-${value}`}
                          >
                            <RadioGroupItem
                              id={`export-encoding-${value}`}
                              value={value}
                              aria-label={label}
                              className="sr-only"
                            />
                            <span className="block text-[11px] font-semibold text-fg">
                              {label}
                            </span>
                            <span className="mt-0.5 block text-[9px] leading-3 text-fg-muted">
                              {hint}
                            </span>
                          </Label>
                        ))}
                      </RadioGroup>
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
                    <h4 className="text-[12px] font-semibold text-fg">Audio</h4>
                    <p className="text-[10px] text-fg-muted">
                      Format, sample rate, and bitrate
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {!isDesktop ? (
                    <div className="space-y-1 text-[11px]">
                      <p className="text-fg-muted">Audio format</p>
                      <p className="min-h-[32px] rounded-md border border-border bg-bg-2 px-2 py-2 text-fg">
                        {!hasAudio
                          ? "No audio"
                          : (browserAudioCodec?.toUpperCase() ??
                            (customSettings.format === "webm"
                              ? "Opus"
                              : "Automatic"))}
                      </p>
                      <p className="text-[10px] text-fg-muted">
                        Compatible with this container
                      </p>
                      {isDolbyFormat(customSettings.audioSettings.format) && (
                        <p className="text-[10px] text-status-warning" data-testid="export-dolby-desktop-only">
                          {DOLBY_VIDEO_DESKTOP_ONLY_REASON}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="export-audio-format"
                        className="text-[11px] text-fg-2"
                      >
                        Audio format
                      </Label>
                      <Select
                        value={customSettings.audioSettings.format}
                        onValueChange={(value) =>
                          setCustomSettings({
                            ...customSettings,
                            audioSettings: {
                              ...customSettings.audioSettings,
                              format: value as AudioExportSettings["format"],
                              // A Dolby format starts at its usual rate for the channel count; leaving one returns to AAC's.
                              ...(isDolbyFormat(value)
                                ? { bitrate: defaultDolbyBitrate(value, sequenceIsSurround && audioChannelChoice === "5.1" ? 6 : 2) }
                                : isDolbyFormat(customSettings.audioSettings.format)
                                  ? { bitrate: 192, dialnorm: undefined }
                                  : {}),
                            },
                          })
                        }
                      >
                        <SelectTrigger
                          id="export-audio-format"
                          className="h-8 w-full text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            { value: "aac", label: "AAC" },
                            { value: "mp3", label: "MP3" },
                            { value: "wav", label: "WAV" },
                            ...(DOLBY_VIDEO_CONTAINERS.includes(customSettings.format)
                              ? (["ac3", "eac3"] as const).map((codec) => ({ value: codec, label: DOLBY_LABEL[codec] }))
                              : []),
                          ].map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="text-xs"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="export-sample-rate"
                      className="text-[11px] text-fg-2"
                    >
                      Sample rate
                    </Label>
                    <Select
                      value={String(customSettings.audioSettings.sampleRate)}
                      onValueChange={(value) =>
                        setCustomSettings({
                          ...customSettings,
                          audioSettings: {
                            ...customSettings.audioSettings,
                            sampleRate: Number(value) as 44100 | 48000 | 96000,
                          },
                        })
                      }
                    >
                      <SelectTrigger
                        id="export-sample-rate"
                        className="h-8 w-full text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { value: "44100", label: "44.1 kHz" },
                          { value: "48000", label: "48 kHz" },
                          ...(isDolbyFormat(customSettings.audioSettings.format) ? [] : [{ value: "96000", label: "96 kHz" }]),
                        ].map((option) => (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className="text-xs"
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {!(isDesktop && isDolbyFormat(customSettings.audioSettings.format)) && (
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="export-audio-bitrate"
                        className="text-[11px] text-fg-2"
                      >
                        Audio bitrate
                      </Label>
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
                        <SelectTrigger
                          id="export-audio-bitrate"
                          className="h-8 w-full text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            { value: "128", label: "128 kbps" },
                            { value: "192", label: "192 kbps" },
                            { value: "256", label: "256 kbps" },
                            { value: "320", label: "320 kbps" },
                          ].map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="text-xs"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {isDesktop && (
                    <ExportDolbyOptions
                      audio={customSettings.audioSettings}
                      onChange={(audioSettings) => setCustomSettings({ ...customSettings, audioSettings })}
                      surround={sequenceIsSurround && audioChannelChoice === "5.1"}
                    />
                  )}
                  {sequenceIsSurround && (
                    <div className="space-y-1.5" data-testid="export-audio-channels">
                      <Label htmlFor="export-audio-channels-select" className="text-[11px] text-fg-2">
                        Audio channels
                      </Label>
                      <Select value={audioChannelChoice} onValueChange={(value) => setAudioChannelChoice(value as "5.1" | "stereo")}>
                        <SelectTrigger id="export-audio-channels-select" className="h-8 w-full text-xs" data-testid="export-audio-channels-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5.1" className="text-xs">5.1 surround (6 channels, 384 kbps or more)</SelectItem>
                          <SelectItem value="stereo" className="text-xs">Stereo downmix</SelectItem>
                        </SelectContent>
                      </Select>
                      {audioChannelChoice === "5.1" && settingsFormatIsWebm(customSettings) && (
                        <p className="text-[10px] text-status-warning" data-testid="export-audio-channels-webm">
                          WebM cannot carry 5.1. Choose MP4 or MOV, or a stereo downmix.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div
                  className="mt-3 border-t border-border pt-3"
                  data-testid="export-loudness"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label
                        htmlFor="export-normalize-loudness"
                        className="text-[11px] text-fg"
                      >
                        Normalize to target loudness
                      </Label>
                      <p className="text-[10px] text-fg-muted">
                        Measures the mix (ITU-R BS.1770-4), sets the gain, and
                        limits true peaks to the ceiling.
                      </p>
                    </div>
                    <Switch
                      id="export-normalize-loudness"
                      aria-label="Normalize to target loudness"
                      checked={loudness.enabled}
                      onCheckedChange={(enabled) =>
                        setLoudness((current) => ({ ...current, enabled }))
                      }
                    />
                  </div>
                  {loudness.enabled && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="export-loudness-preset"
                          className="text-[11px] text-fg-2"
                        >
                          Target
                        </Label>
                        <Select
                          value={loudnessPreset}
                          onValueChange={(value) => {
                            setLoudnessPreset(value);
                            const preset = LOUDNESS_PRESETS.find(
                              (item) => item.id === value,
                            );
                            if (preset)
                              setLoudness((current) => ({
                                ...current,
                                targetLufs: preset.targetLufs,
                                truePeakCeilingDb: preset.truePeakCeilingDb,
                              }));
                          }}
                        >
                          <SelectTrigger
                            id="export-loudness-preset"
                            aria-label="Loudness target preset"
                            className="h-8 w-full text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LOUDNESS_PRESETS.map((preset) => (
                              <SelectItem
                                key={preset.id}
                                value={preset.id}
                                className="text-xs"
                              >
                                {preset.label}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom" className="text-xs">
                              Custom
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="export-loudness-lufs"
                          className="text-[11px] text-fg-2"
                        >
                          Integrated (LUFS)
                        </Label>
                        <Input
                          id="export-loudness-lufs"
                          type="number"
                          step={0.5}
                          min={MIN_LOUDNESS_TARGET_LUFS}
                          max={MAX_LOUDNESS_TARGET_LUFS}
                          className="h-8 text-xs"
                          value={loudness.targetLufs}
                          onChange={(event) => {
                            setLoudnessPreset("custom");
                            setLoudness((current) => ({
                              ...current,
                              targetLufs: event.target.valueAsNumber,
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="export-loudness-ceiling"
                          className="text-[11px] text-fg-2"
                        >
                          True-peak ceiling (dBTP)
                        </Label>
                        <Input
                          id="export-loudness-ceiling"
                          type="number"
                          step={0.5}
                          min={-20}
                          max={0}
                          className="h-8 text-xs"
                          value={loudness.truePeakCeilingDb}
                          onChange={(event) => {
                            setLoudnessPreset("custom");
                            setLoudness((current) => ({
                              ...current,
                              truePeakCeilingDb: event.target.valueAsNumber,
                            }));
                          }}
                        />
                      </div>
                      {loudnessInvalid && (
                        <p
                          className="col-span-3 text-[10px] text-status-error"
                          role="alert"
                        >
                          Target must be between {MIN_LOUDNESS_TARGET_LUFS} and{" "}
                          {MAX_LOUDNESS_TARGET_LUFS} LUFS, with a ceiling from
                          -20 to 0 dBTP.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <ExportStemsSection onQueued={onClose} />

              <ExportCaptionOptions
                subtitles={subtitles}
                value={captionExport}
                onChange={setCaptionExport}
                format={customSettings.format}
                isDesktop={isDesktop}
                frameRate={customSettings.frameRate}
              />

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
                  <Switch
                    aria-label="Enhance quality with upscaling"
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
                  <div className="mt-4 space-y-4 border-t border-border pt-4">
                    <div>
                      <span className="text-fg-2 block mb-2 text-[10px] font-semibold">
                        Quality Mode
                      </span>
                      <RadioGroup
                        aria-label="Upscaling quality"
                        value={customSettings.upscaling?.quality ?? "balanced"}
                        onValueChange={(value) =>
                          setCustomSettings((current) => ({
                            ...current,
                            upscaling: {
                              ...current.upscaling!,
                              quality: value as UpscaleQuality,
                            },
                          }))
                        }
                        className="grid grid-cols-3 gap-2"
                      >
                        {(["fast", "balanced", "quality"] as const).map(
                          (mode) => (
                            <Label
                              key={mode}
                              data-selected={
                                customSettings.upscaling?.quality === mode
                                  ? "true"
                                  : undefined
                              }
                              className={cn(
                                "relative block cursor-pointer rounded-md border border-border bg-bg-1 text-fg transition-colors hover:bg-bg-2 focus-within:ring-2 focus-within:ring-ring",
                                customSettings.upscaling?.quality === mode &&
                                  "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
                                "px-3 py-2 text-center text-[10px] font-semibold",
                              )}
                              htmlFor={`export-upscaling-${mode}`}
                            >
                              <RadioGroupItem
                                id={`export-upscaling-${mode}`}
                                value={mode}
                                aria-label={mode}
                                className="sr-only"
                              />
                              {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </Label>
                          ),
                        )}
                      </RadioGroup>
                    </div>

                    <div>
                      <div className="space-y-2">
                        <Label
                          htmlFor="export-sharpening"
                          className="text-[11px] text-fg-2"
                        >
                          Sharpening
                        </Label>
                        <Slider
                          id="export-sharpening"
                          aria-label="Sharpening"
                          value={[
                            Math.round(
                              (customSettings.upscaling?.sharpening ?? 0.3) *
                                100,
                            ),
                          ]}
                          onValueChange={([value]) =>
                            ((value: number) =>
                              setCustomSettings({
                                ...customSettings,
                                upscaling: {
                                  ...customSettings.upscaling!,
                                  sharpening: value / 100,
                                },
                              }))(value)
                          }
                          min={0}
                          max={100}
                          step={1}
                          className="py-1"
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-fg-muted">
                        <span>None</span>
                        <span className="font-semibold text-fg-2">
                          {Math.round(
                            (customSettings.upscaling?.sharpening ?? 0.3) * 100,
                          )}
                          %
                        </span>
                        <span>Max</span>
                      </div>
                    </div>

                    <p className="rounded-md bg-bg-2 px-3 py-2 text-[10px] leading-4 text-fg-muted">
                      Best used when exporting above the project resolution. It
                      adds processing time.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </TabsContent>

          <TabsContent
            value="stills"
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-5 data-[state=inactive]:hidden"
          >
            <ExportStillPanel
              range={exportSection === "range" && validMarkedRange ? { startTime: validMarkedRange.startTime, endTime: validMarkedRange.endTime } : undefined}
              onDone={onClose}
            />
          </TabsContent>

          {deviceProfile && (
            <Collapsible
              open={showDeviceInfo}
              onOpenChange={setShowDeviceInfo}
              className="export-device-estimate shrink-0 border-t border-border bg-bg-1 px-5 py-2.5"
            >
              <div className="export-device-estimate-row flex items-center justify-between gap-4">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-7 text-[11px] text-fg-muted [&_svg]:size-3"
                    type="button"
                    aria-label="Show device export estimate details"
                  >
                    <Cpu size={12} />
                    <span>{formatDeviceSummary(deviceProfile)}</span>
                    <Info size={10} className="text-fg-muted" />
                  </Button>
                </CollapsibleTrigger>

                {timeEstimate && (
                  <div className="export-estimate-actions flex items-center gap-3">
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
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[10px] text-accent [&_svg]:size-3"
                          onClick={handleRunBenchmark}
                          type="button"
                          aria-label="Get accurate estimate"
                        >
                          <Zap size={10} />
                          Get accurate estimate
                        </Button>
                      )}

                    {isBenchmarking && !benchmarkProgress && (
                      <span role="status" className="text-[10px] text-fg-muted">
                        Benchmark in progress…
                      </span>
                    )}
                    {isBenchmarking && benchmarkProgress && (
                      <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                        <Progress
                          aria-label="Export benchmark progress"
                          value={benchmarkProgress.progress * 100}
                          className="h-1 w-16"
                        />
                        <span>Testing...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <CollapsibleContent className="mt-2 grid grid-cols-3 gap-4 rounded-lg bg-bg-2 px-3 py-2.5 text-[10px]">
                <div>
                  <span className="text-fg-muted">CPU</span>
                  <span className="text-[12px] leading-5 font-bold block text-fg">
                    {deviceProfile.cpu.cores} cores
                  </span>
                </div>
                <div>
                  <span className="text-fg-muted">GPU</span>
                  <span className="text-[12px] leading-5 font-bold block truncate text-fg">
                    {deviceProfile.gpu.renderer !== "Unknown"
                      ? deviceProfile.gpu.renderer
                          .replace(/ANGLE \(|, .*\)/g, "")
                          .replace(/Direct3D11.*$/g, "")
                          .trim()
                      : "Unknown"}
                  </span>
                  <span className="text-fg-2 font-normal block text-[9px]">
                    {deviceProfile.gpu.hasHardwareEncoding
                      ? "HW Encode"
                      : "Software only"}
                  </span>
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
              </CollapsibleContent>
            </Collapsible>
          )}
        </Tabs>
        <DialogFooter className="export-dialog-footer flex-col items-stretch gap-2 border-t border-border px-5 py-3 sm:flex-col sm:items-stretch sm:space-x-0">
          {!isDesktop && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="export-save-video"
                  className="text-[11px] text-fg-2"
                >
                  Save video
                </Label>
                <Select
                  value={delivery}
                  onValueChange={(value) =>
                    setDelivery(value as ExportDeliveryMode)
                  }
                >
                  <SelectTrigger
                    id="export-save-video"
                    className="h-8 w-[220px] text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      { value: "download", label: "Download to this device" },
                      { value: "file", label: "Choose a file location" },
                    ].map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="text-xs"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="min-w-0 flex-1 text-[11px] text-fg-muted">
                Choose a file location to stream large exports straight to disk.
              </p>
            </div>
          )}
          {!isDesktop && (checkingCapability || capabilityError) && (
            <p role="status" className="text-[11px] text-fg-muted">
              {checkingCapability
                ? "Checking this browser’s encoder support…"
                : "Choose another format to export in this browser."}
            </p>
          )}
          {capabilityError && (
            <Alert
              role="alert"
              className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning"
            >
              {capabilityError}
            </Alert>
          )}
          {validationError && (
            <Alert
              role="alert"
              className="rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning"
            >
              {validationError}
            </Alert>
          )}
          {webExportAdjustment?.wasAdjusted && (
            <Alert
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
            </Alert>
          )}
          {guardrailActive && (
            <Alert
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
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setH264FallbackAcknowledged(true)}
                    type="button"
                    aria-label="Export as H.264 anyway"
                  >
                    <span className="truncate">{"Export as H.264 anyway"}</span>
                  </Button>
                </div>
              )}
            </Alert>
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
                      : activeTab === "presets" && selectedPreset && "width" in selectedPreset.settings
                        ? formatEstimatedSize(estimatePresetBytes(selectedPreset.settings as VideoExportSettings, duration)).replace("~", "")
                        : formatFileSize(
                          activeTab === "presets" && selectedPreset
                            ? (selectedPreset.settings as VideoExportSettings)
                                .bitrate || 8000
                            : customSettings.bitrate,
                          duration,
                        )}
                  </div>
                  <UsePreviewsToggle
                    checked={usePreviews}
                    onCheckedChange={setUsePreviews}
                    settings={effectiveSettings}
                    projectWidth={projectWidth}
                    projectHeight={projectHeight}
                  />
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
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-fg-2"
                onClick={onClose}
                type="button"
                aria-label="Cancel"
              >
                <span className="truncate">{"Cancel"}</span>
              </Button>
              {onAddToQueue && activeTab !== "stills" && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleAddToQueue}
                  type="button"
                  aria-label="Add to queue"
                  disabled={exportDisabled}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <ListPlus size={16} aria-hidden />
                  </span>
                  <span className="truncate">Add to queue</span>
                </Button>
              )}
              {activeTab !== "stills" && <Button
                variant="default"
                size="sm"
                className="h-8 text-xs"
                onClick={handleExport}
                type="button"
                aria-label={
                  (activeTab === "reduce"
                    ? "Compress & Export"
                    : "Export Video"
                  ).trim() || undefined
                }
                disabled={exportDisabled}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {activeTab === "reduce" ? (
                    <Minimize2 size={16} aria-hidden />
                  ) : (
                    <Play size={16} aria-hidden />
                  )}
                </span>
                <span className="truncate">
                  {activeTab === "reduce"
                    ? "Compress & Export"
                    : "Export Video"}
                </span>
              </Button>}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
