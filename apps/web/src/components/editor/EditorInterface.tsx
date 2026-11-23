import { TimelineImportDialog } from "./TimelineImportDialog";
import { InterchangeExportReportDialog } from "./InterchangeExportReportDialog";
import { InterchangeExportDialog } from "./InterchangeExportDialog";
import "./reference-workspace.css";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { Button, Button as ShadcnButton, Dialog, DialogContent, DialogTitle, ScrollArea } from "@openreel/ui";

import { BackgroundTasksIndicator } from "./BackgroundTasksPanel";
import { Toolbar } from "./Toolbar";
import { EditorActionRail } from "./EditorActionRail";
import { AssetsPanel } from "./AssetsPanel";
import { Preview } from "./Preview";
import { SourceMonitor } from "./SourceMonitor";
import { useSourceMonitorStore } from "../../stores/source-monitor-store";
import { InspectorPanel } from "./InspectorPanel";
import { Timeline } from "./Timeline";
import { useLatch } from "./use-latch";
import { PanelErrorBoundary } from "../ErrorBoundary";
import { useTourHostRequested } from "./tour/tour-launch";
import { useProjectStore, registerSmoothKeyframeRefresh } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useAudioChannelsStore } from "../../stores/audio-channels-store";
import {
  useDockSize,
  MIN_MEDIA_W, MAX_MEDIA_W, MIN_INSPECTOR_W, MAX_INSPECTOR_W, MIN_CHAT_W, MAX_CHAT_W, MIN_TIMELINE_VH, MAX_TIMELINE_VH,
} from "../../stores/workspace-layout-store";
import { WorkspaceSaveDialog } from "./WorkspaceSaveDialog";
import { ClipSpeedDialog } from "./ClipSpeedDialog";
import { ProjectLockBanner } from "./ProjectLockBanner";
import { MissingFontsBanner } from "./MissingFontsBanner";
import { applyPendingWorkspace } from "../../services/workspace-apply";
import { useTimelineStore } from "../../stores/timeline-store";
import { applySpatialInterpolationToClip } from "../../services/spatial-path-edit";
import type { SpatialInterpolationOp } from "@openreel/core";
import { copyKeyframeSet, pasteKeyframeSet, retargetCopiedKeyframes, applyKeyframeInterpolation, refreshSmoothKeyframesAfterEdit, type KeyframeInterpolationOp, type KeyframeInterpolationSide } from "@openreel/core";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useEditorInitialization } from "../../hooks/useEditorInitialization";
import { useCompactEditor } from "../../hooks/useCompactEditor";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { usePreviewProxyPreference } from "../../hooks/use-preview-proxy-preference";
import { startProxyIngest } from "../../services/proxy-ingest";
import { useMediaWaveforms } from "../../hooks/use-media-waveforms";
import { startAudioRackSync } from "../../services/audio-rack-sync";
import { startAudioOutputService } from "../../services/audio-output-service";
import { startLinkedCompHost } from "../../services/linked-comp-host";
import "./editor-responsive.css";

// Spotlight tours: loaded on the web build (first-run auto-start) or when a tour is requested; never on the desktop first-paint path.
const TourHost = React.lazy(() => import("./tour/TourHost"));
const KeyboardShortcutsOverlay = React.lazy(() =>
  import("./KeyboardShortcutsOverlay").then((module) => ({ default: module.KeyboardShortcutsOverlay })),
);
// The AI changes list pulls in the agent tool registry (editing-tools); it only shows with the AI chat open.
const ChangesPanel = React.lazy(() => import("./chat/ChangesPanel").then(module => ({ default: module.ChangesPanel })));
const ChatPanel = React.lazy(() =>
  import("./chat/ChatPanel").then((module) => ({ default: module.ChatPanel })),
);
const MobileEditorTools = React.lazy(() => import("./mobile/MobileEditorTools").then(module => ({ default: module.MobileEditorTools })));

const NO_SELECTED_ITEMS: never[] = [];

/** Retry a dynamic import once (stale chunk hash, flaky network) before surfacing the error. */
export const importWithRetry = <T,>(load: () => Promise<T>, delayMs = 400): Promise<T> =>
  load().catch(
    (): Promise<T> =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(load),
  );

const loadKeyframeEditorPanel = () =>
  importWithRetry(() => import("./KeyframeEditorPanel"));
const loadAudioMixer = () => importWithRetry(() => import("../audio-mixer"));
const loadMultiCameraDialog = () =>
  importWithRetry(() => import("./MultiCameraDialog"));
