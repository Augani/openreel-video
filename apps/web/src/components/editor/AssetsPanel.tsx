import React, { useCallback, useRef, useState } from "react";
import {
  Search,
  Maximize2,
  X,
  Image as ImageIcon,
  Film,
  Music,
  Plus,
  Upload,
  Trash2,
  Square,
  Circle,
  Triangle,
  Star,
  ArrowRight,
  Hexagon,
  FileCode,
  AlertTriangle,
  RefreshCw,
  Palette,
  LayoutGrid,
  Grid2x2,
  List,
  Sparkles,
} from "lucide-react";
import {
  BACKGROUND_PRESETS,
  generateBackgroundBlob,
  type BackgroundPreset,
} from "../../services/background-generator";
import type { ShapeType } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import type { MediaItem } from "@openreel/core";
import { AspectRatioMatchDialog } from "./dialogs/AspectRatioMatchDialog";
import { AIGenTab } from "./AIGenTab";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import { saveFileHandle, saveDirectoryHandle } from "../../services/media-storage";
import {
  IconButton,
  Input,
  ScrollArea,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@openreel/ui";
import { KieAIImageDialog } from "./kieai/KieAIImageDialog";
import { loadMediaBlob } from "../../services/media-storage";
import { useKieAIStore } from "../../stores/kieai-store";

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

/**
 * Media Item Thumbnail Component
 * Shows thumbnail with metadata below (not overlaid)
 */
type MediaViewMode = "large" | "small" | "list";

const MediaThumbnail: React.FC<{
  item: MediaItem;
  isSelected: boolean;
  viewMode: MediaViewMode;
  onSelect: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAddToTimeline: () => void;
  onKieAI?: () => void;
  onRetryKieAI?: () => void;
}> = ({
  item,
  isSelected,
  viewMode,
  onSelect,
  onDelete,
  onReplace,
  onDragStart,
  onAddToTimeline,
  onKieAI,
  onRetryKieAI,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getIcon = () => {
    switch (item.type) {
      case "video":
        return Film;
      case "audio":
        return Music;
      case "image":
        return ImageIcon;
      default:
        return Film;
    }
  };

  const Icon = getIcon();

  const formatResolution = () => {
    if (item.metadata?.width && item.metadata?.height) {
      return `${item.metadata.width}×${item.metadata.height}`;
    }
    return null;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const iconColor = item.type === "audio"
    ? "text-primary/50"
    : item.type === "image"
      ? "text-primary/50"
      : "text-status-info/50";

  const borderClass = item.kieaiError
    ? "border-red-500 ring-1 ring-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
    : item.isPending
    ? "border-purple-500 ring-1 ring-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.3)]"
    : item.isPlaceholder
      ? "border-yellow-500 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]"
      : isSelected
        ? "border-primary ring-1 ring-primary/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
        : "border-border hover:border-text-secondary";

  const hoverOverlay = (
    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center gap-2 animate-in fade-in duration-200">
      {item.kieaiError ? (
        <button
          onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
          title="Generation failed — click to retry"
          className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
        >
          <RefreshCw size={14} className="text-red-400" />
        </button>
      ) : item.isPending ? (
        <div title="KieAI generation in progress…" className="p-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
        </div>
      ) : item.isPlaceholder ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onReplace(); }}
            title="Replace asset"
            className="p-2 bg-yellow-500/20 rounded-full hover:bg-yellow-500/40 backdrop-blur-sm transition-colors"
          >
            <RefreshCw size={14} className="text-yellow-500" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          >
            <Trash2 size={14} className="text-red-400" />
          </button>
        </>
      ) : (
        <>
          {item.type === "image" && onKieAI && (
            <button
              onClick={(e) => { e.stopPropagation(); onKieAI(); }}
              title="Create with KieAI"
              className="p-2 bg-purple-500/20 rounded-full hover:bg-purple-500/40 backdrop-blur-sm transition-colors"
            >
              <Sparkles size={14} className="text-purple-300" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
            title="Add to timeline"
            className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
          >
            <Plus size={14} className="text-primary" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          >
            <Trash2 size={14} className="text-red-400" />
          </button>
        </>
      )}
    </div>
  );

  // --- List view ---
  if (viewMode === "list") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 cursor-pointer transition-all group ${borderClass}`}
      >
        {/* Small thumbnail */}
        <div className="w-12 h-8 rounded bg-background-tertiary relative overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon size={14} className={iconColor} />
            </div>
          )}
          {item.kieaiError && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
              <AlertTriangle size={12} className="text-red-400" />
            </div>
          )}
          {!item.kieaiError && item.isPending && (
            <div className="absolute inset-0 flex items-center justify-center bg-purple-500/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            </div>
          )}
          {!item.kieaiError && !item.isPending && item.isPlaceholder && (
            <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
              <AlertTriangle size={12} className="text-yellow-500/70" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[11px] truncate font-medium ${isSelected ? "text-primary" : "text-text-primary"}`}
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-text-muted">
            {item.metadata?.duration && <span>{formatDuration(item.metadata.duration)}</span>}
            {item.metadata?.duration && formatResolution() && <span>•</span>}
            {formatResolution() && <span>{formatResolution()}</span>}
            {(item.metadata?.duration || formatResolution()) && formatFileSize(item.metadata?.fileSize) && <span>•</span>}
            {formatFileSize(item.metadata?.fileSize) && <span>{formatFileSize(item.metadata?.fileSize)}</span>}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.kieaiError ? (
              <button
                onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
                title="Retry generation"
                className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
              >
                <RefreshCw size={12} className="text-red-400" />
              </button>
            ) : item.isPending ? (
              <div className="p-1" title="Generating…">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
              </div>
            ) : item.isPlaceholder ? (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  title="Replace asset"
                  className="p-1 bg-yellow-500/20 rounded hover:bg-yellow-500/40 transition-colors"
                >
                  <RefreshCw size={12} className="text-yellow-500" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  title="Delete"
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </>
            ) : (
              <>
                {item.type === "image" && onKieAI && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onKieAI(); }}
                    title="Create with KieAI"
                    className="p-1 bg-purple-500/20 rounded hover:bg-purple-500/40 transition-colors"
                  >
                    <Sparkles size={12} className="text-purple-300" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                  title="Add to timeline"
                  className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                >
                  <Plus size={12} className="text-primary" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  title="Delete"
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              </>
            )}
          </div>
        )}

        {isSelected && (
          <div className="w-2 h-2 bg-primary rounded-full shadow-[0_0_8px_#22c55e] flex-shrink-0" />
        )}
      </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {item.type === "image" && onKieAI && (
            <ContextMenuItem onClick={onKieAI}>
              <Sparkles size={13} className="mr-2 text-primary" />
              Create with KieAI
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={(e) => { (e as React.MouseEvent).stopPropagation?.(); onAddToTimeline(); }}>
            <Plus size={13} className="mr-2" />
            Add to Timeline
          </ContextMenuItem>
          <ContextMenuItem onClick={(e) => { (e as React.MouseEvent).stopPropagation?.(); onDelete(); }} className="text-red-400 focus:text-red-400">
            <Trash2 size={13} className="mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // --- Grid view (large & small) ---
  const thumbnailIconSize = viewMode === "small" ? 16 : 24;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div className="flex flex-col">
      {/* Thumbnail container */}
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAddToTimeline();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`aspect-video bg-background-tertiary rounded-lg border-2 relative group cursor-pointer transition-all overflow-hidden shadow-sm ${borderClass}`}
      >
        {/* Thumbnail or placeholder */}
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-background-tertiary">
            <Icon size={thumbnailIconSize} className={iconColor} />
          </div>
        )}

        {/* Audio waveform placeholder */}
        {item.type === "audio" && (
          <div className="absolute top-1/2 left-0 right-0 h-4 flex items-center gap-px px-2 -translate-y-1/2">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* KieAI Error Badge */}
        {item.kieaiError && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <AlertTriangle size={8} />
            Failed
          </div>
        )}

        {/* Pending KieAI Badge */}
        {!item.kieaiError && item.isPending && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-purple-500 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <div className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            AI
          </div>
        )}

        {/* Missing Asset Badge */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] text-black font-bold flex items-center gap-1">
            <AlertTriangle size={10} />
            Missing
          </div>
        )}

        {/* Duration badge on thumbnail */}
        {item.metadata?.duration && (
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white font-mono">
            {formatDuration(item.metadata.duration)}
          </div>
        )}

        {/* Error overlay */}
        {item.kieaiError && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-red-400/60" />
          </div>
        )}

        {/* Pending overlay */}
        {!item.kieaiError && item.isPending && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-purple-500/10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-400 border-t-transparent" />
          </div>
        )}

        {/* Warning icon overlay for placeholders */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-yellow-500/50" />
          </div>
        )}

        {/* Hover overlay with actions */}
        {isHovered && hoverOverlay}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full shadow-[0_0_8px_#22c55e]" />
        )}
      </div>

      {/* Metadata below thumbnail */}
      <div className="mt-1.5 px-0.5">
        <div
          className={`text-[10px] truncate font-medium ${
            isSelected ? "text-primary" : "text-text-primary"
          }`}
          title={item.name}
        >
          {item.name}
        </div>
        {viewMode === "large" && (
          <div className="flex items-center gap-1.5 text-[9px] text-text-muted mt-0.5">
            {formatResolution() && <span>{formatResolution()}</span>}
            {formatResolution() && formatFileSize(item.metadata?.fileSize) && (
              <span>•</span>
            )}
            {formatFileSize(item.metadata?.fileSize) && (
              <span>{formatFileSize(item.metadata?.fileSize)}</span>
            )}
          </div>
        )}
      </div>
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {item.type === "image" && onKieAI && (
          <ContextMenuItem onClick={onKieAI}>
            <Sparkles size={13} className="mr-2 text-primary" />
            Create with KieAI
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onAddToTimeline()}>
          <Plus size={13} className="mr-2" />
          Add to Timeline
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDelete()} className="text-red-400 focus:text-red-400">
          <Trash2 size={13} className="mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

