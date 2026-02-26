import React, { useCallback, useState, useEffect } from "react";
import {
  Search,
  Command,
  ChevronDown,
  FileVideo,
  Film,
  Music,
  Sun,
  Moon,
  SunMoon,
  Loader2,
  X,
  Check,
  FileCode,
  Settings,
  Zap,
  Circle,
  History,
  HelpCircle,
  Diamond,
  Sparkles,
  Play,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { useRouter } from "../../hooks/use-router";
import {
  getExportEngine,
  getDeviceProfile,
  estimateExportTime,
  type VideoExportSettings,
  type AudioExportSettings,
  type ExportResult,
  type DeviceProfile,
  type TimeEstimate,
} from "@openreel/core";
import { ExportDialog } from "./ExportDialog";
import { ScreenRecorder } from "./ScreenRecorder";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { toast } from "../../stores/notification-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import { startTour, ONBOARDING_KEY, startMoGraphTour, MOGRAPH_TOUR_KEY } from "./tour";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@openreel/ui";

type ExportType =
  | "mp4"
  | "prores"
  | "gif"
  | "wav"
  | "4k-master"
  | "4k-prores"
  | "4k"
  | "1080p-high"
  | "4k-60-master"
  | "1080p-60"
  | "project";

interface ExportState {
  isExporting: boolean;
  progress: number;
  phase: string;
  error: string | null;
  complete: boolean;
}

export const Toolbar: React.FC = () => {
  const { project } = useProjectStore();
  const {
    openModal,
    selectedItems,
    setExportState: setGlobalExportState,
    keyframeEditorOpen,
    toggleKeyframeEditor,
    panels,
    togglePanel,
  } = useUIStore();
  const { mode: themeMode, toggleTheme } = useThemeStore();
  const { navigate } = useRouter();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { importMedia } = useProjectStore();
  const { track } = useAnalytics();

  const handleStartTour = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    startTour();
  }, []);

  const handleStartMoGraphTour = useCallback(() => {
    localStorage.removeItem(MOGRAPH_TOUR_KEY);
    startMoGraphTour();
  }, []);

  const hasSelectedClip = selectedItems.some(
    (item) =>
      item.type === "clip" ||
      item.type === "text-clip" ||
      item.type === "shape-clip",
  );
  const [exportState, setExportState] = useState<ExportState>({
    isExporting: false,
    progress: 0,
    phase: "",
    error: null,
    complete: false,
  });
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [exportEstimates, setExportEstimates] = useState<Map<string, TimeEstimate>>(new Map());

  useEffect(() => {
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
    });
  }, [exportState.isExporting, exportState.progress, exportState.phase, setGlobalExportState]);

  useEffect(() => {
    if (isExportOpen && !deviceProfile) {
      getDeviceProfile().then(setDeviceProfile);
    }
  }, [isExportOpen, deviceProfile]);

  useEffect(() => {
    if (!deviceProfile || !project.timeline?.duration) {
      return;
    }

    const duration = project.timeline.duration;
    const estimates = new Map<string, TimeEstimate>();

    const configs: Array<{ key: string; width: number; height: number; frameRate: number; codec: "h264" | "h265" | "vp9" | "av1" }> = [
      { key: "mp4", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
      { key: "4k", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "4k-60-master", width: 3840, height: 2160, frameRate: 60, codec: "h264" },
      { key: "4k-master", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "1080p-high", width: 1920, height: 1080, frameRate: 30, codec: "h264" },
      { key: "1080p-60", width: 1920, height: 1080, frameRate: 60, codec: "h264" },
      { key: "prores", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
    ];

    for (const config of configs) {
      const estimate = estimateExportTime(deviceProfile, {
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        duration,
        codec: config.codec,
      });
      estimates.set(config.key, estimate);
    }

    setExportEstimates(estimates);
  }, [deviceProfile, project.timeline?.duration, project.settings.width, project.settings.height]);

  const handleSearch = useCallback(() => {
    openModal("search");
  }, [openModal]);

  const runExport = useCallback(
    async (videoSettings: Partial<VideoExportSettings>, _ext: string, writableStream: FileSystemWritableFileStream) => {
      const engine = getExportEngine();
      await engine.initialize();

      const generator = engine.exportVideo(project, videoSettings, writableStream);
      let finalResult: ExportResult | undefined;

      while (true) {
        const { value, done } = await generator.next();
        if (done) {
          finalResult = value;
          break;
        }
        setExportState((prev) => ({
          ...prev,
          progress: value.progress * 100,
          phase: value.phase === "complete" ? "Complete!" : `${value.phase}...`,
        }));
      }

      if (finalResult?.success) {
        setExportState((prev) => ({ ...prev, complete: true, phase: "Saved!" }));
        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: videoSettings.format ?? "mp4",
          codec: videoSettings.codec ?? "h264",
          width: videoSettings.width ?? project.settings.width,
          height: videoSettings.height ?? project.settings.height,
          frameRate: videoSettings.frameRate ?? project.settings.frameRate,
          duration: project.timeline?.duration ?? 0,
        });
      } else {
        throw new Error(finalResult?.error?.message || "Export failed");
      }
    },
    [project, track],
  );

  const showSavePicker = useCallback(async (filename: string, ext: string): Promise<FileSystemWritableFileStream> => {
    const mimeMap: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      wav: "audio/wav",
    };
    const handle = await (window as unknown as {
      showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: "Media file",
        accept: { [mimeMap[ext] || "application/octet-stream"]: [`.${ext}`] },
      }],
    });
    return handle.createWritable();
  }, []);

  const handleExport = useCallback(
    async (type: ExportType) => {
      setIsExportOpen(false);

      try {
        if (type === "wav") {
          const writable = await showSavePicker(`${project.name || "export"}.wav`, "wav");

          setExportState({
            isExporting: true,
            progress: 0,
            phase: "Initializing...",
            error: null,
            complete: false,
          });

          const engine = getExportEngine();
          await engine.initialize();

          const audioSettings: Partial<AudioExportSettings> = {
            format: "wav",
            sampleRate: 48000,
            channels: 2,
            bitDepth: 24,
          };

          const generator = engine.exportAudio(project, audioSettings);
          let finalResult: ExportResult | undefined;

          while (true) {
            const { value, done } = await generator.next();
            if (done) {
              finalResult = value;
              break;
            }
            setExportState((prev) => ({
              ...prev,
              progress: value.progress * 100,
              phase: value.phase === "complete" ? "Complete!" : `${value.phase}...`,
            }));
          }

          if (finalResult?.success && finalResult.blob) {
            await finalResult.blob.stream().pipeTo(writable as unknown as WritableStream<Uint8Array>);
            setExportState((prev) => ({ ...prev, complete: true, phase: "Saved!" }));
            track(AnalyticsEvents.PROJECT_EXPORTED, {
              format: "wav",
              duration: project.timeline?.duration ?? 0,
            });
          } else {
            try { await writable.abort(); } catch {}
            throw new Error(finalResult?.error?.message || "Export failed");
          }
        } else {
          const base = {
            width: project.settings.width,
            height: project.settings.height,
            frameRate: project.settings.frameRate,
          };

          const presets: Record<string, { settings: Partial<VideoExportSettings>; ext: string }> = {
            mp4: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            gif: { settings: { ...base, format: "webm", codec: "vp9", bitrate: 8000 }, ext: "webm" },
            project: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            "4k-60-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 60, format: "mov", codec: "h265", bitrate: 100000, quality: 95 }, ext: "mov" },
            "4k-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "h265", bitrate: 80000, quality: 95 }, ext: "mov" },
            "4k-prores": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "prores", bitrate: 880000, quality: 100 }, ext: "mov" },
            "4k": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mp4", codec: "h264", bitrate: 50000, quality: 90 }, ext: "mp4" },
            "1080p-60": { settings: { ...base, width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 25000, quality: 95 }, ext: "mp4" },
            "1080p-high": { settings: { ...base, width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000, quality: 95 }, ext: "mp4" },
            prores: { settings: { ...base, format: "mov", codec: "prores", bitrate: 220000, quality: 100 }, ext: "mov" },
          };

          const preset = presets[type] ?? presets.mp4;
          const writable = await showSavePicker(`${project.name || "export"}.${preset.ext}`, preset.ext);

          setExportState({
            isExporting: true,
            progress: 0,
            phase: "Initializing...",
            error: null,
            complete: false,
          });

          await runExport(preset.settings, preset.ext, writable);
        }

        setTimeout(() => {
          setExportState({ isExporting: false, progress: 0, phase: "", error: null, complete: false });
        }, 2000);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setExportState((prev) => ({
          ...prev,
          isExporting: false,
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    [project, track, runExport, showSavePicker],
  );

  const handleCancelExport = useCallback(() => {
    const engine = getExportEngine();
    engine.cancel();
    setExportState({
      isExporting: false,
      progress: 0,
      phase: "",
      error: null,
      complete: false,
    });
  }, []);

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings) => {
      setIsExportDialogOpen(false);

      try {
        const ext = settings.format === "mov" ? "mov" : settings.format === "webm" ? "webm" : "mp4";
        const writable = await showSavePicker(`${project.name || "export"}.${ext}`, ext);

        setExportState({
          isExporting: true,
          progress: 0,
          phase: "Initializing...",
          error: null,
          complete: false,
        });

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        await runExport(exportSettings, ext, writable);

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        setTimeout(() => {
          setExportState({ isExporting: false, progress: 0, phase: "", error: null, complete: false });
        }, 2000);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setExportState((prev) => ({
          ...prev,
          isExporting: false,
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    [project, track, runExport, showSavePicker],
  );


  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          "Recording failed",
          "No video data was captured. Please try again.",
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importMedia(screenFile);
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || "Failed to import screen recording",
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importMedia(webcamFile);
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || "Failed to import webcam recording",
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          `${importCount} recording${importCount > 1 ? "s" : ""} imported!`,
          webcamBlob && webcamBlob.size > 0
            ? "Screen and webcam added to assets. Use the timeline to composite them."
            : "Screen recording added to assets.",
        );
      } else if (errors.length > 0) {
        toast.error("Import failed", errors.join(". "));
      }
    },
    [importMedia],
  );

  const projectRes = `${project.settings.width}×${project.settings.height}`;
  const aspectRatio = project.settings.width / project.settings.height;
  const isVertical = aspectRatio < 0.9;

  const exportOptions: Array<{
    label: string;
    icon: typeof FileVideo;
    desc: string;
    type: ExportType;
    recommended?: boolean;
    separator?: boolean;
  }> = [
    {
      label: "MP4 Standard",
      icon: Zap,
      desc: `${projectRes} H.264 - Web & social`,
      type: "mp4",
      recommended: true,
    },
    {
      label: "",
      icon: Film,
      desc: "",
      type: "mp4",
      separator: true,
    },
    ...(isVertical
      ? []
      : [
          {
            label: "4K Standard",
            icon: FileVideo,
            desc: "3840×2160 - YouTube 4K",
            type: "4k" as ExportType,
          },
        ]),
    {
      label: "1080p High Quality",
      icon: FileVideo,
      desc: "1920×1080 30fps - High bitrate",
      type: "1080p-high",
    },
    {
      label: "1080p 60fps",
      icon: FileVideo,
      desc: "1920×1080 - Smooth playback",
      type: "1080p-60",
    },
    {
      label: "Audio Only (WAV)",
      icon: Music,
      desc: "Uncompressed audio",
      type: "wav",
    },
  ];

  return (
    <div className="h-16 border-b border-border flex items-center px-6 justify-between bg-background shrink-0 z-30 relative">
      <div className="flex items-center gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate("welcome")}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
              title="Back to Home"
            >
              <div className="w-8 h-8 group">
                <svg
                  viewBox="0 0 490 490"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full text-primary group-hover:scale-110 transition-transform duration-300"
                >
                  <path
                    d="M245 24.5C123.223 24.5 24.5 123.223 24.5 245s98.723 220.5 220.5 220.5 220.5-98.723 220.5-220.5S366.777 24.5 245 24.5Z"
                    stroke="currentColor"
                    strokeWidth="30.625"
                    className="opacity-100"
                  />
                  <g className="origin-center group-hover:rotate-90 transition-transform duration-500 ease-out">
                    <path
                      d="M245 98v73.5"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M392 245h-73.5"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M245 392v-73.5"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M98 245h73.5"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="m348.941 141.059-51.965 51.965"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="m348.941 348.941-51.965-51.965"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="m141.059 348.941 51.965-51.965"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="m141.059 141.059 51.965 51.965"
                      stroke="currentColor"
                      strokeWidth="24.5"
                      strokeLinecap="round"
                    />
                  </g>
                  <path
                    d="M294 245a49 49 0 0 1-49 49 49 49 0 0 1-49-49 49 49 0 0 1 98 0"
                    fill="currentColor"
                    className="group-hover:fill-white transition-colors duration-300"
                  />
                </svg>
              </div>
              <span className="text-lg font-medium text-text-primary tracking-wide hidden lg:block">
                Open Reel
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Back to Home</TooltipContent>
        </Tooltip>
        <div className="h-6 w-px bg-border hidden md:block" />
        <ProjectSwitcher />
      </div>

      <div className="flex-1 max-w-2xl mx-12 relative group">
        <div
          className={`absolute inset-0 bg-primary/20 rounded-xl blur-md transition-opacity duration-300 ${
            hasSelectedClip
              ? "opacity-100 animate-pulse"
              : "opacity-0 group-hover:opacity-100"
          }`}
        />
        <button
          onClick={handleSearch}
          className={`relative w-full bg-background-secondary border rounded-xl h-10 flex items-center px-4 gap-3 transition-all text-left shadow-inner ${
            hasSelectedClip
              ? "border-primary/50 ring-1 ring-primary/30"
              : "border-border group-hover:border-primary/50"
          }`}
        >
          <Search
            size={16}
            className={`transition-colors ${
              hasSelectedClip
                ? "text-primary"
                : "text-text-muted group-hover:text-primary"
            }`}
          />
          <span
            className={`flex-1 text-sm transition-colors ${
              hasSelectedClip
                ? "text-text-secondary"
                : "text-text-muted group-hover:text-text-secondary"
            }`}
          >
            {hasSelectedClip
              ? "Search effects for selected clip..."
              : "Search tools, effects, or ask AI..."}
          </span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-background-tertiary">
            <Command size={10} className="text-text-muted" />
            <span className="text-[10px] text-text-muted font-mono">K</span>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 rounded-lg hover:bg-background-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              <HelpCircle size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={handleStartTour} className="gap-2">
              <Play size={14} />
              <span>Editor Tour</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleStartMoGraphTour} className="gap-2">
              <Sparkles size={14} className="text-purple-400" />
              <span>Animation & Effects Tour</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-text-muted">
              <Command size={14} />
              <span>Press ? for shortcuts</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-background-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              {themeMode === "light" ? (
                <Sun size={16} />
              ) : themeMode === "dark" ? (
                <Moon size={16} />
              ) : (
                <SunMoon size={16} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Theme: {themeMode}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => useUIStore.getState().openModal("scriptView")}
              className="p-2 rounded-lg hover:bg-background-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              <FileCode size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Project JSON - Export/Import</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleKeyframeEditor}
              className={`p-2 rounded-lg transition-colors ${
                keyframeEditorOpen
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-background-elevated text-text-secondary hover:text-text-primary"
              }`}
            >
              <Diamond size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Keyframe Editor</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => togglePanel("audioMixer")}
              className={`p-2 rounded-lg transition-colors ${
                panels.audioMixer?.visible
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-background-elevated text-text-secondary hover:text-text-primary"
              }`}
            >
              <Music size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Audio Mixer – track volume and master level</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className={`p-2 rounded-lg transition-colors ${
                isHistoryOpen
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-background-elevated text-text-secondary hover:text-text-primary"
              }`}
            >
              <History size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>History - Undo/Redo</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsRecorderOpen(true)}
              className="flex items-center gap-2 px-3 py-2 bg-error/10 hover:bg-error/20 text-error rounded-lg transition-colors"
            >
              <Circle size={14} className="fill-current" />
              <span className="text-sm font-medium">Record</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Screen Recording</p>
          </TooltipContent>
        </Tooltip>

        <div className="relative">
          {exportState.isExporting ? (
            <div className="h-10 px-4 bg-background-secondary border border-border rounded-lg flex items-center gap-3 min-w-[200px]">
              <Loader2 size={14} className="text-primary animate-spin" />
              <div className="flex-1">
                <div className="text-[10px] text-text-secondary">
                  {exportState.phase}
                </div>
                <div className="h-1 bg-background-tertiary rounded-full mt-1 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${exportState.progress}%` }}
                  />
                </div>
              </div>
              <button
                onClick={handleCancelExport}
                className="p-1 hover:bg-background-tertiary rounded text-text-muted hover:text-error transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : exportState.error ? (
            <div className="h-10 px-4 bg-error/10 border border-error/30 rounded-lg flex items-center gap-2">
              <span className="text-xs text-error">{exportState.error}</span>
              <button
                onClick={() =>
                  setExportState((prev) => ({ ...prev, error: null }))
                }
                className="p-1 hover:bg-error/20 rounded text-error transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          ) : exportState.complete ? (
            <div className="h-10 px-4 bg-primary/10 border border-primary/30 rounded-lg flex items-center gap-2">
              <Check size={14} className="text-primary" />
              <span className="text-xs text-primary">Downloaded!</span>
            </div>
          ) : (
            <DropdownMenu open={isExportOpen} onOpenChange={setIsExportOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className={`h-10 px-4 bg-primary hover:bg-primary-hover active:bg-primary-active text-white font-bold rounded-lg flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transform hover:-translate-y-0.5 ${
                    isExportOpen ? "translate-y-0 shadow-none" : ""
                  }`}
                >
                  <span className="text-sm tracking-wider">EXPORT</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      isExportOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-0 rounded-xl bg-background-secondary border-border">
                <div className="p-3 space-y-1 max-h-[400px] overflow-y-auto">
                  {exportOptions.map((option, index) =>
                    option.separator ? (
                      <DropdownMenuSeparator key={`sep-${index}`} />
                    ) : (
                      <DropdownMenuItem
                        key={option.type + index}
                        className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                          option.recommended
                            ? "bg-primary/10 hover:bg-primary/20 border border-primary/30"
                            : ""
                        }`}
                        onClick={() => handleExport(option.type)}
                      >
                        <div
                          className={`p-2 rounded-lg transition-colors ${
                            option.recommended
                              ? "bg-primary/20 text-primary"
                              : "bg-background-tertiary group-hover:bg-background-elevated text-text-secondary group-hover:text-primary"
                          }`}
                        >
                          <option.icon size={18} />
                        </div>
                        <div className="flex-1">
                          <div
                            className={`text-sm font-medium transition-colors ${
                              option.recommended
                                ? "text-primary"
                                : "text-text-primary"
                            }`}
                          >
                            {option.label}
                            {option.recommended && (
                              <span className="ml-2 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                                Best Match
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-text-muted mt-0.5">
                            {option.desc}
                          </div>
                          {exportEstimates.get(option.type) && (
                            <div className="text-[10px] text-text-secondary mt-1">
                              Est. {exportEstimates.get(option.type)?.formatted}
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ),
                  )}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer"
                    onClick={() => setIsExportDialogOpen(true)}
                  >
                    <div className="p-2 bg-primary/10 rounded-lg text-primary transition-colors">
                      <Settings size={18} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-primary transition-colors">
                        Custom Export...
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        Full settings with AI upscaling
                      </div>
                    </div>
                    <Settings
                      size={14}
                      className="text-text-muted"
                    />
                  </DropdownMenuItem>
                </div>
                <div className="bg-background-tertiary px-3 py-2.5 text-xs text-center text-text-muted border-t border-border">
                  {project.settings.width}×{project.settings.height} •{" "}
                  {project.settings.frameRate}fps
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleCustomExport}
        duration={project.timeline?.duration ?? 0}
        projectWidth={project.settings?.width ?? 1920}
        projectHeight={project.settings?.height ?? 1080}
      />

      <ScreenRecorder
        isOpen={isRecorderOpen}
        onClose={() => setIsRecorderOpen(false)}
        onRecordingComplete={handleRecordingComplete}
      />

      {isHistoryOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setIsHistoryOpen(false)}
          />
          <div className="fixed top-16 right-0 bottom-0 w-80 bg-background-secondary border-l border-border z-50 shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="text-sm font-medium text-text-primary">Action History</span>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="h-[calc(100%-49px)]">
              <HistoryPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Toolbar;