const loadMulticamMonitor = () => importWithRetry(() => import("./MulticamMonitor"));
const loadMulticamSourceDialog = () => importWithRetry(() => import("./MulticamSourceDialog"));
const MulticamMonitor = React.lazy(() =>
  loadMulticamMonitor().then((module) => ({ default: module.MulticamMonitor })),
);
const MulticamSourceDialog = React.lazy(() =>
  loadMulticamSourceDialog().then((module) => ({ default: module.MulticamSourceDialog })),
);
const KeyframeEditorPanel = React.lazy(() =>
  loadKeyframeEditorPanel().then((module) => ({ default: module.KeyframeEditorPanel })),
);
const AudioMixer = React.lazy(() =>
  loadAudioMixer().then((module) => ({ default: module.AudioMixer })),
);
const AudioChannelsDialog = React.lazy(() => import("./AudioChannelsDialog").then(module => ({ default: module.AudioChannelsDialog })));
const SourceChannelsDialog = React.lazy(() => import("./SourceChannelsDialog").then(module => ({ default: module.SourceChannelsDialog })));
const MultiCameraDialog = React.lazy(() =>
  loadMultiCameraDialog().then((module) => ({ default: module.MultiCameraDialog })),
);

// Timeline area (bottom band) is sized as a vh fraction so the top workspace (media | stage |
// inspector) gets the rest. Dock sizes and their limits live in the workspace layout store so
// saved workspaces can apply them.
// Compact mode: timeline takes most of the height, leaving a small preview.
const COMPACT_TIMELINE_VH = 80;

// The reference rail has 52 px of content plus its 1 px separator.
const RAIL_WIDTH = 53;

const MIN_STAGE_W = 380;
const RESIZE_HANDLE = 1;

type ResizeTarget = "timeline" | "media" | "inspector" | "chat";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), Math.max(min, max));
};

/** Warm the lazy panels once the editor is idle so first open has no network wait. */
const useIdlePanelPrefetch = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      void loadKeyframeEditorPanel().catch(() => undefined);
      void loadAudioMixer().catch(() => undefined);
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 2000);
    return () => window.clearTimeout(id);
  }, [enabled]);
};

/** Applies the remembered monitor output device and reports unplug / replug while the editor is open. */
const useAudioOutputDevice = () => {
  useEffect(() => startAudioOutputService(), []);
};

/**
 * Auto-save initialization hook
 */
const useAutoSave = () => {
  const initializeAutoSave = useProjectStore((state) => state.initializeAutoSave);

  useEffect(() => {
    initializeAutoSave().catch(console.error);
  }, [initializeAutoSave]);
};

/**
 * Main Editor Interface — v2 cinematic layout.
 *
 * Grid (per mockup):
 *
 *   ┌─────────────── topbar ───────────────┐
 *   │                                      │
 *   │  media │   stage   │   inspector     │  ← top row (auto-fit)
 *   │   460  │   1fr     │      360        │
 *   ├──────────────────────────────────────┤
 *   │             timeline                 │  ← `tl-height` (vh)
 *   └──────────────────────────────────────┘
 *
 * Column widths and timeline height are user-resizable via the
 * dividers between panels. Values are persisted to CSS custom
 * properties on the root grid so panels can pick them up.
 */
registerSmoothKeyframeRefresh(refreshSmoothKeyframesAfterEdit);

