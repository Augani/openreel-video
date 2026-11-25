import type { ActionExecutorLike } from "../../services/lazy-action-executor";
import { WorkspaceStockPanel } from "./WorkspaceStockPanel";
import { RecordingsPanel } from "./RecordingsPanel";
import { AudioLibraryIcon } from "@/icons/audio-library";
import { WorkspaceTextPanel } from "./WorkspaceTextPanel";
import { Button as ShadcnButton, Input, ScrollArea, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@openreel/ui";
import { MoreHorizontal } from "lucide-react";
import { MediaLibraryIcon } from "@/icons/media-library";
import { useEditorWorkspaceStore, type AssetSection } from "../../stores/editor-workspace-store";
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";
import { VoiceOverPanel } from "./inspector/VoiceOverPanel";
import { TextToSpeechPanel } from "./inspector/TextToSpeechPanel";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatMediaFileSize, getMediaFileSize, getMediaLibrarySizeLabel } from "./media-library-size";
import {
  Image as ImageIcon, Film, Music, Plus, Upload, Trash2,
  AlertTriangle,
  RefreshCw, Sparkles,
} from "@/icons/lucide-compat";
import {
  BACKGROUND_PRESETS,
  generateBackgroundBlob,
  type BackgroundPreset,
} from "../../services/background-generator";
import type { Project, TextStyle } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { isPremiereProjectFile, openTimelineFileForImport } from "../../services/timeline-interchange";
import { isCaptionFileName } from "../../services/caption-file-names";
import { RAW_FILE_ACCEPT, groupCinemaDng, interpretedDisplaySize, type MediaItem } from "@openreel/core";
import { enqueueImportBatch, takeNextImportBatch, type PendingImportBatch } from "../../services/import-batch-queue";
import { importCinemaDngSequence, looksLikeCinemaDngFrame } from "../../services/cinemadng-sequence";
import { AspectRatioMatchDialog } from "./dialogs/AspectRatioMatchDialog";
import { VersionsPanel } from "./VersionsPanel";
import { TemplatesTab } from "./panels/TemplatesTab";
import {
  EffectsPanel,
  TransitionsPanel,
} from "./panels/EffectsTransitionsPanel";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import { saveFileHandle, saveDirectoryHandle } from "../../services/media-storage";
import { cn } from "@openreel/ui";

import { KieAIImageDialog } from "./kieai/KieAIImageDialog";
import { loadMediaBlob } from "../../services/media-storage";
import { useKieAIStore } from "../../stores/kieai-store";
import { PreviewProxyBadge, PreviewProxyControls } from "./PreviewProxyControls";
import { ProxyIngestPanel, ProxyStateBadge } from "./ProxyIngestPanel";
import { desktopIngestAvailable, relinkFromFolder } from "../../services/desktop-ingest";
import { stockCreditText } from "../../services/stock-footage";
import { openInSourceMonitor } from "../../services/source-monitor-commands";
import { useProjectPanelStore } from "../../stores/project-panel-store";
import { useProjectPanelData } from "./project-panel/useProjectPanelData";
import { MediaListView } from "./project-panel/MediaListView";
import { SequencesSection } from "./project-panel/SequencesSection";
import { MediaGridView } from "./project-panel/MediaGridView";
import { LabelChip, MediaItemContextMenu, MediaOrganizeItems } from "./project-panel/ProjectPanelMenus";
import { ProjectPanelBar, ProjectPanelDialogs, useMediaSelectionCount } from "./project-panel/ProjectPanelBar";
import { writeMediaDrag } from "./project-panel/dnd";
import { Scissors } from "@/icons/lucide-compat";


// Tab panels that most sessions never open: kept out of the editor chunk, fetched on first use.
const WorkspaceGraphicsPanel = lazy(() => import("./WorkspaceGraphicsPanel").then((module) => ({ default: module.WorkspaceGraphicsPanel })));
const MusicLibraryPanel = lazy(() => import("./inspector/MusicLibraryPanel").then((module) => ({ default: module.MusicLibraryPanel })));

const panelFallback = <div className="h-full" role="status" aria-label="Loading panel" />;
const WorkspaceGeneratePanel = React.lazy(() => import("./WorkspaceGeneratePanel").then((m) => ({ default: m.WorkspaceGeneratePanel })));
const WorkspaceRecipesPanel = React.lazy(() => import("./panels/WorkspaceRecipesPanel").then((m) => ({ default: m.WorkspaceRecipesPanel })));
const MediaBrowserPanel = React.lazy(() => import("./MediaBrowserPanel").then((m) => ({ default: m.MediaBrowserPanel })));
const MetadataPanel = React.lazy(() => import("./MetadataPanel").then((m) => ({ default: m.MetadataPanel })));
const MarkersPanel = React.lazy(() => import("./MarkersPanel").then((m) => ({ default: m.MarkersPanel })));
const CommentsPanel = React.lazy(() => import("./CommentsPanel").then((m) => ({ default: m.CommentsPanel })));

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
type AssetsTab = AssetSection;

const DEFAULT_TITLE_STYLE: Partial<TextStyle> = {
  fontSize: 96,
  fontWeight: 800,
  letterSpacing: -1,
};

const TEXT_STYLE_PRESETS: ReadonlyArray<{
  name: string;
  text: string;
  style: Partial<TextStyle>;
}> = [
  { name: "Heading", text: "Heading", style: { fontSize: 72, fontWeight: 700 } },
  { name: "Subtitle", text: "Subtitle text", style: { fontSize: 36, fontWeight: 400 } },
  {
    name: "Lower Third",
    text: "Name Here",
    style: {
      fontSize: 32,
      fontWeight: 600,
      textAlign: "left",
      verticalAlign: "bottom",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
    },
  },
  {
    name: "Caption",
    text: "Caption text here",
    style: {
      fontSize: 24,
      fontWeight: 400,
      verticalAlign: "bottom",
      shadowColor: "rgba(0, 0, 0, 0.8)",
      shadowBlur: 4,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
    },
  },
  {
    name: "Hero",
    text: "MAKE IT MOVE",
    style: {
      fontSize: 112,
      fontWeight: 900,
      letterSpacing: -2,
      lineHeight: 0.95,
      strokeWidth: 3,
    },
  },
  {
    name: "Quote",
    text: "“Tell a better story.”",
    style: {
      fontSize: 54,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1.25,
      shadowColor: "rgba(0, 0, 0, 0.65)",
      shadowBlur: 10,
      shadowOffsetY: 4,
    },
  },
  {
    name: "Outline",
    text: "OUTLINE",
    style: {
      fontSize: 80,
      fontWeight: 900,
      letterSpacing: 2,
      strokeColor: "#111827",
      strokeWidth: 5,
    },
  },
  {
    name: "Badge",
    text: "NEW RELEASE",
    style: {
      fontSize: 28,
      fontWeight: 800,
      letterSpacing: 3,
      backgroundColor: "rgba(17, 24, 39, 0.88)",
    },
  },
];



const PanelIconButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}> = ({ label, icon, onClick, className }) => (
  <ShadcnButton variant="ghost" size="icon-sm" onClick={onClick} type="button" aria-label={label} title={label} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg", className)}>
    {icon}
  </ShadcnButton>
);

