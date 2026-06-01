import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
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
  Undo2,
  Redo2,
  MessageSquare,
  Star,
  Upload,
  MoreHorizontal,
  Command,
  Search,
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
import { SettingsDialog } from "./settings/SettingsDialog";
import { toast } from "../../stores/notification-store";
import { useSettingsStore } from "../../stores/settings-store";
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
  const { project, undo, redo, renameProject } = useProjectStore();
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
  const { openSettings } = useSettingsStore();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { importMedia } = useProjectStore();
  const { track } = useAnalytics();

  // Local editable project name (committed onBlur / Enter)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  useEffect(() => {
    setProjectNameDraft(project.name);
  }, [project.name]);

  // Autosave timestamp from the project's modifiedAt date.
  const autosaveLabel = useMemo(() => {
    const ts = project.modifiedAt ?? Date.now();
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }, [project.modifiedAt]);

  const commitProjectName = useCallback(() => {
    const next = projectNameDraft.trim();
    if (next && next !== project.name) {
      void renameProject(next);
    } else {
      setProjectNameDraft(project.name);
    }
  }, [projectNameDraft, project.name, renameProject]);

  const handleUndo = useCallback(() => {
    void undo();
  }, [undo]);
  const handleRedo = useCallback(() => {
    void redo();
  }, [redo]);

  const handleStartTour = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    startTour();
  }, []);

  const handleStartMoGraphTour = useCallback(() => {
    localStorage.removeItem(MOGRAPH_TOUR_KEY);
    startMoGraphTour();
  }, []);

  // selectedItems drives related UX in the editor (e.g. inspector context).
  // Kept on the destructure list so future tweaks don't have to rewire it.
  void selectedItems;

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
    const mime = mimeMap[ext] || "application/octet-stream";

    if ("showSaveFilePicker" in window) {
      const handle = await (window as unknown as {
        showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Media file",
          accept: { [mime]: [`.${ext}`] },
        }],
      });
      return handle.createWritable();
    }

    let buffer = new Uint8Array(16 * 1024 * 1024);
    let length = 0;
    let cursor = 0;

    const grow = (needed: number) => {
      if (needed <= buffer.length) return;
      let newSize = buffer.length;
      while (newSize < needed) newSize *= 2;
      const next = new Uint8Array(newSize);
      next.set(buffer.subarray(0, length));
      buffer = next;
    };

    const triggerDownload = () => {
      const blob = new Blob([buffer.slice(0, length)], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const writeBytes = (bytes: Uint8Array, position: number) => {
      const end = position + bytes.byteLength;
      grow(end);
      buffer.set(bytes, position);
      if (end > length) length = end;
      cursor = end;
    };

    return {
      seek(position: number) {
        cursor = position;
        return Promise.resolve();
      },
      write(data: unknown) {
        if (data instanceof ArrayBuffer) {
          writeBytes(new Uint8Array(data), cursor);
        } else if (ArrayBuffer.isView(data)) {
          writeBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), cursor);
        }
        return Promise.resolve();
      },
      close() {
        triggerDownload();
        return Promise.resolve();
      },
      abort() {
        return Promise.resolve();
      },
      truncate() {
        return Promise.resolve();
      },
    } as unknown as FileSystemWritableFileStream;
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
            if ("showSaveFilePicker" in window) {
              await finalResult.blob.stream().pipeTo(writable as unknown as WritableStream<Uint8Array>);
            } else {
              const url = URL.createObjectURL(finalResult.blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${project.name || "export"}.wav`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }
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
    <header className="h-topbar grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 px-3 bg-bg border-b border-border shrink-0 z-30 relative">
      {/* ─── Left: window dots + autosave ─────────────────────── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate("welcome")}
          className="flex items-center gap-1.5 pr-1.5"
          title="Back to home"
        >
          <span className="w-[11px] h-[11px] rounded-full bg-[oklch(0.7_0.18_25)]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[oklch(0.78_0.14_80)]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[oklch(0.7_0.15_145)]" />
        </button>

        <span className="text-[11px] text-fg-3 flex items-center gap-1.5">
          <span className="w-[5px] h-[5px] rounded-full bg-accent" />
          {exportState.isExporting
            ? `Exporting… ${Math.round(exportState.progress)}%`
            : `Auto saved: ${autosaveLabel}`}
        </span>
      </div>

      {/* ─── Center: project name ────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium tracking-tight">
        <input
          value={projectNameDraft}
          onChange={(e) => setProjectNameDraft(e.target.value)}
          onBlur={commitProjectName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setProjectNameDraft(project.name);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          size={Math.max(projectNameDraft.length, 6)}
          spellCheck={false}
          className="bg-transparent border-0 text-center font-medium text-[12.5px] tracking-tight text-fg px-2 py-0.5 rounded min-w-[60px] focus:bg-bg-2 focus:outline-none"
        />
        <ProjectSwitcher />
      </div>

      {/* ─── Right: undo/redo, history, comments, pro, export ── */}
      <div className="flex items-center justify-end gap-1.5">
        {/* Quick search (preserved from existing flow) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => openModal("search")}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
              data-tip="Search (⌘K)"
            >
              <Search size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Search tools, effects, or ask AI… (⌘K)</TooltipContent>
        </Tooltip>

        {/* Undo / Redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleUndo}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <Undo2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Undo (⌘Z)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleRedo}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <Redo2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
        </Tooltip>

        <div className="w-px h-4 bg-border mx-1" />

        {/* History */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsHistoryOpen((v) => !v)}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                isHistoryOpen
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <History size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Action history</TooltipContent>
        </Tooltip>

        {/* Keyframe editor (moved here from old toolbar) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleKeyframeEditor}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                keyframeEditorOpen
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <Diamond size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Keyframe editor</TooltipContent>
        </Tooltip>

        {/* Audio mixer (moved) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => togglePanel("audioMixer")}
              className={`w-[26px] h-[26px] grid place-items-center rounded-md transition-colors ${
                panels.audioMixer?.visible
                  ? "bg-accent-soft text-accent"
                  : "text-fg-2 hover:bg-hover hover:text-fg"
              }`}
            >
              <Music size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Audio mixer</TooltipContent>
        </Tooltip>

        {/* Comments placeholder (matches mockup) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => useUIStore.getState().openModal("scriptView")}
              className="w-[26px] h-[26px] grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <MessageSquare size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Project JSON / Comments</TooltipContent>
        </Tooltip>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Pro pill — opens more menu (theme, settings, tours, recorder) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-fg-2 hover:bg-hover hover:text-fg transition-colors"
            >
              <Star size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={toggleTheme} className="gap-2">
              {themeMode === "light" ? <Sun size={14} /> : themeMode === "dark" ? <Moon size={14} /> : <SunMoon size={14} />}
              <span className="flex-1">Theme: {themeMode}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openSettings()} className="gap-2">
              <Settings size={14} />
              <span>Settings & API keys</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIsRecorderOpen(true)} className="gap-2">
              <Circle size={14} className="fill-current text-status-error" />
              <span>Screen recorder</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleStartTour} className="gap-2">
              <Play size={14} />
              <span>Editor tour</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleStartMoGraphTour} className="gap-2">
              <Sparkles size={14} className="text-purple-400" />
              <span>Animation & effects tour</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-fg-muted">
              <HelpCircle size={14} />
              <span>Help & shortcuts (press ?)</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-fg-muted">
              <FileCode size={14} />
              <span>Project JSON</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-fg-muted">
              <Command size={14} />
              <span>⌘K to search</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Export */}
        {exportState.isExporting ? (
          <div className="relative">
            <button
              onClick={handleCancelExport}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent-soft text-accent text-[12.5px] font-semibold"
            >
              <Loader2 size={13} className="animate-spin" />
              <span>{Math.round(exportState.progress)}%</span>
              <X size={11} className="ml-1 opacity-70" />
            </button>
          </div>
        ) : exportState.error ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-status-error/40 bg-status-error/10 text-status-error text-[11px]">
            <span className="max-w-[180px] truncate">{exportState.error}</span>
            <button
              onClick={() => setExportState((p) => ({ ...p, error: null }))}
              className="opacity-70 hover:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        ) : exportState.complete ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent-soft text-accent text-[12.5px]">
            <Check size={13} />
            <span className="font-medium">Saved!</span>
          </div>
        ) : (
          <DropdownMenu open={isExportOpen} onOpenChange={setIsExportOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className="relative inline-flex items-center gap-1.5 px-3.5 py-[5px] rounded-md bg-accent text-accent-fg font-semibold text-[12.5px] shadow-glow hover:bg-accent-strong transition-colors"
              >
                <Upload size={13} />
                <span>Export</span>
                <ChevronDown size={12} className={`transition-transform ${isExportOpen ? "rotate-180" : ""}`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-0 rounded-xl bg-bg-1 border-border">
              <div className="p-3 space-y-1 max-h-[400px] overflow-y-auto">
                {exportOptions.map((option, index) =>
                  option.separator ? (
                    <DropdownMenuSeparator key={`sep-${index}`} />
                  ) : (
                    <DropdownMenuItem
                      key={option.type + index}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-hover focus:bg-hover ${
                        option.recommended ? "bg-accent-soft" : ""
                      }`}
                      onClick={() => handleExport(option.type)}
                    >
                      <div
                        className={`p-2 rounded-lg transition-colors ${
                          option.recommended
                            ? "bg-accent-soft text-accent"
                            : "bg-bg-2 text-fg-2"
                        }`}
                      >
                        <option.icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-sm font-medium ${
                            option.recommended ? "text-accent" : "text-fg"
                          }`}
                        >
                          {option.label}
                          {option.recommended && (
                            <span className="ml-2 text-[10px] bg-accent-soft text-accent px-1.5 py-0.5 rounded">
                              Best match
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-fg-muted mt-0.5">
                          {option.desc}
                        </div>
                        {exportEstimates.get(option.type) && (
                          <div className="text-[10px] text-fg-3 mt-1">
                            Est. {exportEstimates.get(option.type)?.formatted}
                          </div>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ),
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-hover focus:bg-hover"
                  onClick={() => setIsExportDialogOpen(true)}
                >
                  <div className="p-2 bg-accent-soft rounded-lg text-accent">
                    <Settings size={18} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-accent">
                      Custom export…
                    </div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      Full settings with AI upscaling
                    </div>
                  </div>
                  <MoreHorizontal size={14} className="text-fg-muted" />
                </DropdownMenuItem>
              </div>
              <div className="bg-bg-2 px-3 py-2.5 text-xs text-center text-fg-muted border-t border-border">
                {project.settings.width}×{project.settings.height} •{" "}
                {project.settings.frameRate}fps
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* ─── Auxiliary popups & dialogs ───────────────────────── */}
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

      <SettingsDialog />

      {isHistoryOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setIsHistoryOpen(false)}
          />
          <div className="fixed top-topbar right-0 bottom-0 w-80 bg-bg-1 border-l border-border z-50 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="text-sm font-medium text-fg">Action history</span>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="p-1.5 rounded hover:bg-hover text-fg-3 hover:text-fg transition-colors"
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
    </header>
  );
};

export default Toolbar;