export const EditorInterface: React.FC = () => {
  const compact = useCompactEditor();
  const phone = usePhoneEditor();
  const tourRequested = useTourHostRequested();
  const tourHostWanted = tourRequested || (typeof window !== "undefined" && window.openreel?.platform !== "desktop");
  const [compactPanel, setCompactPanel] = useState<"timeline" | "media" | "inspector" | "chat">("timeline");
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  const { initialized, initializing, initError, initStatus, retry } =
    useEditorInitialization();

  const { showShortcutsOverlay, setShowShortcutsOverlay } =
    useKeyboardShortcuts();
  const shortcutsOverlayLatched = useLatch(showShortcutsOverlay);
  useAutoSave();
  useAudioOutputDevice();
  // Onboarding Pro row: apply the workspace picked on the welcome screen, once.
  useEffect(() => { applyPendingWorkspace(); }, []);
  usePreviewProxyPreference();
  useEffect(() => startProxyIngest(), []);
  useMediaWaveforms(initialized);
  useIdlePanelPrefetch(initialized);

  const sourceTab = useSourceMonitorStore((state) => state.tab);
  const audioChannelsOpen = useAudioChannelsStore((state) => state.open);
  const sourceChannelsOpen = useAudioChannelsStore((state) => state.sourceOpen);
  const keyframeEditorOpen = useUIStore((state) => state.keyframeEditorOpen);
  const setKeyframeEditorOpen = useUIStore((state) => state.setKeyframeEditorOpen);
  // Selection only matters here while the keyframe editor is open (or as a boolean for the
  // compact "edit selected" bar): subscribing to the raw array re-rendered the whole shell
  // (toolbar, panels, preview host) on every click.
  const selectedItems = useUIStore((state) => (state.keyframeEditorOpen ? state.selectedItems : NO_SELECTED_ITEMS));
  const hasSelection = useUIStore((state) => state.selectedItems.length > 0);
  const inspectorRequest = useInspectorNavigationStore(state => state.request);
  const handledInspectorRequest = useRef(inspectorRequest);
  const panels = useUIStore((state) => state.panels);
  const setPanelVisible = useUIStore((state) => state.setPanelVisible);
  const timelineMaximized = useUIStore((state) => state.timelineMaximized);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const updateClipKeyframes = useProjectStore((state) => state.updateClipKeyframes);

  const [selectedKeyframeIds, setSelectedKeyframeIds] = React.useState<string[]>([]);
  const [copiedKeyframes, setCopiedKeyframes] = React.useState<
    import("@openreel/core").Keyframe[]
  >([]);
  const [copiedKeyframeEffects, setCopiedKeyframeEffects] = React.useState<
    { id: string; type: string }[]
  >([]);

  const selectedClip = React.useMemo(() => {
    const selectedIds = selectedItems.filter((item) => item.type === "clip").map((item) => item.id);
    if (selectedIds.length === 0) return null;
    const clipId = selectedIds[0];
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }, [selectedItems, tracks]);

  const keyframePlayhead = useTimelineStore(state => keyframeEditorOpen ? state.playheadPosition : 0);
  const keyframePlayheadTime = selectedClip
    ? Math.min(Math.max(0, keyframePlayhead - selectedClip.startTime), selectedClip.duration)
    : 0;
  const keyframeProjectId = useProjectStore(state => state.project.id);
  const keyframeExporting = useUIStore(state => state.exportState.isExporting);
  const keyframeOperationLocked = useTimelineStore(state => Boolean(state.playbackLockedReason));
  const keyframeTrackLocked = tracks.some(track => track.locked && track.clips.some(clip => clip.id === selectedClip?.id));
  const getEditableKeyframeClip = React.useCallback((clipId: string) => {
    const state = useProjectStore.getState();
    if (state.project.id !== keyframeProjectId || useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return null;
    const track = state.project.timeline.tracks.find(track => track.clips.some(clip => clip.id === clipId));
    return track && !track.locked ? track.clips.find(clip => clip.id === clipId) ?? null : null;
  }, [keyframeProjectId]);

  const handleUpdateKeyframes = React.useCallback(
    (
      keyframeIds: string[],
      updates: Partial<import("@openreel/core").Keyframe>,
    ) => {
      const clip = selectedClip && getEditableKeyframeClip(selectedClip.id);
      if (!clip?.keyframes) return;
      const ids = new Set(keyframeIds);
      let changed = false;
      const keyframes = clip.keyframes.map(key => {
        if (!ids.has(key.id) || !Object.entries(updates).some(([field, value]) => key[field as keyof typeof key] !== value)) return key;
        changed = true;
        const next: Record<string, unknown> = { ...key, ...updates };
        // An explicit undefined (e.g. presets clearing Bezier handles) removes the field.
        for (const [field, value] of Object.entries(updates)) if (value === undefined) delete next[field];
        return next as unknown as import("@openreel/core").Keyframe;
      });
      if (changed) {
        updateClipKeyframes(clip.id, keyframes);
      }
    },
    [selectedClip, getEditableKeyframeClip, updateClipKeyframes],
  );

  const handleApplyInterpolation = React.useCallback(
    (keyframeIds: string[], op: KeyframeInterpolationOp, side: KeyframeInterpolationSide) => {
      const clip = selectedClip && getEditableKeyframeClip(selectedClip.id);
      if (!clip?.keyframes || !keyframeIds.length) return;
      updateClipKeyframes(clip.id, applyKeyframeInterpolation(clip.keyframes, keyframeIds, op, side), { derived: true });
    },
    [selectedClip, getEditableKeyframeClip, updateClipKeyframes],
  );

  const handleApplySpatialInterpolation = React.useCallback(
    (keyframeIds: string[], op: SpatialInterpolationOp) => {
      if (!selectedClip || !keyframeIds.length) return;
      applySpatialInterpolationToClip(selectedClip.id, keyframeIds, op);
    },
    [selectedClip],
  );

  /** One gesture over several keys is one undo step: each move carries its own time and value. */
  const handleMoveKeyframes = React.useCallback(
    (moves: { id: string; time: number; value: number }[]) => {
      const clip = selectedClip && getEditableKeyframeClip(selectedClip.id);
      if (!clip?.keyframes || !moves.length) return;
      const byId = new Map(moves.map((move) => [move.id, move]));
      let changed = false;
      const keyframes = clip.keyframes.map((key) => {
        const move = byId.get(key.id);
        if (!move || (move.time === key.time && move.value === key.value)) return key;
        changed = true;
        return { ...key, time: move.time, value: move.value };
      });
      if (changed) updateClipKeyframes(clip.id, keyframes);
    },
    [selectedClip, getEditableKeyframeClip, updateClipKeyframes],
  );

  const handleSelectKeyframes = React.useCallback(
    (keyframeIds: string[], addToSelection: boolean) => {
      setSelectedKeyframeIds((prev) => (addToSelection ? Array.from(new Set([...prev, ...keyframeIds])) : keyframeIds));
    },
    [],
  );

  const handleDeleteKeyframes = React.useCallback(
    (keyframeIds: string[]) => {
      const clip = selectedClip && getEditableKeyframeClip(selectedClip.id);
      if (!clip?.keyframes) return;
      const ids = new Set(keyframeIds);
      const keyframes = clip.keyframes.filter(key => !ids.has(key.id));
      if (keyframes.length === clip.keyframes.length) return;
      updateClipKeyframes(clip.id, keyframes);
      setSelectedKeyframeIds(prev => prev.filter(id => !ids.has(id)));
    },
    [selectedClip, getEditableKeyframeClip, updateClipKeyframes],
  );

  const handleCopyKeyframes = React.useCallback(
    (keyframeIds: string[]) => {
      if (!selectedClip?.keyframes) return;
      const picked = selectedClip.keyframes.filter((kf) => keyframeIds.includes(kf.id));
      // Stored with times rebased to the earliest copied key so paste can land at the playhead.
      setCopiedKeyframes([...copyKeyframeSet(picked).keyframes]);
      setCopiedKeyframeEffects(selectedClip.effects.map((effect) => ({ id: effect.id, type: effect.type })));
    },
    [selectedClip],
  );

  const handlePasteKeyframes = React.useCallback(
    (clipId: string, time: number, targetProperty?: string) => {
      const targetClip = getEditableKeyframeClip(clipId);
      if (!targetClip || !copiedKeyframes.length) return;
      // Effect keys are instance-keyed: move them onto the target's matching effect, drop the ambiguous ones.
      const retargeted = retargetCopiedKeyframes(copiedKeyframes, copiedKeyframeEffects, targetClip.effects);
      if (!retargeted.keyframes.length) return;
      const copied = copyKeyframeSet(retargeted.keyframes);
      const merged = pasteKeyframeSet(targetClip.keyframes ?? [], copied, {
        time,
        targetProperty,
        maxTime: targetClip.duration,
        newId: () => `kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      });
      // One setAll action: the whole paste is a single undo step.
      updateClipKeyframes(clipId, merged);
    },
    [copiedKeyframes, copiedKeyframeEffects, getEditableKeyframeClip, updateClipKeyframes],
  );

  const handleSelectKeyframe = React.useCallback(
    (keyframeId: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedKeyframeIds((prev) =>
          prev.includes(keyframeId)
            ? prev.filter((id) => id !== keyframeId)
            : [...prev, keyframeId],
        );
      } else {
        setSelectedKeyframeIds([keyframeId]);
      }
    },
    [],
  );

  // Keep the live audio graph's per-track/master effect racks in sync with the project.
  useEffect(() => startAudioRackSync(), []);
  // Linked composition windows (web pop-up or desktop window) edit through this host.
  useEffect(() => startLinkedCompHost(), []);

  // ── Layout state (resizable columns and timeline band) ──────────
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!phone || !root) return;
    const resize = () => { if (root.clientWidth > 0) root.style.setProperty("--phone-preview-height", `${Math.round(root.clientWidth * 9 / 16)}px`); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    return () => observer.disconnect();
  }, [phone, initialized]);
  const resizeRef = useRef<ResizeTarget | null>(null);
  const [mediaWidth, setMediaWidth] = useDockSize("mediaWidth");
  const [inspectorWidth, setInspectorWidth] = useDockSize("inspectorWidth");
  const [chatWidth, setChatWidth] = useDockSize("chatWidth");
  const [timelineVh, setTimelineVh] = useDockSize("timelineVh");

  const chatVisible = panels.agentChat?.visible ?? false;
  useEffect(() => {
    if (chatVisible) {
      setHasOpenedChat(true);
      if (compact) setCompactPanel(phone ? "timeline" : "chat");
    }
  }, [chatVisible, compact, phone]);
  useEffect(() => {
    if (handledInspectorRequest.current === inspectorRequest) return;
    handledInspectorRequest.current = inspectorRequest;
    if (compact && inspectorRequest && useUIStore.getState().selectedItems.some(item => item.id === inspectorRequest.clipId)) {
      setPanelVisible("agentChat", false);
      setCompactPanel("inspector");
    }
  }, [inspectorRequest, compact, setPanelVisible]);
  const openCompactPanel = (panel: typeof compactPanel) => {
    setCompactPanel(phone && panel === "chat" ? "timeline" : panel);
    setPanelVisible("agentChat", panel === "chat");
    if (panel === "chat") setHasOpenedChat(true);
  };

  const mediaRef = useRef(mediaWidth);
  const inspectorRef = useRef(inspectorWidth);
  const chatRef = useRef(chatWidth);
  useEffect(() => {
    mediaRef.current = mediaWidth;
  }, [mediaWidth]);
  useEffect(() => {
    inspectorRef.current = inspectorWidth;
  }, [inspectorWidth]);
  useEffect(() => {
    chatRef.current = chatWidth;
  }, [chatWidth]);

  const beginResize = useCallback(
    (target: ResizeTarget) => (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = target;
      document.body.style.cursor =
        target === "timeline" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const root = rootRef.current;
      const target = resizeRef.current;
      if (!root || !target) return;
      const rect = root.getBoundingClientRect();
      const chatOpen =
        useUIStore.getState().panels.agentChat?.visible ?? false;
      const leftWidth = chatOpen ? chatRef.current : mediaRef.current;

      if (target === "media") {
        const maxByStage =
          rect.width - RAIL_WIDTH - inspectorRef.current - 2 * RESIZE_HANDLE - MIN_STAGE_W;
        setMediaWidth(
          clamp(e.clientX - rect.left - RAIL_WIDTH, MIN_MEDIA_W, Math.min(MAX_MEDIA_W, maxByStage)),
        );
        return;
      }
      if (target === "inspector") {
        const maxByStage =
          rect.width - RAIL_WIDTH - leftWidth - 2 * RESIZE_HANDLE - MIN_STAGE_W;
        setInspectorWidth(
          clamp(
            rect.right - e.clientX,
            MIN_INSPECTOR_W,
            Math.min(MAX_INSPECTOR_W, maxByStage),
          ),
        );
        return;
      }
      if (target === "chat") {
        const maxByStage =
          rect.width -
          RAIL_WIDTH - inspectorRef.current -
          2 * RESIZE_HANDLE -
          MIN_STAGE_W;
        setChatWidth(
          clamp(
            e.clientX - rect.left - RAIL_WIDTH,
            MIN_CHAT_W,
            Math.min(MAX_CHAT_W, maxByStage),
          ),
        );
        return;
      }
      // timeline: vh based on the distance from bottom of the viewport
      const vh = ((window.innerHeight - e.clientY) / window.innerHeight) * 100;
      setTimelineVh(clamp(vh, MIN_TIMELINE_VH, MAX_TIMELINE_VH));
    };

    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setMediaWidth, setInspectorWidth, setChatWidth, setTimelineVh]);

  // Reflect resized panel sizes back into CSS variables so child styles
  // (timeline header padding, etc.) can react.
  useEffect(() => {
    const r = rootRef.current;
    if (!r) return;
    const tlVh = timelineMaximized ? COMPACT_TIMELINE_VH : timelineVh;
    r.style.setProperty("--media-w", `${mediaWidth}px`);
    r.style.setProperty("--inspector-w", `${inspectorWidth}px`);
    r.style.setProperty("--chat-w", `${chatWidth}px`);
    r.style.setProperty("--tl-height", `${tlVh}vh`);
  }, [mediaWidth, inspectorWidth, chatWidth, timelineVh, timelineMaximized, initialized]);

  if (initializing || !initialized) {
    return (
      <div className="w-full h-full bg-bg flex items-center justify-center">
        <div className="text-center">
          {initError ? (
            <div role="alert" className="max-w-md space-y-4 px-6">
              <span className="text-[13px] leading-5 text-fg-2 font-bold">The editor couldn't start</span>
              <span className="font-normal text-status-error text-xs">{initError}</span>
              <Button onClick={retry} type="button" aria-label="Try again" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-8 px-3 text-[12px] bg-accent text-accent-fg hover:bg-accent/90">
                <span className="truncate">{"Try again"}</span>
              </Button>
            </div>
          ) : (
            <div role="status">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <span className="font-normal text-fg-2 text-sm">Initializing editor…</span>
              <span className="font-normal text-fg-muted text-xs mt-2">{initStatus}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  // Grid template uses inline CSS for the resizable columns. The CSS
  // variables `--media-w`, `--inspector-w`, `--tl-height` are kept in
  // sync via the effect above so other components can use them too.
  const effectiveTimelineVh = timelineMaximized
    ? COMPACT_TIMELINE_VH
    : timelineVh;
  const gridStyle: React.CSSProperties = compact
    ? {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: phone
          ? `calc(var(--phone-preview-height, 219px) + 48px) ${compactPanel === "media" ? "48px " : ""}minmax(0, 1fr)`
          : compactPanel === "media" ? "minmax(180px, 40%) 48px minmax(0, 1fr)" : "minmax(220px, 48%) minmax(0, 1fr)",
        gridTemplateAreas: compactPanel === "media" ? "'stage' 'rail' 'media'" : `'stage' '${compactPanel}'`,
      }
    : {
        gridTemplateColumns: `${RAIL_WIDTH}px ${chatVisible ? chatWidth : mediaWidth}px ${RESIZE_HANDLE}px minmax(0, 1fr) ${RESIZE_HANDLE}px ${inspectorWidth}px`,
        gridTemplateRows: `minmax(0, 1fr) ${RESIZE_HANDLE}px ${effectiveTimelineVh}vh`,
        gridTemplateAreas: chatVisible
          ? "'rail chat mh stage ih inspector' 'th th th th th th' 'timeline timeline timeline timeline timeline timeline'"
          : "'rail media mh stage ih inspector' 'th th th th th th' 'timeline timeline timeline timeline timeline timeline'",
      };

  return (
    <div
      ref={rootRef}
      data-compact-panel={compact ? compactPanel : undefined}
      data-platform={phone ? /Android/i.test(navigator.userAgent) ? "android" : "ios" : undefined}
      className={`editor-shell w-full h-full bg-bg text-fg overflow-hidden font-sans select-none relative z-20 flex flex-col ${compact ? "editor-compact" : ""} ${phone ? "editor-phone" : ""}`}
    >
      <Toolbar />
      <ProjectLockBanner />
      <MissingFontsBanner />

      {phone && compactPanel !== "timeline" && <div className="mobile-panel-heading">
        <ShadcnButton variant="ghost" onClick={() => openCompactPanel("timeline")}>Back to timeline</ShadcnButton>
        <span>{compactPanel === "media" ? "Library" : compactPanel === "chat" ? "AI assist" : "Clip controls"}</span>
      </div>}

      <div className="editor-body flex-1 min-h-0 flex">

        <div
          className={`editor-workspace flex-1 min-w-0 min-h-0 grid gap-0 bg-bg ${chatVisible && !compact ? "ai-workspace-grid" : ""}`}
          style={gridStyle}
        >
        <div className="editor-rail" style={{ gridArea: "rail" }} hidden={compact && compactPanel !== "media"}><EditorActionRail /></div>
        <div
          id="editor-panel-media"
          hidden={chatVisible || (compact && compactPanel !== "media")}
          className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden workspace-surface"
          style={{ gridArea: "media" }}
        >
          <PanelErrorBoundary name="Media">
            <AssetsPanel />
          </PanelErrorBoundary>
        </div>

        <div
          hidden={compact}
          className="editor-resizer grid place-items-center cursor-col-resize group/h"
          style={{ gridArea: "mh" }}
          onMouseDown={beginResize(chatVisible ? "chat" : "media")}
          role="separator"
          aria-label="Resize media panel"
          aria-orientation="vertical"
          aria-valuenow={chatVisible ? chatWidth : mediaWidth}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); if (chatVisible) setChatWidth(w => clamp(w + (e.key === "ArrowRight" ? 20 : -20), MIN_CHAT_W, MAX_CHAT_W)); else setMediaWidth((w) => clamp(w + (e.key === "ArrowRight" ? 20 : -20), MIN_MEDIA_W, MAX_MEDIA_W)); } }}
        >
          <span className="h-10 w-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          className="editor-stage relative bg-stage-bg min-w-0 min-h-0 overflow-hidden workspace-surface"
          style={{ gridArea: "stage" }}
        >
          <PanelErrorBoundary name="Stage">
            <Preview />
            {sourceTab === "source" && <SourceMonitor />}
            {sourceTab === "multicam" && (
              <React.Suspense fallback={null}>
                <MulticamMonitor />
              </React.Suspense>
            )}
          </PanelErrorBoundary>
        </div>

        <><div
          hidden={compact}
          className="editor-resizer grid place-items-center cursor-col-resize group/h"
          style={{ gridArea: "ih" }}
          onMouseDown={beginResize("inspector")}
        >
          <span className="h-10 w-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          id="editor-panel-inspector"
          hidden={compact && compactPanel !== "inspector"}
          className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden workspace-surface"
          style={{ gridArea: "inspector" }}
        >
          <PanelErrorBoundary name="Inspector">
            {chatVisible && !compact ? <React.Suspense fallback={null}><ChangesPanel /></React.Suspense> : <InspectorPanel />}
          </PanelErrorBoundary>
        </div></>

        {(chatVisible || hasOpenedChat) && (
          <>
            <div
              hidden
              className="ai-chat-resizer editor-resizer grid place-items-center cursor-col-resize group/h"
              style={{ gridArea: "ch" }}
              onMouseDown={beginResize("chat")}
              role="separator"
              aria-label="Resize chat panel"
              aria-orientation="vertical"
              aria-valuenow={chatWidth}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setChatWidth((w) => clamp(w + (e.key === "ArrowLeft" ? 20 : -20), MIN_CHAT_W, MAX_CHAT_W)); } }}
            >
              <span className="h-10 w-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
            </div>

            <div
              id="editor-panel-chat"
              hidden={phone || !chatVisible || (compact && compactPanel !== "chat")}
              className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden workspace-surface"
              style={{ gridArea: "chat" }}
            >
              <PanelErrorBoundary name="AI Editor">
                <React.Suspense
                  fallback={
                    <div className="grid h-full place-items-center text-xs text-fg-muted">
                      Loading AI Editor…
                    </div>
                  }
                >
                  <ChatPanel
                    onClose={() => { setPanelVisible("agentChat", false); if (compact) setCompactPanel("timeline"); }}
                  />
                </React.Suspense>
              </PanelErrorBoundary>
            </div>
          </>
        )}

        <div
          hidden={compact}
          className="editor-resizer grid place-items-center cursor-row-resize group/h"
          style={{ gridArea: "th" }}
          onMouseDown={beginResize("timeline")}
        >
          <span className="w-10 h-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          id="editor-panel-timeline"
          hidden={compact && compactPanel !== "timeline"}
          className="editor-panel bg-tl-bg min-w-0 min-h-0 overflow-hidden flex flex-col workspace-surface"
          style={{ gridArea: "timeline" }}
        >
          {compact && !phone && hasSelection && (
            <ShadcnButton variant="ghost" size="sm" type="button" onClick={() => openCompactPanel("inspector")} className="h-auto shrink-0 whitespace-normal rounded-none p-0 text-xs font-normal leading-[1.4] text-accent bg-accent/10">
              Edit selected clip · trim, captions, audio & effects
            </ShadcnButton>
          )}
          <div className="flex-1 min-h-0 flex">
            <div hidden={compact && keyframeEditorOpen} className="flex-1 min-w-0 min-h-0">
              <PanelErrorBoundary name="Timeline">
                <Timeline onOpenMedia={() => openCompactPanel("media")} />
              </PanelErrorBoundary>
            </div>

            {keyframeEditorOpen && (
              <div className={compact ? "w-full shrink-0 min-w-0" : "w-[min(640px,100%)] shrink-0 min-w-0"}>
                <PanelErrorBoundary name="Keyframe Editor">
                  <React.Suspense fallback={<div className="grid h-full place-items-center text-xs text-fg-muted" role="status">Loading keyframes…</div>}>
                  <KeyframeEditorPanel
                    clip={selectedClip}
                    playheadTime={keyframePlayheadTime}
                    onClose={() => setKeyframeEditorOpen(false)}
                    disabled={keyframeExporting || keyframeOperationLocked || keyframeTrackLocked}
                    onUpdateKeyframes={handleUpdateKeyframes}
                    onApplyInterpolation={handleApplyInterpolation}
                    onApplySpatialInterpolation={handleApplySpatialInterpolation}
                    onMoveKeyframes={handleMoveKeyframes}
                    onSelectKeyframes={handleSelectKeyframes}
                    onDeleteKeyframes={handleDeleteKeyframes}
                    onCopyKeyframes={handleCopyKeyframes}
                    onPasteKeyframes={handlePasteKeyframes}
                    selectedKeyframeIds={selectedKeyframeIds}
                    onSelectKeyframe={handleSelectKeyframe}
                    copiedKeyframes={copiedKeyframes}
                  />
                  </React.Suspense>
                </PanelErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {!phone && (
        <footer data-testid="editor-status-bar" className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-bg-1 px-1">
          <BackgroundTasksIndicator />
        </footer>
      )}

      {phone && <React.Suspense fallback={<div style={{ height: 66, flexShrink: 0 }} role="status" aria-label="Loading mobile tools"/>}><MobileEditorTools onPanel={openCompactPanel}/></React.Suspense>}
      {compact && !phone && (
        <nav aria-label="Editor workspace" className="editor-workspace-tabs">
          {([
            ["timeline", "Timeline"], ["media", "Media"], ["inspector", "Edit"], ["chat", "AI"],
          ] as const).map(([panel, label]) => (
            <ShadcnButton variant="ghost" size="sm" key={panel} type="button" aria-controls={`editor-panel-${panel}`} aria-pressed={compactPanel === panel}
              onClick={() => openCompactPanel(panel)} className={compactPanel === panel ? "text-accent bg-accent/10" : "text-fg-muted"}>
              {label}
            </ShadcnButton>
          ))}
        </nav>
      )}

      {shortcutsOverlayLatched && (
        <React.Suspense fallback={null}>
          <KeyboardShortcutsOverlay
            isOpen={showShortcutsOverlay}
            onClose={() => setShowShortcutsOverlay(false)}
          />
        </React.Suspense>
      )}
      {audioChannelsOpen && (
        <PanelErrorBoundary name="Audio channels" silent>
          <React.Suspense fallback={null}>
            <AudioChannelsDialog />
          </React.Suspense>
        </PanelErrorBoundary>
      )}
      {sourceChannelsOpen && (
        <PanelErrorBoundary name="Source audio channels" silent>
          <React.Suspense fallback={null}>
            <SourceChannelsDialog />
          </React.Suspense>
        </PanelErrorBoundary>
      )}
      <PanelErrorBoundary name="Multicam" silent>
        <React.Suspense fallback={null}>
          <MultiCameraDialog />
        </React.Suspense>
      </PanelErrorBoundary>
      <PanelErrorBoundary name="Multicam source" silent>
        <React.Suspense fallback={null}>
          <MulticamSourceDialog />
        </React.Suspense>
      </PanelErrorBoundary>
      <TimelineImportDialog />
      <InterchangeExportReportDialog />
      <InterchangeExportDialog />
      <Dialog open={panels.audioMixer?.visible ?? false} onOpenChange={(open) => setPanelVisible("audioMixer", open)}>
        <DialogContent hideCloseButton aria-describedby={undefined} className="w-[calc(100vw-32px)] max-w-3xl gap-0 overflow-hidden border-border bg-bg-1 p-0 text-fg">
          <DialogTitle className="sr-only">Audio Mixer</DialogTitle>
          <ScrollArea className="h-[min(760px,calc(100dvh-32px))]">
            <PanelErrorBoundary name="Audio Mixer">
              <React.Suspense fallback={<div className="grid h-40 place-items-center text-xs text-fg-muted" role="status">Loading mixer…</div>}>
                <AudioMixer visible onClose={() => setPanelVisible("audioMixer", false)} />
              </React.Suspense>
            </PanelErrorBoundary>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <WorkspaceSaveDialog />
      <ClipSpeedDialog />
      {tourHostWanted ? <React.Suspense fallback={null}><TourHost /></React.Suspense> : null}
    </div>
  );
};