const EmptyState: React.FC<{ onImport: () => void }> = ({ onImport }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
    <div className="w-16 h-16 rounded-2xl bg-background-tertiary border border-border flex items-center justify-center mb-4 shadow-inner">
      <Upload size={24} className="text-text-muted" />
    </div>
    <p className="text-sm text-text-secondary mb-2 font-medium">
      No media imported
    </p>
    <p className="text-xs text-text-muted mb-6">
      Drag files here or click to import
    </p>
    <button
      onClick={onImport}
      className="px-4 py-2 bg-background-elevated hover:bg-background-tertiary border border-border text-text-primary text-xs font-medium rounded-lg transition-all hover:border-primary/50"
    >
      Import Media
    </button>
  </div>
);

const LoadingIndicator: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-background-secondary/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
    <p className="text-sm text-text-secondary">{message}</p>
  </div>
);

export const AssetsPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTabRaw] = useState<
    "media" | "text" | "graphics" | "ai"
  >("media");
  const ttsHasUnsaved = useTtsAudioStore((s) => s.generatedAudio !== null && !s.isAudioSaved);

  const setActiveTab = useCallback((tab: "media" | "text" | "graphics" | "ai") => {
    if (activeTab === "ai" && tab !== "ai" && ttsHasUnsaved) {
      toast.warning("Unsaved audio discarded", "Save to media or download next time to keep it.");
    }
    setActiveTabRaw(tab);
  }, [activeTab, ttsHasUnsaved]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showAspectRatioDialog, setShowAspectRatioDialog] = useState(false);
  const [aspectRatioDialogData, setAspectRatioDialogData] = useState<{
    videoWidth: number;
    videoHeight: number;
    itemToAdd: MediaItem;
  } | null>(null);
  const [mediaViewMode, setMediaViewMode] = useState<MediaViewMode>("large");
  const [generatingBackground, setGeneratingBackground] = useState<
    string | null
  >(null);
  const [backgroundCategory, setBackgroundCategory] = useState<
    "all" | "solid" | "gradient" | "pattern" | "mesh"
  >("all");

  // KieAI image generation dialog
  const [kieaiDialog, setKieaiDialog] = useState<{ file: File; previewUrl: string | null } | null>(null);

  // Project store
  const {
    project,
    importMedia,
    deleteMedia,
    replaceMediaAsset,
    updateSettings,
    setKieAIItemState,
  } = useProjectStore();
  const mediaItems = project.mediaLibrary.items;

  // KieAI store
  const { retryTask } = useKieAIStore();

  // UI store
  const { select, isSelected, startDrag } = useUIStore();

  // Count missing assets
  const missingAssetsCount = mediaItems.filter(
    (item) => item.isPlaceholder,
  ).length;

  // Filter media items by search query and missing assets toggle
  const filteredItems = mediaItems.filter((item) => {
    const matchesSearch = item.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesFilter = showOnlyMissing ? item.isPlaceholder : true;
    return matchesSearch && matchesFilter;
  });

  // Handle file import with loading state
  const handleFileImport = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setIsImporting(true);
      const fileArray = Array.from(files);

      try {
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          setImportProgress(
            `Importing ${file.name} (${i + 1}/${fileArray.length})...`,
          );

          const result = await importMedia(file);

          // If it's a video with audio, extract audio to separate track
          if (result.success && file.type.startsWith("video/")) {
            setImportProgress(`Extracting audio from ${file.name}...`);
            // Audio extraction is handled by the importMedia function
            // The audio track is created automatically when adding to timeline
          }
        }
      } catch (error) {
        console.error("Import failed:", error);
      } finally {
        setIsImporting(false);
        setImportProgress("");
      }
    },
    [importMedia],
  );

  // Handle drag and drop import — capture FileSystemFileHandle for each dropped file
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Try to capture handles before files are consumed
      if ("getAsFileSystemHandle" in DataTransferItem.prototype) {
        const handlePromises = Array.from(e.dataTransfer.items)
          .filter((item) => item.kind === "file")
          .map(async (item) => {
            try {
              const handle = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }).getAsFileSystemHandle();
              if (handle.kind === "file") {
                const fileHandle = handle as FileSystemFileHandle;
                const file = await fileHandle.getFile();
                await saveFileHandle(file.name, file.size, fileHandle);
              }
            } catch {
              // Ignore — handle capture is best-effort
            }
          });
        await Promise.all(handlePromises);
      }

      handleFileImport(e.dataTransfer.files);
    },
    [handleFileImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Handle media item selection
  const handleSelectItem = useCallback(
    (itemId: string) => {
      select({ type: "clip", id: itemId });
    },
    [select],
  );

  // Handle media item deletion
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      await deleteMedia(itemId);
    },
    [deleteMedia],
  );

  // Handle asset replacement
  const handleReplaceAsset = useCallback(
    async (itemId: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,audio/*,image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          setIsImporting(true);
          setImportProgress(`Replacing asset...`);
          try {
            await replaceMediaAsset(itemId, file);
          } catch (error) {
            console.error("Asset replacement failed:", error);
          } finally {
            setIsImporting(false);
            setImportProgress("");
          }
        }
      };
      input.click();
    },
    [replaceMediaAsset],
  );

  const handleRelinkFromFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      toast.error("Folder picker not supported", "Please relink assets individually using the refresh button on each missing asset.");
      return;
    }
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    } catch {
      return; // user cancelled
    }

    const { project } = useProjectStore.getState();
    const placeholders = project.mediaLibrary.items.filter((item) => item.isPlaceholder);
    if (placeholders.length === 0) return;

    // Persist the directory handle for future auto-restore
    try { await saveDirectoryHandle(project.id, dirHandle); } catch { /* best-effort */ }

    // Build a name:size → {File, handle} map for reliable matching
    const fileMap = new Map<string, { file: File; handle: FileSystemFileHandle }>();
    const entries = (dirHandle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
    for await (const [, fh] of entries) {
      if ((fh as FileSystemHandle).kind === "file") {
        const fileHandle = fh as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        fileMap.set(`${file.name.toLowerCase()}:${file.size}`, { file, handle: fileHandle });
      }
    }

    setIsImporting(true);
    let linked = 0;
    for (const item of placeholders) {
      // Match on original source file name + size (same strategy as auto-restore)
      const key = item.sourceFile
        ? `${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`
        : null;
      const entry = key ? fileMap.get(key) : null;
      if (entry) {
        setImportProgress(`Relinking ${item.name}…`);
        try {
          // Save individual file handle for future auto-restore
          try { await saveFileHandle(entry.file.name, entry.file.size, entry.handle); } catch { /* best-effort */ }
          await replaceMediaAsset(item.id, entry.file, dirHandle.name);
          linked++;
        } catch (err) {
          console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
        }
      }
    }
    setIsImporting(false);
    setImportProgress("");

    if (linked > 0) {
      toast.success(`Relinked ${linked} of ${placeholders.length} asset${placeholders.length !== 1 ? "s" : ""}`);
    } else {
      toast.error("No matches found", "None of the files in the selected folder matched the missing assets by filename.");
    }
  }, [replaceMediaAsset]);

  // Handle drag start for timeline placement
  const handleItemDragStart = useCallback(
    (e: React.DragEvent, item: MediaItem) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({ mediaId: item.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      startDrag("media", { mediaId: item.id, mediaType: item.type });
    },
    [startDrag],
  );

  const addMediaToTimeline = useCallback(async (item: MediaItem) => {
    const { addClipToNewTrack } = useProjectStore.getState();
    await addClipToNewTrack(item.id);
  }, []);

  const handleConfirmAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    await updateSettings({
      width: aspectRatioDialogData.videoWidth,
      height: aspectRatioDialogData.videoHeight,
    });

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, updateSettings, addMediaToTimeline]);

  const handleCancelAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, addMediaToTimeline]);

  const handleAddToTimeline = useCallback(
    async (item: MediaItem) => {
      const { project: currentProject } = useProjectStore.getState();
      const tracks = currentProject.timeline.tracks;
      const hasClips = tracks.some((track) => track.clips.length > 0);

      if (
        !hasClips &&
        item.type === "video" &&
        item.metadata?.width &&
        item.metadata?.height
      ) {
        const videoWidth = item.metadata.width;
        const videoHeight = item.metadata.height;
        const projectWidth = currentProject.settings.width;
        const projectHeight = currentProject.settings.height;

        if (videoWidth !== projectWidth || videoHeight !== projectHeight) {
          setAspectRatioDialogData({ videoWidth, videoHeight, itemToAdd: item });
          setShowAspectRatioDialog(true);
          return;
        }
      }

      await addMediaToTimeline(item);
    },
    [addMediaToTimeline],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportBackground = useCallback(
    async (preset: BackgroundPreset) => {
      setGeneratingBackground(preset.id);
      try {
        const { width, height } = project.settings;
        const blob = await generateBackgroundBlob(preset, width, height);
        const file = new File([blob], `${preset.name}_${width}x${height}.png`, {
          type: "image/png",
        });
        const result = await importMedia(file);
        if (result.success && result.actionId) {
          const { addClipToNewTrack } = useProjectStore.getState();
          await addClipToNewTrack(result.actionId);
        }
      } catch (error) {
        console.error("Failed to generate background:", error);
      } finally {
        setGeneratingBackground(null);
      }
    },
    [importMedia, project.settings],
  );

  const filteredBackgrounds = BACKGROUND_PRESETS.filter(
    (preset) =>
      backgroundCategory === "all" || preset.category === backgroundCategory,
  );

  // Open KieAI dialog for an image asset
  const handleOpenKieAI = useCallback(async (item: MediaItem) => {
    try {
      const blob = await loadMediaBlob(item.id);
      if (!blob) {
        toast.error("Asset not found", "Cannot load the image data for this asset.");
        return;
      }
      const mimeType = blob.type || (item.name.match(/\.png$/i) ? "image/png" : "image/jpeg");
      const file = new File([blob], item.name, { type: mimeType as string });
      setKieaiDialog({ file, previewUrl: item.thumbnailUrl });
    } catch (err) {
      console.error("[KieAI] Failed to load media blob:", err);
      toast.error("Failed to open KieAI", err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  const handleRetryKieAI = useCallback((item: MediaItem) => {
    if (!item.kieaiTaskId) return;
    // Reset error state and re-activate polling
    setKieAIItemState(item.id, true, false);
    retryTask(item.kieaiTaskId);
  }, [retryTask, setKieAIItemState]);

  return (
    <div
      data-tour="assets"
      className="w-80 bg-background-secondary border-r border-border flex flex-col h-full relative"
    >
      {/* Loading overlay */}
      {isImporting && (
        <LoadingIndicator message={importProgress || "Importing media..."} />
      )}
      {/* Panel Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <span className="font-bold text-lg text-text-primary tracking-tight">
          Assets
        </span>
        <div className="flex gap-1">
          <IconButton
            icon={Plus}
            onClick={triggerFileInput}
            title="Import media"
          />
          <IconButton icon={Maximize2} title="Maximize panel" />
          <IconButton icon={X} title="Close panel" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-5 gap-6 border-b border-border text-xs font-medium text-text-muted mb-5">
        <button
          onClick={() => setActiveTab("media")}
          className={`pb-3 transition-all relative ${
            activeTab === "media"
              ? "text-text-primary"
              : "hover:text-text-secondary"
          }`}
        >
          Media
          {activeTab === "media" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full shadow-[0_-2px_8px_rgba(34,197,94,0.5)]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("text")}
          className={`pb-3 transition-all relative ${
            activeTab === "text"
              ? "text-text-primary"
              : "hover:text-text-secondary"
          }`}
        >
          Text
          {activeTab === "text" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full shadow-[0_-2px_8px_rgba(34,197,94,0.5)]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("graphics")}
          className={`pb-3 transition-all relative ${
            activeTab === "graphics"
              ? "text-text-primary"
              : "hover:text-text-secondary"
          }`}
        >
          Graphics
          {activeTab === "graphics" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full shadow-[0_-2px_8px_rgba(34,197,94,0.5)]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className={`pb-3 transition-all relative ${
            activeTab === "ai"
              ? "text-primary"
              : "text-primary/70 hover:text-primary"
          }`}
        >
          AI Gen
          {activeTab === "ai" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full shadow-[0_-2px_8px_rgba(34,197,94,0.5)]" />
          )}
        </button>
      </div>

      {/* Search & view toggle - only show for media tab */}
      {activeTab === "media" && (
        <div className="px-5 mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted z-10" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search media"
              className="pl-9 text-xs bg-background-tertiary border-border text-text-primary h-9"
            />
          </div>
          <div className="flex items-center bg-background-tertiary border border-border rounded-lg p-0.5">
            {([
              { mode: "large" as const, icon: LayoutGrid, title: "Large icons" },
              { mode: "small" as const, icon: Grid2x2, title: "Small icons" },
              { mode: "list" as const, icon: List, title: "List view" },
            ]).map(({ mode, icon: ViewIcon, title }) => (
              <button
                key={mode}
                onClick={() => setMediaViewMode(mode)}
                title={title}
                className={`p-1.5 rounded transition-colors ${
                  mediaViewMode === mode
                    ? "bg-background-elevated text-text-primary"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                <ViewIcon size={13} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Missing Assets Filter and Badge */}
      {activeTab === "media" && missingAssetsCount > 0 && (
        <div className="px-5 mb-5 space-y-2">
          <button
            onClick={() => setShowOnlyMissing(!showOnlyMissing)}
            className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-between ${
              showOnlyMissing
                ? "bg-yellow-500/10 border-yellow-500 text-yellow-500"
                : "bg-background-tertiary border-border text-text-secondary hover:border-yellow-500/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} />
              <span>Show Only Missing Assets</span>
            </div>
            <div className="px-2 py-0.5 rounded-full bg-yellow-500 text-black text-[10px] font-bold">
              {missingAssetsCount}
            </div>
          </button>
          <button
            onClick={handleRelinkFromFolder}
            className="w-full px-3 py-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 text-yellow-500 text-xs font-medium transition-all hover:bg-yellow-500/15 flex items-center gap-2"
          >
            <RefreshCw size={14} />
            <span>Relink from Folder…</span>
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        onChange={(e) => handleFileImport(e.target.files)}
        className="hidden"
      />

      {/* Content based on active tab */}
      {activeTab === "media" && (
        <ScrollArea
          className={`flex-1 ${isDragOver ? "bg-primary/5" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="px-5 pb-5">
            {filteredItems.length === 0 ? (
              <EmptyState onImport={triggerFileInput} />
            ) : (
              <div className={
                mediaViewMode === "list"
                  ? "flex flex-col gap-1.5"
                  : mediaViewMode === "small"
                    ? "grid grid-cols-3 gap-2"
                    : "grid grid-cols-2 gap-3"
              }>
                {filteredItems.map((item) => (
                  <MediaThumbnail
                    key={item.id}
                    item={item}
                    isSelected={isSelected(item.id)}
                    viewMode={mediaViewMode}
                    onSelect={() => handleSelectItem(item.id)}
                    onDelete={() => handleDeleteItem(item.id)}
                    onReplace={() => handleReplaceAsset(item.id)}
                    onDragStart={(e) => handleItemDragStart(e, item)}
                    onAddToTimeline={() => handleAddToTimeline(item)}
                    onKieAI={item.type === "image" && !item.isPending && !item.kieaiError ? () => handleOpenKieAI(item) : undefined}
                    onRetryKieAI={item.kieaiError && item.kieaiTaskId ? () => handleRetryKieAI(item) : undefined}
                  />
                ))}
                {/* Add more media tile */}
                {mediaViewMode === "list" ? (
                  <button
                    onClick={triggerFileInput}
                    className="flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 border-dashed border-border hover:border-text-secondary cursor-pointer transition-all group"
                  >
                    <div className="w-12 h-8 rounded bg-background-tertiary flex items-center justify-center flex-shrink-0">
                      <Upload size={14} className="text-text-muted group-hover:text-text-secondary transition-colors" />
                    </div>
                    <span className="text-[11px] text-text-muted group-hover:text-text-secondary transition-colors font-medium">Add media</span>
                  </button>
                ) : (
                  <div className="flex flex-col">
                    <button
                      onClick={triggerFileInput}
                      className="aspect-video bg-background-tertiary rounded-lg border-2 border-dashed border-border hover:border-text-secondary relative flex items-center justify-center cursor-pointer transition-all overflow-hidden shadow-sm group"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        <Upload size={mediaViewMode === "small" ? 16 : 20} className="text-text-muted group-hover:text-text-secondary transition-colors" />
                        <span className="text-[10px] text-text-muted group-hover:text-text-secondary transition-colors">Add media</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Drop zone indicator */}
            {isDragOver && (
              <div className="absolute inset-4 border-2 border-dashed border-primary rounded-xl flex items-center justify-center bg-primary/5 pointer-events-none z-50 backdrop-blur-sm">
                <div className="text-primary text-sm font-bold bg-background-secondary px-4 py-2 rounded-full shadow-lg">
                  Drop files to import
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Graphics Tab Content (Task 16) */}
      {activeTab === "graphics" && (
        <ScrollArea className="flex-1">
          <div className="px-5 pb-5">
          {/* Backgrounds Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                <Palette size={12} />
                Backgrounds
              </h4>
            </div>
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {(["all", "solid", "gradient", "mesh", "pattern"] as const).map(
                (cat) => (
                  <button
                    key={cat}
                    onClick={() => setBackgroundCategory(cat)}
                    className={`px-2.5 py-1 text-[10px] rounded-md transition-all ${
                      backgroundCategory === cat
                        ? "bg-primary text-white"
                        : "bg-background-tertiary text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ),
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {filteredBackgrounds.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleImportBackground(preset)}
                  disabled={generatingBackground !== null}
                  className="aspect-square rounded-lg border border-border hover:border-primary/50 transition-all overflow-hidden relative group disabled:opacity-50"
                  title={preset.name}
                  style={{ background: preset.thumbnail }}
                >
                  {generatingBackground === preset.id && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Plus size={16} className="text-white" />
                  </div>
                  <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white bg-black/60 py-0.5 px-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {preset.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Shapes Section */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-text-secondary mb-3">
              Shapes
            </h4>
            <div className="grid grid-cols-4 gap-2">
              {[
                {
                  type: "rectangle" as ShapeType,
                  icon: Square,
                  label: "Rectangle",
                },
                { type: "circle" as ShapeType, icon: Circle, label: "Circle" },
                {
                  type: "triangle" as ShapeType,
                  icon: Triangle,
                  label: "Triangle",
                },
                { type: "star" as ShapeType, icon: Star, label: "Star" },
                {
                  type: "arrow" as ShapeType,
                  icon: ArrowRight,
                  label: "Arrow",
                },
                {
                  type: "polygon" as ShapeType,
                  icon: Hexagon,
                  label: "Polygon",
                },
              ].map((shape) => (
                <button
                  key={shape.type}
                  onClick={async () => {
                    const state = useProjectStore.getState();
                    const { createShapeClip, addTrack } = state;
                    const tracksBefore = state.project.timeline.tracks;
                    await addTrack("graphics", 0);
                    const tracksAfter =
                      useProjectStore.getState().project.timeline.tracks;
                    const newGraphicsTrack = tracksAfter.find(
                      (t) =>
                        t.type === "graphics" &&
                        !tracksBefore.some((bt) => bt.id === t.id),
                    );
                    if (newGraphicsTrack) {
                      createShapeClip(newGraphicsTrack.id, 0, shape.type);
                    }
                  }}
                  className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                  title={shape.label}
                >
                  <shape.icon
                    size={20}
                    className="text-text-secondary group-hover:text-primary transition-colors"
                  />
                  <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                    {shape.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* SVG Import Section */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-text-secondary mb-3">
              SVG Import
            </h4>
            <button
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".svg";
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) {
                    const content = await file.text();
                    const state = useProjectStore.getState();
                    const { importSVG, addTrack } = state;
                    const tracksBefore = state.project.timeline.tracks;
                    await addTrack("graphics", 0);
                    const tracksAfter =
                      useProjectStore.getState().project.timeline.tracks;
                    const newGraphicsTrack = tracksAfter.find(
                      (t) =>
                        t.type === "graphics" &&
                        !tracksBefore.some((bt) => bt.id === t.id),
                    );
                    if (newGraphicsTrack) {
                      importSVG(content, newGraphicsTrack.id, 0);
                    }
                  }
                };
                input.click();
              }}
              className="w-full py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 group"
            >
              <FileCode
                size={16}
                className="text-text-secondary group-hover:text-primary transition-colors"
              />
              <span className="text-xs text-text-secondary group-hover:text-text-primary">
                Import SVG File
              </span>
            </button>
          </div>

          {/* Stickers Section (placeholder) */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-text-secondary mb-3">
              Stickers & Emojis
            </h4>
            <div className="grid grid-cols-4 gap-2">
              {["😀", "🎉", "❤️", "⭐", "🔥", "👍", "🎬", "🎵"].map(
                (emoji, i) => (
                  <button
                    key={i}
                    onClick={async () => {
                      const state = useProjectStore.getState();
                      const { createStickerClip, addTrack } = state;
                      const { stickerLibrary } = await import("@openreel/core");

                      const tracksBefore = state.project.timeline.tracks;
                      await addTrack("graphics", 0);
                      const tracksAfter =
                        useProjectStore.getState().project.timeline.tracks;
                      const newGraphicsTrack = tracksAfter.find(
                        (t) =>
                          t.type === "graphics" &&
                          !tracksBefore.some((bt) => bt.id === t.id),
                      );

                      if (newGraphicsTrack) {
                        const emojiItem = {
                          id: `emoji-${i}`,
                          emoji,
                          name: emoji,
                          category: "emojis",
                        };
                        const clip = stickerLibrary.createEmojiClip(
                          emojiItem,
                          newGraphicsTrack.id,
                          0,
                          5,
                        );
                        createStickerClip(clip);
                      }
                    }}
                    className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center text-xl cursor-pointer"
                  >
                    {emoji}
                  </button>
                ),
              )}
            </div>
          </div>
          </div>
        </ScrollArea>
      )}

      {/* Text Tab Content */}
      {activeTab === "text" && (
        <ScrollArea className="flex-1">
          <div className="px-5 pb-5 space-y-3">
            <button
              onClick={async () => {
                const state = useProjectStore.getState();
                const { createTextClip, addTrack } = state;
                const tracksBefore = state.project.timeline.tracks;
                await addTrack("text", 0);
                const tracksAfter =
                  useProjectStore.getState().project.timeline.tracks;
                const newTextTrack = tracksAfter.find(
                  (t) =>
                    t.type === "text" &&
                    !tracksBefore.some((bt) => bt.id === t.id),
                );
                if (newTextTrack) {
                  createTextClip(newTextTrack.id, 0, "New Title");
                }
              }}
              className="w-full py-4 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-center"
            >
              <span className="text-lg font-bold text-text-primary">
                Add Title
              </span>
              <p className="text-xs text-text-muted mt-1">
                Click to add text to timeline
              </p>
            </button>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  name: "Heading",
                  text: "Heading",
                  style: {
                    fontSize: 72,
                    fontWeight: 700 as const,
                    textAlign: "center" as const,
                    verticalAlign: "middle" as const,
                  },
                },
                {
                  name: "Subtitle",
                  text: "Subtitle text",
                  style: {
                    fontSize: 36,
                    fontWeight: 400 as const,
                    textAlign: "center" as const,
                    verticalAlign: "middle" as const,
                  },
                },
                {
                  name: "Lower Third",
                  text: "Name Here",
                  style: {
                    fontSize: 32,
                    fontWeight: 600 as const,
                    textAlign: "left" as const,
                    verticalAlign: "bottom" as const,
                    backgroundColor: "rgba(0, 0, 0, 0.7)",
                  },
                },
                {
                  name: "Caption",
                  text: "Caption text here",
                  style: {
                    fontSize: 24,
                    fontWeight: 400 as const,
                    textAlign: "center" as const,
                    verticalAlign: "bottom" as const,
                    shadowColor: "rgba(0, 0, 0, 0.8)",
                    shadowBlur: 4,
                    shadowOffsetX: 1,
                    shadowOffsetY: 1,
                  },
                },
              ].map((preset) => (
                <button
                  key={preset.name}
                  onClick={async () => {
                    const state = useProjectStore.getState();
                    const { createTextClip, addTrack } = state;
                    const tracksBefore = state.project.timeline.tracks;
                    await addTrack("text", 0);
                    const tracksAfter =
                      useProjectStore.getState().project.timeline.tracks;
                    const newTextTrack = tracksAfter.find(
                      (t) =>
                        t.type === "text" &&
                        !tracksBefore.some((bt) => bt.id === t.id),
                    );
                    if (newTextTrack) {
                      createTextClip(
                        newTextTrack.id,
                        0,
                        preset.text,
                        5,
                        preset.style,
                      );
                    }
                  }}
                  className="py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-xs text-text-secondary hover:text-text-primary"
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}

      {/* AI Tab Content */}
      {activeTab === "ai" && <AIGenTab />}

      {aspectRatioDialogData && (
        <AspectRatioMatchDialog
          isOpen={showAspectRatioDialog}
          videoWidth={aspectRatioDialogData.videoWidth}
          videoHeight={aspectRatioDialogData.videoHeight}
          currentWidth={project.settings.width}
          currentHeight={project.settings.height}
          onConfirm={handleConfirmAspectRatioMatch}
          onCancel={handleCancelAspectRatioMatch}
        />
      )}

      {kieaiDialog && (
        <KieAIImageDialog
          open={true}
          onClose={() => setKieaiDialog(null)}
          sourceFile={kieaiDialog.file}
          previewUrl={kieaiDialog.previewUrl}
        />
      )}
    </div>
  );
};

export default AssetsPanel;
