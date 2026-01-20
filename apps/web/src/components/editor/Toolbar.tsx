import React, { useCallback, useState, useRef, useEffect } from "react";
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
  Sparkles,
  Circle,
  History,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import {
  getExportEngine,
  downloadBlob,
  type VideoExportSettings,
  type AudioExportSettings,
  type ExportResult,
} from "@openreel/core";
import { ExportDialog } from "./ExportDialog";
import { ScreenRecorder } from "./ScreenRecorder";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { toast } from "../../stores/notification-store";

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
  const { openModal, selectedItems } = useUIStore();
  const { mode: themeMode, toggleTheme } = useThemeStore();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { importMedia } = useProjectStore();

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
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback(() => {
    openModal("search");
  }, [openModal]);

  const handleExport = useCallback(
    async (type: ExportType) => {
      setIsExportOpen(false);
      setExportState({
        isExporting: true,
        progress: 0,
        phase: "Initializing...",
        error: null,
        complete: false,
      });

      try {
        const engine = getExportEngine();
        await engine.initialize();

        if (type === "wav") {
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
              phase:
                value.phase === "complete" ? "Complete!" : `${value.phase}...`,
            }));
          }

          if (finalResult?.success && finalResult.blob) {
            downloadBlob(finalResult.blob, `${project.name || "export"}.wav`);
            setExportState((prev) => ({
              ...prev,
              complete: true,
              phase: "Downloaded!",
            }));
          } else {
            throw new Error(finalResult?.error?.message || "Export failed");
          }
        } else {
          const getExportSettings = (): Partial<VideoExportSettings> => {
            const base = {
              width: project.settings.width,
              height: project.settings.height,
              frameRate: project.settings.frameRate,
            };

            switch (type) {
              case "project":
                return {
                  ...base,
                  format: "mov",
                  codec: "prores",
                  bitrate: 220000,
                  quality: 100,
                };
              case "4k-60-master":
                return {
                  ...base,
                  width: 3840,
                  height: 2160,
                  frameRate: 60,
                  format: "mov",
                  codec: "h265",
                  bitrate: 100000,
                  quality: 95,
                };
              case "4k-master":
                return {
                  ...base,
                  width: 3840,
                  height: 2160,
                  frameRate: 30,
                  format: "mov",
                  codec: "h265",
                  bitrate: 80000,
                  quality: 95,
                };
              case "4k-prores":
                return {
                  ...base,
                  width: 3840,
                  height: 2160,
                  frameRate: 30,
                  format: "mov",
                  codec: "prores",
                  bitrate: 880000,
                  quality: 100,
                };
              case "4k":
                return {
                  ...base,
                  width: 3840,
                  height: 2160,
                  frameRate: 30,
                  format: "mp4",
                  codec: "h264",
                  bitrate: 50000,
                  quality: 90,
                };
              case "1080p-60":
                return {
                  ...base,
                  width: 1920,
                  height: 1080,
                  frameRate: 60,
                  format: "mp4",
                  codec: "h264",
                  bitrate: 25000,
                  quality: 95,
                };
              case "1080p-high":
                return {
                  ...base,
                  width: 1920,
                  height: 1080,
                  frameRate: 30,
                  format: "mp4",
                  codec: "h264",
                  bitrate: 20000,
                  quality: 95,
                };
              case "prores":
                return {
                  ...base,
                  format: "mov",
                  codec: "prores",
                  bitrate: 220000,
                  quality: 100,
                };
              case "gif":
                return {
                  ...base,
                  format: "webm",
                  codec: "vp9",
                  bitrate: 8000,
                };
              case "mp4":
              default:
                return {
                  ...base,
                  format: "mp4",
                  codec: "h264",
                  bitrate: 12000,
                  quality: 85,
                };
            }
          };

          const videoSettings = getExportSettings();

          const generator = engine.exportVideo(project, videoSettings);
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
              phase:
                value.phase === "complete" ? "Complete!" : `${value.phase}...`,
            }));
          }

          if (finalResult?.success && finalResult.blob) {
            const getExtension = () => {
              switch (type) {
                case "4k-60-master":
                case "4k-master":
                case "4k-prores":
                case "prores":
                  return "mov";
                case "gif":
                  return "webm";
                default:
                  return "mp4";
              }
            };
            downloadBlob(
              finalResult.blob,
              `${project.name || "export"}.${getExtension()}`,
            );
            setExportState((prev) => ({
              ...prev,
              complete: true,
              phase: "Downloaded!",
            }));
          } else {
            throw new Error(finalResult?.error?.message || "Export failed");
          }
        }

        setTimeout(() => {
          setExportState({
            isExporting: false,
            progress: 0,
            phase: "",
            error: null,
            complete: false,
          });
        }, 2000);
      } catch (error) {
        setExportState((prev) => ({
          ...prev,
          isExporting: false,
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    [project],
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
      setExportState({
        isExporting: true,
        progress: 0,
        phase: "Initializing...",
        error: null,
        complete: false,
      });

      try {
        const engine = getExportEngine();
        await engine.initialize();

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

        const generator = engine.exportVideo(project, exportSettings);
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
            phase:
              value.phase === "complete" ? "Complete!" : `${value.phase}...`,
          }));
        }

        if (finalResult?.success && finalResult.blob) {
          const ext =
            settings.format === "mov"
              ? "mov"
              : settings.format === "webm"
                ? "webm"
                : "mp4";
          downloadBlob(finalResult.blob, `${project.name || "export"}.${ext}`);
          setExportState((prev) => ({
            ...prev,
            complete: true,
            phase: "Downloaded!",
          }));
        } else {
          throw new Error(finalResult?.error?.message || "Export failed");
        }

        setTimeout(() => {
          setExportState({
            isExporting: false,
            progress: 0,
            phase: "",
            error: null,
            complete: false,
          });
        }, 2000);
      } catch (error) {
        setExportState((prev) => ({
          ...prev,
          isExporting: false,
          error: error instanceof Error ? error.message : "Export failed",
        }));
      }
    },
    [project],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target as Node)
      ) {
        setIsExportOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
  const exportOptions: Array<{
    label: string;
    icon: typeof FileVideo;
    desc: string;
    type: ExportType;
  }> = [
    {
      label: "Project Resolution",
      icon: Film,
      desc: `${projectRes} ProRes - Highest quality`,
      type: "project",
    },
    {
      label: "4K 60fps Master",
      icon: Film,
      desc: "3840×2160 H.265 - Ultra smooth",
      type: "4k-60-master",
    },
    {
      label: "4K Master (H.265)",
      icon: Film,
      desc: "3840×2160 30fps - Maximum quality",
      type: "4k-master",
    },
    {
      label: "4K ProRes HQ",
      icon: Film,
      desc: "3840×2160 - Professional grade",
      type: "4k-prores",
    },
    {
      label: "4K Standard",
      icon: FileVideo,
      desc: "3840×2160 - YouTube 4K",
      type: "4k",
    },
    {
      label: "1080p 60fps High",
      icon: FileVideo,
      desc: "1920×1080 - Smooth playback",
      type: "1080p-60",
    },
    {
      label: "1080p High Quality",
      icon: FileVideo,
      desc: "1920×1080 30fps - High bitrate",
      type: "1080p-high",
    },
    {
      label: "MP4 (H.264)",
      icon: FileVideo,
      desc: `${projectRes} - Web & social`,
      type: "mp4",
    },
    {
      label: "ProRes 422 HQ",
      icon: Film,
      desc: `${projectRes} - Editing master`,
      type: "prores",
    },
    {
      label: "WebM (VP9)",
      icon: Film,
      desc: `${projectRes} - Short loops`,
      type: "gif",
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
        <div className="flex items-center gap-3">
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
        </div>
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
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-background-elevated text-text-secondary hover:text-text-primary transition-colors"
          title={`Theme: ${themeMode}`}
        >
          {themeMode === "light" ? (
            <Sun size={16} />
          ) : themeMode === "dark" ? (
            <Moon size={16} />
          ) : (
            <SunMoon size={16} />
          )}
        </button>

        <button
          onClick={() => useUIStore.getState().openModal("scriptView")}
          className="p-2 rounded-lg hover:bg-background-elevated text-text-secondary hover:text-text-primary transition-colors"
          title="Script View - View/Import JSON"
        >
          <FileCode size={16} />
        </button>

        <button
          onClick={() => setIsHistoryOpen(!isHistoryOpen)}
          className={`p-2 rounded-lg transition-colors ${
            isHistoryOpen
              ? "bg-primary/20 text-primary"
              : "hover:bg-background-elevated text-text-secondary hover:text-text-primary"
          }`}
          title="History - Undo/Redo actions"
        >
          <History size={16} />
        </button>

        <button
          onClick={() => setIsRecorderOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-error/10 hover:bg-error/20 text-error rounded-lg transition-colors"
          title="Screen Recording"
        >
          <Circle size={14} className="fill-current" />
          <span className="text-sm font-medium">Record</span>
        </button>

        <div className="relative" ref={exportMenuRef}>
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
            <>
              <button
                onClick={() => setIsExportOpen(!isExportOpen)}
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

              {isExportOpen && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-background-secondary border border-border rounded-xl shadow-2xl overflow-hidden z-50">
                  <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
                    {exportOptions.map((option) => (
                      <button
                        key={option.type}
                        className="w-full flex items-center gap-3 p-3 hover:bg-background-tertiary rounded-lg transition-colors text-left group"
                        onClick={() => handleExport(option.type)}
                      >
                        <div className="p-2 bg-background-tertiary group-hover:bg-background-elevated rounded-lg text-text-secondary group-hover:text-primary transition-colors">
                          <option.icon size={18} />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-text-primary group-hover:text-primary transition-colors">
                            {option.label}
                          </div>
                          <div className="text-xs text-text-muted mt-0.5">
                            {option.desc}
                          </div>
                        </div>
                      </button>
                    ))}

                    <div className="border-t border-border pt-2 mt-2">
                      <button
                        className="w-full flex items-center gap-3 p-3 hover:bg-primary/10 rounded-lg transition-colors text-left group"
                        onClick={() => {
                          setIsExportOpen(false);
                          setIsExportDialogOpen(true);
                        }}
                      >
                        <div className="p-2 bg-primary/10 group-hover:bg-primary/20 rounded-lg text-primary transition-colors">
                          <Sparkles size={18} />
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
                          className="text-text-muted group-hover:text-primary transition-colors"
                        />
                      </button>
                    </div>
                  </div>
                  <div className="bg-background-tertiary px-3 py-2.5 text-xs text-center text-text-muted border-t border-border">
                    {project.settings.width}×{project.settings.height} •{" "}
                    {project.settings.frameRate}fps
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleCustomExport}
        duration={project.timeline?.duration ?? 0}
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