const PanelButton: React.FC<{
  label: string;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
  isDisabled?: boolean;
  children?: React.ReactNode;
}> = ({ label, onClick, className, isDisabled, children }) => (
  <ShadcnButton
    variant="ghost"
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={isDisabled}
    className={`h-auto justify-start whitespace-normal [&_svg]:size-[14px] ${className ?? ""}`}
  >
    {children ?? label}
  </ShadcnButton>
);






const audioPeakCache = new Map<string, number[]>();
const AUDIO_PEAK_BARS = 48;
const AUDIO_PEAK_MAX_BYTES = 48 * 1024 * 1024;

/** Lazily computes a coarse peak envelope for audio tiles (idle-time, cached, size-capped). */
function useMediaAudioPeaks(item: MediaItem, enabled: boolean): number[] {
  const given = item.waveformData;
  const [peaks, setPeaks] = useState<number[]>(() => audioPeakCache.get(item.id) ?? []);
  useEffect(() => {
    if (!enabled || item.type !== "audio" || item.isPlaceholder) return;
    if (given?.length) {
      const step = given.length / AUDIO_PEAK_BARS;
      setPeaks(Array.from({ length: AUDIO_PEAK_BARS }, (_, i) => Math.abs(given[Math.floor(i * step)] ?? 0)));
      return;
    }
    const cached = audioPeakCache.get(item.id);
    if (cached) { setPeaks(cached); return; }
    const blob = item.blob;
    if (!blob || blob.size > AUDIO_PEAK_MAX_BYTES) return;
    let cancelled = false;
    const run = async () => {
      try {
        const context = new OfflineAudioContext(1, 1, 44100);
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        const data = buffer.getChannelData(0);
        const block = Math.max(1, Math.floor(data.length / AUDIO_PEAK_BARS));
        const result = Array.from({ length: AUDIO_PEAK_BARS }, (_, i) => {
          let max = 0;
          const end = Math.min(data.length, (i + 1) * block);
          for (let j = i * block; j < end; j += 8) max = Math.max(max, Math.abs(data[j]));
          return max;
        });
        const top = Math.max(...result, 0.001);
        const normalized = result.map((v) => v / top);
        audioPeakCache.set(item.id, normalized);
        if (!cancelled) setPeaks(normalized);
      } catch { /* undecodable audio keeps the icon tile */ }
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const handle = idle ? idle(() => void run()) : window.setTimeout(() => void run(), 50);
    return () => { cancelled = true; if (!idle) window.clearTimeout(handle); };
  }, [enabled, item.id, item.type, item.isPlaceholder, item.blob, given]);
  return peaks;
}

const THUMBNAIL_WAIT_MS = 8000;

/**
 * Shimmer only while a poster frame can still arrive. Images can show their own bytes at once;
 * anything that never produced a thumbnail settles to the plain type tile instead of shimmering forever.
 */
function useThumbnailState(item: MediaItem): { waiting: boolean; imageUrl: string | null } {
  const eligible = !item.thumbnailUrl && item.type !== "audio" && !item.isPlaceholder && !item.isPending && !item.kieaiError;
  const [expired, setExpired] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const blob = item.type === "image" ? item.blob : null;
  useEffect(() => {
    if (!eligible || !blob) { setImageUrl(null); return; }
    let url: string;
    try { url = URL.createObjectURL(blob); } catch { setImageUrl(null); return; }
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [eligible, blob]);
  useEffect(() => {
    setExpired(false);
    if (!eligible) return;
    const handle = window.setTimeout(() => setExpired(true), THUMBNAIL_WAIT_MS);
    return () => window.clearTimeout(handle);
  }, [eligible, item.id]);
  return { waiting: eligible && !expired && !imageUrl, imageUrl };
}

const MediaThumbnail: React.FC<{
  item: MediaItem;
  isSelected: boolean;
  isUsed?: boolean;
  viewMode: MediaViewMode;
  onSelect: (event?: React.MouseEvent | React.KeyboardEvent) => void;
  onDelete: () => void;
  onReplace: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAddToTimeline: () => void;
  /** Double-click / Enter: load the item in the Source monitor. */
  onOpenInSource: () => void;
  onKieAI?: () => void;
  onRetryKieAI?: () => void;
}> = ({
  item,
  isSelected,
  isUsed = false,
  viewMode,
  onSelect,
  onDelete,
  onReplace,
  onDragStart,
  onAddToTimeline,
  onOpenInSource,
  onKieAI,
  onRetryKieAI,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const audioPeaks = useMediaAudioPeaks(item, viewMode !== "list");
  const thumbnailState = useThumbnailState(item);
  const copyCredits = () => {
    if (!item.metadata.stockSource) return;
    void navigator.clipboard.writeText(stockCreditText(item.metadata.stockSource)).then(
      () => toast.success("Credits copied"),
      () => toast.warning("Could not copy credits", stockCreditText(item.metadata.stockSource!)),
    );
  };

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

  const fileSizeLabel = formatMediaFileSize(getMediaFileSize(item));

  const iconColor = item.type === "audio"
    ? "text-primary/50"
    : item.type === "image"
      ? "text-primary/50"
      : "text-status-info/50";

  const borderClass = item.kieaiError
    ? "border-red-500 ring-1 ring-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
    : item.isPending
    ? "border-primary ring-1 ring-primary shadow-glow"
    : item.isPlaceholder
      ? "border-yellow-500 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]"
      : isSelected
        ? "border-accent ring-1 ring-accent/40 shadow-sm"
        : "border-border hover:border-border-strong";

  // --- List view ---
  if (viewMode === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Select media ${item.name}`}
        aria-pressed={isSelected}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpenInSource(); } else if (e.key === " ") { e.preventDefault(); onSelect(); } }}
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onOpenInSource(); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 cursor-pointer transition-all group ${borderClass}`}
      >
        {/* Small thumbnail */}
        <div className="w-12 h-8 rounded-md bg-bg-2 relative overflow-hidden flex-shrink-0">
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
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
            className={`text-[12px] truncate font-medium ${isSelected ? "text-accent" : "text-fg-2"}`}
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-fg-muted">
            {item.metadata?.duration && <span>{formatDuration(item.metadata.duration)}</span>}
            {item.metadata?.duration && formatResolution() && <span>•</span>}
            {formatResolution() && <span>{formatResolution()}</span>}
            {(item.metadata?.duration || formatResolution()) && fileSizeLabel && <span>•</span>}
            {fileSizeLabel && <span>{fileSizeLabel}</span>}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.metadata.stockSource && <ShadcnButton size="sm" variant="ghost" onClick={event => { event.stopPropagation(); copyCredits(); }}>Copy credits</ShadcnButton>}
            {item.kieaiError ? (
              <PanelIconButton
                label="Retry generation"
                icon={<RefreshCw size={12} className="text-red-400" />}
                onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
                className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
              />
            ) : item.isPending ? (
              <div className="p-1" title="Generating…">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : item.isPlaceholder ? (
              <>
                <PanelIconButton
                  label="Replace asset"
                  icon={<RefreshCw size={12} className="text-yellow-500" />}
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  className="p-1 bg-yellow-500/20 rounded hover:bg-yellow-500/40 transition-colors"
                />
                <PanelIconButton
                  label="Delete"
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            ) : (
              <>
                {item.type === "image" && onKieAI && (
                  <PanelIconButton
                    label="Create with KieAI"
                    icon={<Sparkles size={12} className="text-primary" />}
                    onClick={(e) => { e.stopPropagation(); onKieAI(); }}
                    className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                  />
                )}
                <PanelIconButton
                  label="Add to timeline"
                  icon={<Plus size={12} className="text-primary" />}
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                  className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                />
                <PanelIconButton
                  label="Delete"
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            )}
          </div>
        )}

        {isSelected && (
          <div className="w-2 h-2 bg-accent rounded-full shadow-sm flex-shrink-0" />
        )}
      </div>
    );
  }

  // --- Grid view (large & small) ---
  const thumbnailIconSize = viewMode === "small" ? 16 : 24;

  return (
    <div className="workspace-media-tile group relative flex flex-col">
      {/* Thumbnail container */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Select media ${item.name}`}
        aria-pressed={isSelected}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpenInSource(); } else if (e.key === " ") { e.preventDefault(); onSelect(); } }}
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpenInSource();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`workspace-media-thumbnail bg-bg-2 border relative group cursor-pointer transition-all overflow-hidden ${borderClass}`}
      >
        {/* Thumbnail or placeholder */}
        {item.type === "video" && <PreviewProxyBadge mediaId={item.id} />}
        {item.type === "video" && <ProxyStateBadge mediaId={item.id} />}
        {item.type === "audio" && audioPeaks.length > 0 && !item.isPlaceholder ? (
          <div className="workspace-media-audio-wave" data-testid="media-audio-wave" aria-hidden="true">
            {audioPeaks.map((amplitude, i) => (
              <i key={i} style={{ height: `${Math.max(6, Math.min(100, amplitude * 100))}%` }} />
            ))}
          </div>
        ) : item.isPlaceholder && !item.isPending && !item.kieaiError ? (
          <>
            {(item.thumbnailUrl || thumbnailState.imageUrl) && (
              <img
                src={item.thumbnailUrl || thumbnailState.imageUrl || undefined}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            )}
            <div
              className={`workspace-media-offline${item.thumbnailUrl || thumbnailState.imageUrl ? " has-thumbnail" : ""}`}
              data-testid="media-offline-tile"
              aria-label={`${item.name}: media offline`}
            >
              <Icon size={thumbnailIconSize} />
              <span>Media offline</span>
            </div>
          </>
        ) : item.thumbnailUrl || thumbnailState.imageUrl ? (
          <img
            src={item.thumbnailUrl || thumbnailState.imageUrl || undefined}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : thumbnailState.waiting ? (
          <div className="workspace-media-skeleton" data-testid="media-thumbnail-skeleton" aria-label="Generating thumbnail" role="img" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-2">
            <Icon size={thumbnailIconSize} className={iconColor} />
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
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-primary rounded text-[8px] text-primary-foreground font-bold flex items-center gap-1">
            <div className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            AI
          </div>
        )}

        {/* Missing Asset Badge */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] text-black font-bold flex items-center gap-1">
            <AlertTriangle size={10} />
            {desktopIngestAvailable() ? "Offline" : "Missing"}
          </div>
        )}

        {/* Duration badge on thumbnail */}
        {(item.type === "image" || item.metadata.duration > 0) && (
          <div className="workspace-media-duration" data-testid={item.raw ? "raw-badge" : undefined} title={item.raw ? `Camera RAW (${item.raw.format.toUpperCase()})` : undefined}>
            {item.raw ? "RAW" : item.type === "image" ? "IMG" : formatDuration(item.metadata.duration)}
          </div>
        )}

        {isUsed && !item.isPlaceholder && !item.isPending && !item.kieaiError && (
          <span className="workspace-media-used" aria-label="Used in timeline" />
        )}

        {(item.label || item.subclip) && (
          <div className="absolute bottom-1 left-1 flex items-center gap-1 rounded-[3px] bg-black/60 px-1 py-0.5" data-testid="media-badges">
            {item.label && <LabelChip label={item.label} />}
            {item.subclip && <Scissors size={10} className="text-accent" aria-label="Subclip" />}
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
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {/* Warning icon overlay for placeholders */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-yellow-500/50" />
          </div>
        )}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full shadow-sm" />
        )}
      </div>

      {/* Filename below thumbnail */}
      <div
        className="workspace-media-filename truncate text-fg-2"
        title={item.name}
      >
        {item.name}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ShadcnButton variant="secondary" size="icon" className="workspace-media-actions"
            aria-label={`Media actions for ${item.name}`}>
            <MoreHorizontal size={16} />
          </ShadcnButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.kieaiError ? (
            <DropdownMenuItem disabled={!onRetryKieAI} onSelect={onRetryKieAI}>
              <RefreshCw size={14} />Retry generation
            </DropdownMenuItem>
          ) : item.isPending ? (
            <DropdownMenuItem disabled>Generation in progress…</DropdownMenuItem>
          ) : item.isPlaceholder ? (
            <DropdownMenuItem onSelect={onReplace}><RefreshCw size={14} />Replace asset</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={onOpenInSource}><Plus size={14} />Open in Source monitor</DropdownMenuItem>
              <DropdownMenuItem onSelect={onAddToTimeline}><Plus size={14} />Add to timeline</DropdownMenuItem>
              {item.type === "image" && onKieAI && (
                <DropdownMenuItem onSelect={onKieAI}><Sparkles size={14} />Create with KieAI</DropdownMenuItem>
              )}
            </>
          )}
          {item.metadata.stockSource && <DropdownMenuItem onSelect={copyCredits}>Copy credits</DropdownMenuItem>}
          <MediaOrganizeItems item={item} kind="dropdown" />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete}><Trash2 size={14} />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const LoadingIndicator: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-bg-1/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
    <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
    <span className="font-normal block text-sm text-fg-2">{message}</span>
  </div>
);

type MediaOwner = { projectId: string; executor: ActionExecutorLike };
const ownsMediaSession = (owner: MediaOwner) => {
  const current = useProjectStore.getState();
  return current.project.id === owner.projectId && current.actionExecutor === owner.executor;
};

// Observe each published project, including reused track containers, but retain
// the visible membership when only clip transforms or other unrelated data change.
function createUsedMediaSelector() {
  let previousProject: Project | undefined;
  let previous = new Set<string>();
  return ({ project }: { project: Project }) => {
    if (previousProject === project) return previous;
    previousProject = project;
    const used = new Set<string>();
    for (const track of project.timeline.tracks) for (const clip of track.clips) used.add(clip.mediaId);
    if (used.size === previous.size && [...used].every(id => previous.has(id))) return previous;
    return previous = used;
  };
}

interface MediaRowHandlers {
  select: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void;
  remove: (id: string) => void;
  replace: (id: string) => void;
  dragStart: (e: React.DragEvent, item: MediaItem) => void;
  addToTimeline: (item: MediaItem) => void;
  openInSource: (id: string) => void;
  kieAI: (item: MediaItem) => void;
  retryKieAI: (item: MediaItem) => void;
}

/** Memoised bin cell: stable handlers + primitive props so unrelated store changes skip all 400 cells. */
const MediaThumbnailRow = React.memo(function MediaThumbnailRow({
  item,
  isSelected,
  isUsed,
  handlers,
}: {
  item: MediaItem;
  isSelected: boolean;
  isUsed: boolean;
  handlers: MediaRowHandlers;
}) {
  return (
    <MediaThumbnail
      item={item}
      isSelected={isSelected}
      isUsed={isUsed}
      viewMode="large"
      onSelect={(event) => handlers.select(item.id, event)}
      onDelete={() => handlers.remove(item.id)}
      onReplace={() => handlers.replace(item.id)}
      onDragStart={(e) => handlers.dragStart(e, item)}
      onAddToTimeline={() => handlers.addToTimeline(item)}
      onOpenInSource={() => handlers.openInSource(item.id)}
      onKieAI={item.type === "image" && !item.isPending && !item.kieaiError ? () => handlers.kieAI(item) : undefined}
      onRetryKieAI={item.kieaiError && item.kieaiTaskId ? () => handlers.retryKieAI(item) : undefined}
    />
  );
});

export const AssetsPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeTab = useEditorWorkspaceStore((s) => s.section);
  const mobileCaptionsOpen = useEditorWorkspaceStore(s => s.mobileCaptionsOpen);
  const [textMounted, setTextMounted] = useState(activeTab === "text" || mobileCaptionsOpen);
  useEffect(() => { if (activeTab === "text" || mobileCaptionsOpen) setTextMounted(true); }, [activeTab, mobileCaptionsOpen]);
  const setActiveTabRaw = useEditorWorkspaceStore((s) => s.setSection);
  const [mediaSource, setMediaSource] = useState("project");
  const audioSource = useEditorWorkspaceStore((s) => s.audioSource);
  const setAudioSource = useEditorWorkspaceStore((s) => s.setAudioSource);
  const searchQuery = useProjectPanelStore((s) => s.query);
  const setSearchQuery = useProjectPanelStore((s) => s.setQuery);
  const findNonce = useProjectPanelStore((s) => s.findNonce);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!findNonce) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [findNonce]);
  const panelView = useProjectPanelStore((s) => s.view);
  const panelSort = useProjectPanelStore((s) => s.sort);
  const setPanelSort = useProjectPanelStore((s) => s.setSort);
  const revealNonce = useProjectPanelStore((s) => s.revealNonce);
  const revealMediaId = useProjectPanelStore((s) => s.revealMediaId);
  const mediaSelectionCount = useMediaSelectionCount();
  const [mediaFilter, setMediaFilter] = useState("all");
  const ttsHasUnsaved = useTtsAudioStore((s) => s.generatedAudio !== null && !s.isAudioSaved);

  const setActiveTab = useCallback((tab: AssetsTab) => {
    if (activeTab === "ai" && tab !== "ai" && ttsHasUnsaved) {
      toast.warning("Unsaved audio discarded", "Save to media or download next time to keep it.");
    }
    setActiveTabRaw(tab);
  }, [activeTab, ttsHasUnsaved, setActiveTabRaw]);

  const openVoiceOver = () => {
    setAudioSource("voiceover");
    setActiveTab("audio");
  };

  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showAspectRatioDialog, setShowAspectRatioDialog] = useState(false);
  const [scaleGraphicsOnMatch, setScaleGraphicsOnMatch] = useState(true);
  const [aspectRatioDialogData, setAspectRatioDialogData] = useState<{
    videoWidth: number;
    videoHeight: number;
    itemToAdd: MediaItem;
  } | null>(null);
  const [generatingBackground, setGeneratingBackground] = useState<
    string | null
  >(null);


  // KieAI image generation dialog
  const [kieaiDialog, setKieaiDialog] = useState<{ file: File; previewUrl: string | null } | null>(null);

  const imageOpenRequest = useRef<symbol | null>(null);
  const imageDialogMounted = useRef(true);
  useEffect(() => {
    imageDialogMounted.current = true;
    return () => { imageDialogMounted.current = false; imageOpenRequest.current = null; };
  }, []);
  const handleCloseKieAI = useCallback(() => {
    imageOpenRequest.current = null;
    setKieaiDialog(null);
  }, []);

  // Project store
  const {
    projectId,
    projectWidth,
    projectHeight,
    actionExecutor,
    mediaItems,
    importMedia,
    deleteMedia,
    replaceMediaAsset,
    updateSettings,
    hasFrameGraphics,
    setKieAIItemState,
  } = useProjectStore(useShallow((state) => ({
    projectId: state.project.id,
    projectWidth: state.project.settings.width,
    projectHeight: state.project.settings.height,
    hasFrameGraphics: (state.project.textClips?.length ?? 0) + (state.project.shapeClips?.length ?? 0) + (state.project.svgClips?.length ?? 0) > 0,
    actionExecutor: state.actionExecutor,
    mediaItems: state.project.mediaLibrary.items,
    importMedia: state.importMedia,
    deleteMedia: state.deleteMedia,
    replaceMediaAsset: state.replaceMediaAsset,
    updateSettings: state.updateSettings,
    setKieAIItemState: state.setKieAIItemState,
  })));
  const mediaSizeLabel = useMemo(() => getMediaLibrarySizeLabel(mediaItems), [mediaItems]);
  // Only media-bin selection matters here. A string selector keeps the panel (and its
  // hundreds of thumbnails) out of the render path when a timeline clip is selected.
  const mediaIdSet = useMemo(() => new Set(mediaItems.map((item) => item.id)), [mediaItems]);
  const selectedMediaKey = useUIStore((state) => {
    let key = "";
    for (const item of state.selectedItems) if (mediaIdSet.has(item.id)) key += `${item.id}\u0000`;
    return key;
  });
  const selectedMediaIds = useMemo(() => new Set(selectedMediaKey.split("\u0000").filter(Boolean)), [selectedMediaKey]);
  const selectUsedMediaIds = useMemo(createUsedMediaSelector, []);
  const usedMediaIds = useProjectStore(selectUsedMediaIds);
  useEffect(() => {
    if (revealMediaId) {
      setMediaSource("project");
      // The grid scrolls the revealed tile into view; the list view does it itself.
      requestAnimationFrame(() => {
        document.querySelector(`[data-reveal-id="${CSS.escape(revealMediaId)}"]`)?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [revealNonce, revealMediaId]);
  const mediaImportRequest = useRef<MediaOwner | null>(null);
  const backgroundRequest = useRef<MediaOwner | null>(null);
  const pendingImportBatches = useRef<PendingImportBatch<MediaOwner>[]>([]);
  useEffect(() => {
    mediaImportRequest.current = null;
    pendingImportBatches.current = [];
    backgroundRequest.current = null;
    setIsImporting(false);
    setImportProgress("");
    setGeneratingBackground(null);
    return () => {
      mediaImportRequest.current = null;
      pendingImportBatches.current = [];
      backgroundRequest.current = null;
    };
  }, [projectId, actionExecutor]);

  // KieAI store
  const retryTask = useKieAIStore((state) => state.retryTask);

  // UI store
  const { select, startDrag, openModal } = useUIStore(useShallow((state) => ({
    select: state.select,
    startDrag: state.startDrag, openModal: state.openModal,
  })));

  // Count missing assets
  const missingAssetsCount = useMemo(() => mediaItems.filter(
    (item) => item.isPlaceholder,
  ).length, [mediaItems]);

  // The visible slice: current bin (or a library-wide search), the type chips
  // and the missing toggle, sorted by the chosen column.
  const itemFilter = useCallback(
    (item: MediaItem) =>
      (!showOnlyMissing || !!item.isPlaceholder) && (mediaFilter === "all" || item.type === mediaFilter),
    [showOnlyMissing, mediaFilter],
  );
  const panelData = useProjectPanelData(itemFilter);
  const filteredItems = panelData.items;
  const sortOrder: "none" | "asc" | "desc" =
    panelSort?.column === "name" ? panelSort.direction : "none";
  const cycleNameSort = useCallback(
    () => setPanelSort(!panelSort || panelSort.column !== "name" ? { column: "name", direction: "asc" } : panelSort.direction === "asc" ? { column: "name", direction: "desc" } : null),
    [panelSort, setPanelSort],
  );

  // A batch belongs to the editing session that opened the picker or accepted
  // the drop. Later files and progress cannot spill into a replacement project.
  const handleFileImport: (files: FileList | readonly File[] | null, dropOwner?: MediaOwner) => Promise<void> = useCallback(
    async (files: FileList | readonly File[] | null, dropOwner?: MediaOwner): Promise<void> => {
      if (!files?.length) return;
      // Snapshot now: the picker clears its FileList as soon as the change handler returns.
      const all = Array.from(files);
      // Premiere projects are timelines, not media: the first one opens the import dialog (one undoable import).
      const premiere = all.find((file) => isPremiereProjectFile(file.name));
      if (premiere) void openTimelineFileForImport(premiere);
      // Caption files (SRT, VTT, SCC, MCC, STL, TTML...) are not media: they become caption cues, one undo step.
      const captions = all.filter((file) => isCaptionFileName(file.name));
      if (captions.length) void import("../../services/caption-file-import").then((m) => m.importCaptionFiles(captions));
      const picked = all.filter((file) => !isPremiereProjectFile(file.name) && !isCaptionFileName(file.name));
      if (picked.length === 0) return;
      const current = useProjectStore.getState();
      const owner = dropOwner ?? { projectId: current.project.id, executor: current.actionExecutor };
      if (!ownsMediaSession(owner)) return;
      // A batch picked while another is importing waits its turn; it is not discarded.
      if (mediaImportRequest.current) {
        enqueueImportBatch(pendingImportBatches.current, owner, picked);
        return;
      }
      mediaImportRequest.current = owner;
      const owns = () => mediaImportRequest.current === owner && ownsMediaSession(owner);
      // Numbered .dng frames are a CinemaDNG sequence: baked into one video clip. Everything else imports one by one.
      const grouped = groupCinemaDng(picked);
      const sequences: typeof grouped.sequences = [];
      const fileArray = [...grouped.stills, ...grouped.others];
      // Numbered stills from a stills camera (IMG_0001.dng...) are not video: only frames that carry CinemaDNG tags bake.
      for (const sequence of grouped.sequences) {
        if (await looksLikeCinemaDngFrame(sequence.frames[0])) sequences.push(sequence);
        else fileArray.push(...sequence.frames);
      }
      setIsImporting(true);
      try {
        for (const sequence of sequences) {
          if (!owns()) return;
          const result = await importCinemaDngSequence(sequence.frames, sequence.prefix, {
            onProgress: (p) => {
              if (owns()) setImportProgress(`CinemaDNG ${sequence.prefix}: ${p.stage} frame ${Math.min(p.frame + 1, p.total)}/${p.total}`);
            },
          });
          if (!result.success) toast.error("CinemaDNG sequence not imported", result.error);
        }
        for (let i = 0; i < fileArray.length; i++) {
          if (!owns()) return;
          const file = fileArray[i];
          setImportProgress(`Importing ${file.name} (${i + 1}/${fileArray.length})...`);
          const imported = await importMedia(file, stage => {
            if (owns()) setImportProgress(`${stage} · ${file.name} (${i + 1}/${fileArray.length})`);
          });
          if (imported?.success && imported.actionId && owns()) void import("../../services/xmp-import").then((m) => m.applyImportedXmp(imported.actionId!, file));
          if (!owns()) return;
        }
      } catch (error) {
        console.error("Import failed:", error);
      } finally {
        if (mediaImportRequest.current === owner) {
          mediaImportRequest.current = null;
          setIsImporting(false);
          setImportProgress("");
          const next = takeNextImportBatch(pendingImportBatches.current, ownsMediaSession);
          if (next) void handleFileImport(next.files, next.owner);
        }
      }
    },
    [importMedia],
  );

  // Handle drag and drop import — capture FileSystemFileHandle for each dropped file
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Snapshot dataTransfer synchronously — it becomes inert after the first await.
      const droppedFiles = Array.from(e.dataTransfer.files);
      const current = useProjectStore.getState();
      const dropOwner = { projectId: current.project.id, executor: current.actionExecutor };
      const handlePromises =
        typeof DataTransferItem !== "undefined" && "getAsFileSystemHandle" in DataTransferItem.prototype
          ? Array.from(e.dataTransfer.items)
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
              })
          : [];

      await Promise.all(handlePromises);
      void handleFileImport(droppedFiles, dropOwner);
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
    (
      itemId: string,
      event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
      ordered?: readonly string[],
    ) => {
      const ui = useUIStore.getState();
      if (useProjectPanelStore.getState().selectedBinIds.length) useProjectPanelStore.getState().setSelectedBins([]);
      if (event?.shiftKey && ordered) {
        const anchor = ordered.indexOf(ui.lastSelectedItem?.id ?? "");
        const target = ordered.indexOf(itemId);
        if (anchor >= 0 && target >= 0) {
          const [from, to] = anchor < target ? [anchor, target] : [target, anchor];
          ui.selectMultiple(ordered.slice(from, to + 1).map((id) => ({ type: "clip" as const, id })));
          return;
        }
      }
      if (event?.metaKey || event?.ctrlKey) {
        if (ui.isSelected(itemId)) ui.deselect(itemId);
        else ui.select({ type: "clip", id: itemId }, true);
        return;
      }
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
      const origin = useProjectStore.getState();
      const source = origin.project.mediaLibrary.items.find(item => item.id === itemId);
      const isCurrent = () => {
        const state = useProjectStore.getState();
        return state.project.id === origin.project.id && state.actionExecutor === origin.actionExecutor
          && state.project.mediaLibrary.items.find(item => item.id === itemId) === source
          && !useUIStore.getState().exportState.isExporting && !useTimelineStore.getState().playbackLockedReason;
      };
      if (!source || !isCurrent()) return;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = `video/*,audio/*,image/*,.mxf,${RAW_FILE_ACCEPT}`;
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file && isCurrent()) {
          setIsImporting(true);
          setImportProgress(`Replacing asset...`);
          try {
            const result = await replaceMediaAsset(itemId, file);
            if (!result.success) toast.error("Could not replace media", result.error?.message);
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
    const origin = useProjectStore.getState();
    const isCurrent = () => {
      const current = useProjectStore.getState();
      return current.project.id === origin.project.id && current.actionExecutor === origin.actionExecutor
        && !useUIStore.getState().exportState.isExporting && !useTimelineStore.getState().playbackLockedReason;
    };
    if (!isCurrent()) return;
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    } catch {
      return; // user cancelled
    }

    if (!isCurrent()) return;
    const project = origin.project;
    const placeholders = project.mediaLibrary.items.filter((item) => item.isPlaceholder);
    if (placeholders.length === 0) return;

    // Persist the directory handle for future auto-restore
    try { await saveDirectoryHandle(project.id, dirHandle); } catch { /* best-effort */ }
    if (!isCurrent()) return;

    // Build a name:size → {File, handle} map for reliable matching
    const fileMap = new Map<string, { file: File; handle: FileSystemFileHandle }>();
    const entries = (dirHandle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
    try {
      for await (const [, fh] of entries) {
        if (!isCurrent()) return;
        if ((fh as FileSystemHandle).kind === "file") {
          const fileHandle = fh as FileSystemFileHandle;
          try {
            const file = await fileHandle.getFile();
            if (!isCurrent()) return;
            fileMap.set(`${file.name.toLowerCase()}:${file.size}`, { file, handle: fileHandle });
          } catch { /* One unavailable file must not prevent the remaining matches. */ }
        }
      }
    } catch {
      if (isCurrent()) toast.error("Could not read this folder", "Choose it again or relink the missing assets individually.");
      return;
    }

    setIsImporting(true);
    let linked = 0;
    for (const item of placeholders) {
      if (!isCurrent()) break;
      if (useProjectStore.getState().project.mediaLibrary.items.find(current => current.id === item.id) !== item) continue;
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
          if (!isCurrent()) break;
          if (useProjectStore.getState().project.mediaLibrary.items.find(current => current.id === item.id) !== item) continue;
          if ((await replaceMediaAsset(item.id, entry.file, dirHandle.name)).success) linked++;
        } catch (err) {
          console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
        }
      }
    }
    setIsImporting(false);
    setImportProgress("");
    if (!isCurrent()) return;

    if (linked > 0) {
      toast.success(`Relinked ${linked} of ${placeholders.length} asset${placeholders.length !== 1 ? "s" : ""}`);
    } else {
      toast.error("No assets relinked", "Check that the files match the missing assets and can be decoded. You can also relink each asset individually.");
    }
  }, [replaceMediaAsset]);

  // Handle drag start for timeline placement
  const handleItemDragStart = useCallback(
    (e: React.DragEvent, item: MediaItem) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({ mediaId: item.id }),
      );
      writeMediaDrag(e.dataTransfer, item.id);
      e.dataTransfer.effectAllowed = "copyMove";
      startDrag("media", { mediaId: item.id, mediaType: item.type });
    },
    [startDrag],
  );

  const addMediaToTimeline = useCallback(async (item: MediaItem) => {
    const store = useProjectStore.getState();
    const target = store.project.timeline.tracks.find((track) => !track.locked && (item.type === "audio" ? track.role === "dialogue" : track.name === "Main"));
    const result = await store.placeMediaClip(item.id, target?.id, useTimelineStore.getState().playheadPosition);
    if (!result.success) toast.error("Could not add media", result.error?.message ?? "Try dropping it on a different track.");
  }, []);

  const handleConfirmAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    await updateSettings({
      width: aspectRatioDialogData.videoWidth,
      height: aspectRatioDialogData.videoHeight,
    }, {
      scaleGraphics: scaleGraphicsOnMatch,
    });

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, updateSettings, addMediaToTimeline, scaleGraphicsOnMatch]);

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
        const { width: videoWidth, height: videoHeight } = interpretedDisplaySize(item);
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
      if (backgroundRequest.current || useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return;
      const current = useProjectStore.getState();
      const owner = { projectId: current.project.id, executor: current.actionExecutor };
      backgroundRequest.current = owner;
      const owns = () => backgroundRequest.current === owner && ownsMediaSession(owner)
        && !useUIStore.getState().exportState.isExporting && !useTimelineStore.getState().playbackLockedReason;
      setGeneratingBackground(preset.id);
      try {
        const blob = await generateBackgroundBlob(preset, projectWidth, projectHeight);
        if (!owns()) return;
        const file = new File([blob], `${preset.name}_${projectWidth}x${projectHeight}.png`, { type: "image/png" });
        const result = await importMedia(file);
        if (owns() && result.success && result.actionId) {
          await useProjectStore.getState().addClipToNewTrack(result.actionId);
        }
      } catch (error) {
        console.error("Failed to generate background:", error);
      } finally {
        if (backgroundRequest.current === owner) {
          backgroundRequest.current = null;
          setGeneratingBackground(null);
        }
      }
    },
    [importMedia, projectWidth, projectHeight],
  );

  // Open KieAI dialog for an image asset
  const handleOpenKieAI = useCallback(async (item: MediaItem) => {
    const owner = useProjectStore.getState();
    const request = Symbol();
    imageOpenRequest.current = request;
    const ownsSource = () => {
      const current = useProjectStore.getState();
      const source = current.project.mediaLibrary.items.find(media => media.id === item.id);
      return imageDialogMounted.current && imageOpenRequest.current === request && current.project.id === owner.project.id && current.actionExecutor === owner.actionExecutor && source !== undefined && source.blob === item.blob && source.sourceFile === item.sourceFile;
    };
    try {
      const blob = await loadMediaBlob(item.id);
      if (!ownsSource()) return;
      if (!blob) { toast.error("Asset not found", "Cannot load the image data for this asset."); return; }
      const mimeType = blob.type || (item.name.match(/\.png$/i) ? "image/png" : "image/jpeg");
      const file = new File([blob], item.name, { type: mimeType });
      setKieaiDialog({ file, previewUrl: item.thumbnailUrl });
    } catch (error) {
      if (ownsSource()) toast.error("Failed to open KieAI", error instanceof Error ? error.message : "Unknown error");
    }
  }, []);

  const handleRetryKieAI = useCallback((item: MediaItem) => {
    if (!item.kieaiTaskId) return;
    // Reset error state and re-activate polling
    setKieAIItemState(item.id, true, false);
    retryTask(item.kieaiTaskId);
  }, [retryTask, setKieAIItemState]);

  // Latest-callback bridge: the handlers object keeps one identity for the panel's lifetime.
  const rowCallbacks = {
    select: handleSelectItem, remove: handleDeleteItem, replace: handleReplaceAsset,
    dragStart: handleItemDragStart, addToTimeline: handleAddToTimeline,
    openInSource: openInSourceMonitor, kieAI: handleOpenKieAI, retryKieAI: handleRetryKieAI,
  };
  const rowCallbacksRef = useRef(rowCallbacks);
  const filteredItemsRef = useRef(filteredItems);
  filteredItemsRef.current = filteredItems;
  rowCallbacksRef.current = rowCallbacks;
  const mediaRowHandlers = useMemo<MediaRowHandlers>(() => ({
    select: (id, event) => rowCallbacksRef.current.select(id, event, filteredItemsRef.current.map((i) => i.id)),
    remove: (id) => { void rowCallbacksRef.current.remove(id); },
    replace: (id) => { void rowCallbacksRef.current.replace(id); },
    dragStart: (e, item) => rowCallbacksRef.current.dragStart(e, item),
    addToTimeline: (item) => { void rowCallbacksRef.current.addToTimeline(item); },
    openInSource: (id) => { void rowCallbacksRef.current.openInSource(id); },
    kieAI: (item) => { void rowCallbacksRef.current.kieAI(item); },
    retryKieAI: (item) => rowCallbacksRef.current.retryKieAI(item),
  }), []);

  const renderSectionContent = (tab: AssetsTab): React.ReactNode => {
    switch (tab) {
      case "media":
        return (
          <div
            className="workspace-media-panel flex min-h-0 flex-1 flex-col"
            data-testid="project-panel"
            onKeyDownCapture={(event) => {
              // Find (Cmd/Ctrl+F) inside the Project panel: focus the search across every metadata column.
              if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
                event.preventDefault();
                event.stopPropagation();
                useProjectPanelStore.getState().setSearchColumn("all");
                useProjectPanelStore.getState().requestFind();
              }
            }}
          >
            <WorkspaceTabs label="Media sources" value={mediaSource} onChange={(value) => {
              setMediaSource(value);
            }} options={[{value:"project",label:<>Project {mediaItems.length > 0 && <span className="workspace-count">{mediaItems.length}</span>}</>},{value:"stock",label:"Stock"},{value:"recordings",label:"Recordings"}]} />
            <div className="flex flex-col flex-1 min-h-0" {...workspaceTabPanel("Media sources",mediaSource)}>{mediaSource === "stock" ? <WorkspaceStockPanel backgrounds={BACKGROUND_PRESETS} onImportBackground={handleImportBackground} generatingBackground={generatingBackground} /> : mediaSource === "recordings" ? <RecordingsPanel items={mediaItems} onVoiceOver={openVoiceOver} onRecord={() => openModal("recorder")} onAddToTimeline={(item) => handleAddToTimeline(item)} onOpenInSource={(item) => openInSourceMonitor(item.id)} /> : <>
            <div className="workspace-media-browser flex flex-col shrink-0">
              <div className="workspace-media-toolbar flex gap-1.5">
                <label className="workspace-search"><MediaLibraryIcon name="search" /><Input ref={searchInputRef} aria-label="Search media" placeholder="Search media" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
                <ShadcnButton variant="secondary" className="h-[30px] shrink-0 px-2.5 text-[13px] gap-1.5" aria-label="Import media" onClick={triggerFileInput}><MediaLibraryIcon name="import" />Import</ShadcnButton>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <ShadcnButton variant="secondary" className="h-[30px] shrink-0 gap-1 px-2 text-xs"><MediaLibraryIcon name="record" />Record</ShadcnButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={openVoiceOver}><AudioLibraryIcon name="voiceover" />Record voice-over</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openModal("recorder")}><MediaLibraryIcon name="record-start" />Record screen or camera</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="workspace-chips">{[["all","All"],["video","Video"],["audio","Audio"],["image","Images"]].map(([value,label]) => <ShadcnButton key={value} variant="ghost" aria-pressed={mediaFilter===value} onClick={() => setMediaFilter(value)}>{label}</ShadcnButton>)}</div>
            </div>
            <ProjectPanelBar data={panelData} selectionCount={mediaSelectionCount} />
            <ProxyIngestPanel />
            <SequencesSection
              data={panelData}
              trailing={missingAssetsCount > 0 ? (
                <div className="flex min-w-0 items-center gap-1" data-testid="missing-assets-bar">
                  <PanelButton
                    label="Show Only Missing Assets"
                    onClick={() => setShowOnlyMissing(!showOnlyMissing)}
                    className={`flex h-5 min-w-0 items-center gap-1 rounded-[4px] border px-1.5 text-[10.5px] font-medium normal-case tracking-normal transition-all ${
                      showOnlyMissing
                        ? "bg-yellow-500/10 border-yellow-500 text-yellow-500"
                        : "bg-background-tertiary border-border text-text-secondary hover:border-yellow-500/50"
                    }`}
                  >
                    <AlertTriangle size={10} className="shrink-0" />
                    <span>Missing</span>
                    <span className="shrink-0 rounded-full bg-yellow-500 px-1 text-[9.5px] font-bold text-black">{missingAssetsCount}</span>
                  </PanelButton>
                  <PanelButton
                    label="Relink from Folder"
                    onClick={desktopIngestAvailable() ? () => void relinkFromFolder("full") : handleRelinkFromFolder}
                    className="flex h-5 min-w-0 items-center gap-1 rounded-[4px] border border-yellow-500/40 bg-yellow-500/5 px-1.5 text-[10.5px] font-medium normal-case tracking-normal text-yellow-500 transition-all hover:bg-yellow-500/15"
                  >
                    <RefreshCw size={10} className="shrink-0" />
                    <span>Relink</span>
                  </PanelButton>
                </div>
              ) : null}
            />

            {panelView === "list" && mediaItems.length > 0 ? (
              <div
                className={`workspace-media-scroll flex min-h-0 flex-1 flex-col ${isDragOver ? "bg-accent-soft" : ""}`}
                data-testid="media-list-container"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                {filteredItems.length === 0 && panelData.visibleBins.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
                    {panelData.searching || mediaFilter !== "all" || showOnlyMissing ? "No matching media" : "This bin is empty"}
                  </div>
                ) : (
                  <MediaListView
                    data={panelData}
                    onSelectItem={(item, event, ordered) => handleSelectItem(item.id, event, ordered)}
                    onOpenInSource={(item) => openInSourceMonitor(item.id)}
                    onAddToTimeline={(item) => handleAddToTimeline(item)}
                    onDelete={(item) => handleDeleteItem(item.id)}
                    onDragStart={(event, item) => handleItemDragStart(event, item)}
                  />
                )}
              </div>
            ) : filteredItems.length > 0 || panelData.visibleBins.length > 0 ? (
              <MediaGridView
                data={panelData}
                className={isDragOver ? "bg-accent-soft" : ""}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                renderItem={(item) => (
                  <MediaItemContextMenu
                    item={item}
                    onOpenInSource={() => openInSourceMonitor(item.id)}
                    onAddToTimeline={() => handleAddToTimeline(item)}
                    onDelete={() => handleDeleteItem(item.id)}
                  >
                    <MediaThumbnailRow
                      item={item}
                      isSelected={selectedMediaIds.has(item.id)}
                      isUsed={usedMediaIds.has(item.id)}
                      handlers={mediaRowHandlers}
                    />
                  </MediaItemContextMenu>
                )}
                trailing={
                  <div className="flex flex-col">
                    <PanelButton
                      label="Add media"
                      onClick={triggerFileInput}
                      className="h-[78px] bg-bg-2 rounded-lg border border-dashed border-border hover:border-accent/50 hover:bg-accent-soft relative flex items-center justify-center cursor-pointer transition-all overflow-hidden group [&_svg]:size-5"
                    >
                      <div className="flex flex-col items-center gap-1.5">
                        <Upload size={20} className="text-fg-muted group-hover:text-accent transition-colors" />
                        <span className="text-[10px] text-fg-muted group-hover:text-accent transition-colors font-medium">Add media</span>
                      </div>
                    </PanelButton>
                  </div>
                }
                footer={mediaItems.filter((item) => item.type === "video" && selectedMediaIds.has(item.id)).slice(0, 1).map((item) => (
                  <div key={item.id} className="mt-4"><PreviewProxyControls item={item} /></div>
                ))}
              >
                {isDragOver && (
                  <div className="absolute inset-4 border-2 border-dashed border-accent rounded-xl flex items-center justify-center bg-accent-soft pointer-events-none z-50 backdrop-blur-sm">
                    <div className="text-accent text-sm font-bold bg-bg-1 px-4 py-2 rounded-full shadow-lg">
                      Drop files to import
                    </div>
                  </div>
                )}
              </MediaGridView>
            ) : (
            <ScrollArea
              data-empty={filteredItems.length === 0 && mediaItems.length === 0}
              className={`workspace-media-scroll min-h-0 flex-1 ${isDragOver ? "bg-accent-soft" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="workspace-media-content px-[10px] pb-3 relative" data-empty={filteredItems.length === 0 && mediaItems.length === 0}>
                {filteredItems.length === 0 && panelData.visibleBins.length === 0 ? (
                  <>
                    <ShadcnButton variant="ghost" onClick={triggerFileInput} className="workspace-empty-bin w-full h-auto whitespace-normal" aria-label="Import Media">
                      <span><MediaLibraryIcon name="empty-upload" /></span><strong>{mediaItems.length ? (panelData.searching || mediaFilter !== "all" || showOnlyMissing ? "No matching media" : "This bin is empty") : "Drop video, audio or images"}</strong>
                      <p>MP4, MOV, WebM, MP3, WAV, PNG, JPG<br />Files stay on your device</p>
                    </ShadcnButton>
                    {!mediaItems.length && <div className="workspace-other-starts">
                      <h3>OTHER WAYS TO START</h3>
                      <ShadcnButton variant="secondary" className="workspace-start-link" onClick={() => openModal("recorder")}><span className="workspace-start-icon"><MediaLibraryIcon name="record-start" /></span><span>Record screen or camera<small>Webcam, screen, or both</small></span></ShadcnButton>
                      <ShadcnButton variant="secondary" className="workspace-start-link" onClick={() => setMediaSource("stock")}><span className="workspace-start-icon"><MediaLibraryIcon name="stock-start" /></span><span>Browse stock footage<small>Free clips, music and SFX</small></span></ShadcnButton>
                      <ShadcnButton variant="secondary" className="workspace-start-link" onClick={() => setActiveTab("recipes")}><span className="workspace-start-icon"><MediaLibraryIcon name="recipe-start" /></span><span>Start from a recipe<small>Podcast clip, montage, explainer</small></span></ShadcnButton>
                    </div>}
                  </>
                ) : null}

                {isDragOver && (
                  <div className="absolute inset-4 border-2 border-dashed border-accent rounded-xl flex items-center justify-center bg-accent-soft pointer-events-none z-50 backdrop-blur-sm">
                    <div className="text-accent text-sm font-bold bg-bg-1 px-4 py-2 rounded-full shadow-lg">
                      Drop files to import
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
            )}
            <div className="workspace-panel-footer"><span>{mediaItems.length ? `${mediaItems.length} ${mediaItems.length === 1 ? "item" : "items"}${mediaSizeLabel ? ` · ${mediaSizeLabel}` : ""}` : "No media yet"}</span>{<ShadcnButton variant="ghost" className="p-0 h-auto text-[11px] text-fg-muted" aria-label="Sort media" onClick={cycleNameSort}>{panelSort && panelSort.column !== "name" ? `Sort: ${panelSort.column} ${panelSort.direction === "asc" ? "↑" : "↓"}` : `Sort: ${sortOrder === "none" ? "Recent" : sortOrder === "asc" ? "A–Z" : "Z–A"} ▾`}</ShadcnButton>}</div>
            </>}</div>
          </div>
        );
      case "settings":
        return <WorkspaceSettingsPanel />;
      case "audio":
        return <div className="workspace-audio-panel flex flex-col h-full min-h-0"><WorkspaceTabs label="Audio sources" value={audioSource === "tts" ? "voiceover" : audioSource} onChange={setAudioSource} options={[{value:"music",label:"Music"},{value:"sfx",label:"Sound FX"},{value:"voiceover",label:"Voiceover"}]} /><div className="flex-1 min-h-0 overflow-auto" {...workspaceTabPanel("Audio sources",audioSource === "tts" ? "voiceover" : audioSource)}>{audioSource === "voiceover" ? <VoiceOverPanel /> : audioSource === "tts" ? <TextToSpeechPanel /> : <Suspense fallback={null}><MusicLibraryPanel source={audioSource === "sfx" ? "sfx" : "music"} /></Suspense>}</div><div className="workspace-audio-footer p-2.5 border-t border-border flex gap-2"><ShadcnButton variant="secondary" className="flex-1 h-8 text-xs" onClick={() => setAudioSource("voiceover")}><AudioLibraryIcon name="voiceover" className="workspace-audio-icon workspace-audio-voice-icon" />Voiceover</ShadcnButton><ShadcnButton variant="secondary" className="flex-1 h-8 text-xs" onClick={() => setAudioSource("tts")}><AudioLibraryIcon name="speech" className="workspace-audio-icon workspace-audio-speech-icon" />Text to speech</ShadcnButton></div></div>;
      case "graphics":
        return <Suspense fallback={null}><WorkspaceGraphicsPanel backgrounds={BACKGROUND_PRESETS} onImportBackground={handleImportBackground} generatingBackground={generatingBackground} /></Suspense>;
      case "text":
        return null; // The text workspace stays mounted below to preserve caption work.
      case "effects":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-bg-1">
            <EffectsPanel />
          </div>
        );
      case "transitions":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-bg-1">
            <TransitionsPanel />
          </div>
        );
      case "ai":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <React.Suspense fallback={panelFallback}><WorkspaceGeneratePanel /></React.Suspense>
          </div>
        );
      case "recipes":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <React.Suspense fallback={panelFallback}><WorkspaceRecipesPanel key={projectId} /></React.Suspense>
          </div>
        );
      case "markers":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <React.Suspense fallback={panelFallback}><MarkersPanel /></React.Suspense>
          </div>
        );
      case "browser":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <React.Suspense fallback={panelFallback}><MediaBrowserPanel /></React.Suspense>
          </div>
        );
      case "metadata":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <React.Suspense fallback={panelFallback}><MetadataPanel /></React.Suspense>
          </div>
        );
      case "comments":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <React.Suspense fallback={panelFallback}><CommentsPanel /></React.Suspense>
          </div>
        );
      case "versions":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <VersionsPanel key={projectId} />
          </div>
        );
      case "templates":
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-background-secondary content-area-fix">
            <TemplatesTab />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-tour="assets"
      className="workspace-assets w-full h-full bg-bg-1 overflow-hidden flex flex-row relative"
    >
      {/* ── Body: section content fills the remaining space ──── */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-bg-1 relative">
        {isImporting && (
          <LoadingIndicator message={importProgress || "Importing media..."} />
        )}

        <Input
          ref={fileInputRef}
          type="file"
          aria-label="Import media"
          accept={`video/*,audio/*,image/*,.mxf,.prproj,.srt,.vtt,.sbv,.ttml,.dfxp,.itt,.scc,.mcc,.stl,${RAW_FILE_ACCEPT}`}
          multiple
          className="hidden"
          onChange={(event) => {
            handleFileImport(event.target.files);
            event.target.value = "";
          }}
        />

        {/* Dynamic Section Content */}
        <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
          {renderSectionContent(activeTab)}
          {(textMounted || activeTab === "text" || mobileCaptionsOpen) && <div className="min-h-0 h-full flex-col" style={{ display: activeTab === "text" ? "flex" : "none" }}>
            <WorkspaceTextPanel presets={TEXT_STYLE_PRESETS} defaultStyle={DEFAULT_TITLE_STYLE} />
          </div>}
        </div>
      </div>

      <ProjectPanelDialogs />

      {aspectRatioDialogData && (
        <AspectRatioMatchDialog
          isOpen={showAspectRatioDialog}
          videoWidth={aspectRatioDialogData.videoWidth}
          videoHeight={aspectRatioDialogData.videoHeight}
          currentWidth={projectWidth}
          currentHeight={projectHeight}
          hasGraphics={hasFrameGraphics}
          scaleGraphics={scaleGraphicsOnMatch}
          onScaleGraphicsChange={setScaleGraphicsOnMatch}
          onConfirm={handleConfirmAspectRatioMatch}
          onCancel={handleCancelAspectRatioMatch}
        />
      )}

      {kieaiDialog && (
        <KieAIImageDialog
          open={true}
          onClose={handleCloseKieAI}
          sourceFile={kieaiDialog.file}
          previewUrl={kieaiDialog.previewUrl}
        />
      )}
    </div>
  );
};
