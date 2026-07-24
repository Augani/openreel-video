import type { JSX } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Diamond,
  GitBranch,
  Layers,
  LayoutGrid,
  Library,
  Plus,
  Radar,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "@/icons/lucide-compat";
import type { MotionComposition } from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { WorkspaceModeTabs } from "../components/WorkspaceModeTabs";
import { Icon } from "@/icons/Icon";
import { useRouter } from "../hooks/use-router";
import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";
import { useUIStore } from "../stores/ui-store";
import { AnimationPresetsPanel } from "./components/AnimationPresetsPanel";
import { AssetPanel } from "./components/AssetPanel";
import { CreationWorkspacePanel } from "./components/CreationWorkspacePanel";
import { DeformPanel } from "./components/DeformPanel";
import { EffectsPanel } from "./components/EffectsPanel";
import { LayerPanel } from "./components/LayerPanel";
import { GraphEditorPanel } from "./components/GraphEditorPanel";
import { MasksPanel } from "./components/MasksPanel";
import { MotionStartPanel } from "./components/MotionStartPanel";
import { MotionSyncPanel } from "./components/MotionSyncPanel";
import { MotionToolRail } from "./components/MotionToolRail";
import { MotionTrackingPanel } from "./components/MotionTrackingPanel";
import { MotionTemplateBrowser } from "./components/MotionTemplateBrowser";
import { MotionTimeline } from "./components/MotionTimeline";
import { Button, IconButton, SectionDefaultsContext } from "./components/primitives";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { RenderQueuePanel } from "./components/RenderQueuePanel";
import { StageCanvas } from "./components/StageCanvas";
import { VariablesPanel } from "./components/VariablesPanel";
import { exportMotionCompositionSceneMp4 } from "./export-motion-frame";
import {
  useMotionStore,
  type MotionLeftTab,
  type MotionRightTab,
} from "./stores/motion-store";

interface MotionCreatorShellProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const LEFT_TABS: Array<{ id: MotionLeftTab; label: string; icon: LucideIcon }> = [
  { id: "start", label: "Start", icon: Sparkles },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "assets", label: "Media", icon: Library },
  { id: "templates", label: "Kits", icon: Sparkles },
  { id: "creation", label: "Scenes", icon: Box },
];

type InspectorGroupId = "edit" | "animate" | "assist" | "deliver";

interface InspectorPanelDef {
  readonly id: MotionRightTab;
  readonly label: string;
  readonly render: (composition: MotionComposition) => ReactNode;
}

interface InspectorGroupDef {
  readonly id: InspectorGroupId;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly defaultTab: MotionRightTab;
  readonly panels: readonly InspectorPanelDef[];
}

const INSPECTOR_GROUPS: readonly InspectorGroupDef[] = [
  {
    id: "edit",
    label: "Edit",
    icon: SlidersHorizontal,
    defaultTab: "properties",
    panels: [
      {
        id: "properties",
        label: "Properties",
        render: (composition) => (
          <PropertiesPanel composition={composition} embedded />
        ),
      },
      {
        id: "effects",
        label: "Effects",
        render: (composition) => <EffectsPanel composition={composition} embedded />,
      },
      {
        id: "masks",
        label: "Masks",
        render: (composition) => <MasksPanel composition={composition} embedded />,
      },
    ],
  },
  {
    id: "animate",
    label: "Animate",
    icon: Diamond,
    defaultTab: "presets",
    panels: [
      {
        id: "presets",
        label: "Animation Presets",
        render: (composition) => (
          <AnimationPresetsPanel composition={composition} embedded />
        ),
      },
      {
        id: "graph",
        label: "Graph Editor",
        render: (composition) => (
          <GraphEditorPanel composition={composition} embedded />
        ),
      },
      {
        id: "deform",
        label: "Deform",
        render: (composition) => <DeformPanel composition={composition} embedded />,
      },
      {
        id: "sync",
        label: "Sync",
        render: (composition) => (
          <MotionSyncPanel composition={composition} embedded />
        ),
      },
    ],
  },
  {
    id: "assist",
    label: "Assist",
    icon: Radar,
    defaultTab: "tracker",
    panels: [
      {
        id: "tracker",
        label: "Motion Tracking",
        render: (composition) => (
          <MotionTrackingPanel composition={composition} embedded />
        ),
      },
      {
        id: "variables",
        label: "Variables",
        render: (composition) => (
          <VariablesPanel composition={composition} embedded />
        ),
      },
    ],
  },
  {
    id: "deliver",
    label: "Deliver",
    icon: GitBranch,
    defaultTab: "queue",
    panels: [
      {
        id: "queue",
        label: "Render Queue",
        render: (composition) => (
          <RenderQueuePanel composition={composition} embedded />
        ),
      },
    ],
  },
];

const LAYER_TYPE_LABEL: Record<string, string> = {
  text: "Text Layer",
  shape: "Shape Layer",
  image: "Image Layer",
  video: "Video Layer",
  group: "Group",
  null: "Null Object",
  composition: "Precomposition",
  adjustment: "Adjustment Layer",
  particle: "Particle Layer",
  scene3d: "3D Object",
};

const RESIZE_HANDLE_WIDTH = 8;
const MIN_STAGE_WIDTH = 240;
const DEFAULT_LEFT_PANEL_WIDTH = 360;
const MIN_LEFT_PANEL_WIDTH = 260;
const MAX_LEFT_PANEL_WIDTH = 560;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MAX_RIGHT_PANEL_WIDTH = 500;
const PANEL_RESIZE_STEP = 24;
const DEFAULT_TIMELINE_HEIGHT = 340;
const MIN_TIMELINE_HEIGHT = 220;
const MAX_TIMELINE_HEIGHT = 680;
const MIN_WORKSPACE_HEIGHT = 260;
const TIMELINE_RESIZE_STEP = 32;
const MOTION_HEADER_HEIGHT = 60;
const MOTION_FOOTER_HEIGHT = 28;
const LEFT_PANEL_STORAGE_KEY = "openreel.motionCreator.leftPanelWidth.v2";
const RIGHT_PANEL_STORAGE_KEY = "openreel.motionCreator.rightPanelWidth.v2";
const TIMELINE_HEIGHT_STORAGE_KEY = "openreel.motionCreator.timelineHeight.v2";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getInspectorGroupIdForTab = (
  tab: MotionRightTab,
): InspectorGroupId | null =>
  INSPECTOR_GROUPS.find((group) =>
    group.panels.some((panel) => panel.id === tab),
  )?.id ?? null;

type MotionPanelSide = "left" | "right";

const readStoredPanelWidth = (
  storageKey: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) return fallback;
  const stored = Number(raw);
  return Number.isFinite(stored) ? clamp(stored, min, max) : fallback;
};

export function MotionCreatorShell({
  composition,
  embedded = false,
}: MotionCreatorShellProps): JSX.Element {
  const [isExportingScene, setIsExportingScene] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const setExportActive = useMotionStore((state) => state.setExportActive);
  const shellRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizingPanelRef = useRef<MotionPanelSide | null>(null);
  const resizingTimelineRef = useRef(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    readStoredPanelWidth(
      LEFT_PANEL_STORAGE_KEY,
      DEFAULT_LEFT_PANEL_WIDTH,
      MIN_LEFT_PANEL_WIDTH,
      MAX_LEFT_PANEL_WIDTH,
    ),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredPanelWidth(
      RIGHT_PANEL_STORAGE_KEY,
      DEFAULT_RIGHT_PANEL_WIDTH,
      MIN_RIGHT_PANEL_WIDTH,
      MAX_RIGHT_PANEL_WIDTH,
    ),
  );
  const [timelineHeight, setTimelineHeightState] = useState(() =>
    readStoredPanelWidth(
      TIMELINE_HEIGHT_STORAGE_KEY,
      DEFAULT_TIMELINE_HEIGHT,
      MIN_TIMELINE_HEIGHT,
      MAX_TIMELINE_HEIGHT,
    ),
  );
  const leftPanelWidthRef = useRef(leftPanelWidth);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  const timelineHeightRef = useRef(timelineHeight);
  const { navigate } = useRouter();
  const leftTab = useMotionStore((state) => state.leftTab);
  const setLeftTab = useMotionStore((state) => state.setLeftTab);
  const rightTab = useMotionStore((state) => state.rightTab);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const rightTabRevealNonce = useMotionStore(
    (state) => state.rightTabRevealNonce,
  );
  const inspectorScrollRef = useRef<HTMLDivElement>(null);
  const [openInspectorGroups, setOpenInspectorGroups] = useState<
    Record<InspectorGroupId, boolean>
  >(() => ({
    edit: true,
    animate: false,
    assist: false,
    deliver: false,
  }));
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const setAutoKeyframe = useMotionStore((state) => state.setAutoKeyframe);
  const timelineColumnMode = useMotionStore((state) => state.timelineColumnMode);
  const setTimelineColumnMode = useMotionStore(
    (state) => state.setTimelineColumnMode,
  );
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const compositionNavigationStack = useMotionStore(
    (state) => state.compositionNavigationStack,
  );
  const goBackComposition = useMotionStore((state) => state.goBackComposition);
  const project = useProjectStore((state) => state.project);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const canUndo = useProjectStore((state) => state.canUndo());
  const canRedo = useProjectStore((state) => state.canRedo());
  const insertMotionInstance = useProjectStore(
    (state) => state.insertMotionInstance,
  );
  const setDesktopPage = useUIStore((state) => state.setDesktopPage);
  const parentCompositionId =
    compositionNavigationStack[compositionNavigationStack.length - 1] ?? null;
  const parentComposition = parentCompositionId
    ? (project.motionCompositions ?? []).find(
        (candidate) => candidate.id === parentCompositionId,
      )
    : null;

  const selectedLayer =
    selectedLayerIds.length > 0
      ? composition.layers.find((layer) => layer.id === selectedLayerIds[0]) ?? null
      : null;
  const inspectorSubtitle = selectedLayer
    ? selectedLayer.name
    : "Composition";
  const inspectorType =
    selectedLayerIds.length > 1
      ? `${selectedLayerIds.length} layers selected`
      : selectedLayer
        ? LAYER_TYPE_LABEL[selectedLayer.type] ?? "Layer"
        : "Scene settings";

  leftPanelWidthRef.current = leftPanelWidth;
  rightPanelWidthRef.current = rightPanelWidth;
  timelineHeightRef.current = timelineHeight;

  useEffect(() => {
    window.localStorage.setItem(LEFT_PANEL_STORAGE_KEY, String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      TIMELINE_HEIGHT_STORAGE_KEY,
      String(timelineHeight),
    );
  }, [timelineHeight]);

  const panelBounds = useCallback(
    (side: MotionPanelSide): readonly [number, number] => {
      const layout = layoutRef.current;
      const availableForSidePanels = layout
        ? layout.getBoundingClientRect().width -
          RESIZE_HANDLE_WIDTH * 2 -
          MIN_STAGE_WIDTH
        : Number.POSITIVE_INFINITY;
      if (side === "left") {
        const maxByStage = availableForSidePanels - rightPanelWidthRef.current;
        return [
          MIN_LEFT_PANEL_WIDTH,
          Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(MAX_LEFT_PANEL_WIDTH, maxByStage)),
        ];
      }
      const maxByStage = availableForSidePanels - leftPanelWidthRef.current;
      return [
        MIN_RIGHT_PANEL_WIDTH,
        Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, maxByStage)),
      ];
    },
    [],
  );

  const setPanelWidth = useCallback(
    (side: MotionPanelSide, width: number) => {
      const [min, max] = panelBounds(side);
      const nextWidth = clamp(width, min, max);
      if (side === "left") {
        leftPanelWidthRef.current = nextWidth;
        setLeftPanelWidth(nextWidth);
      } else {
        rightPanelWidthRef.current = nextWidth;
        setRightPanelWidth(nextWidth);
      }
    },
    [panelBounds],
  );

  const timelineBounds = useCallback((): readonly [number, number] => {
    const shell = shellRef.current;
    const maxByWorkspace = shell
      ? shell.getBoundingClientRect().height -
        MOTION_HEADER_HEIGHT -
        MOTION_FOOTER_HEIGHT -
        MIN_WORKSPACE_HEIGHT
      : MAX_TIMELINE_HEIGHT;
    return [
      MIN_TIMELINE_HEIGHT,
      Math.max(
        MIN_TIMELINE_HEIGHT,
        Math.min(MAX_TIMELINE_HEIGHT, maxByWorkspace),
      ),
    ];
  }, []);

  const setTimelineHeight = useCallback(
    (height: number) => {
      const [min, max] = timelineBounds();
      const nextHeight = clamp(height, min, max);
      timelineHeightRef.current = nextHeight;
      setTimelineHeightState(nextHeight);
    },
    [timelineBounds],
  );

  const fitPanelsToLayout = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return;

    const availableWidth =
      layout.getBoundingClientRect().width - RESIZE_HANDLE_WIDTH * 2 - MIN_STAGE_WIDTH;
    if (!Number.isFinite(availableWidth) || availableWidth <= 0) return;

    const minTotal = MIN_LEFT_PANEL_WIDTH + MIN_RIGHT_PANEL_WIDTH;
    const currentLeft = leftPanelWidthRef.current;
    const currentRight = rightPanelWidthRef.current;
    const currentTotal = currentLeft + currentRight;

    if (currentTotal <= availableWidth) return;

    if (availableWidth <= minTotal) {
      leftPanelWidthRef.current = MIN_LEFT_PANEL_WIDTH;
      rightPanelWidthRef.current = MIN_RIGHT_PANEL_WIDTH;
      setLeftPanelWidth(MIN_LEFT_PANEL_WIDTH);
      setRightPanelWidth(MIN_RIGHT_PANEL_WIDTH);
      return;
    }

    const leftExtra = Math.max(0, currentLeft - MIN_LEFT_PANEL_WIDTH);
    const rightExtra = Math.max(0, currentRight - MIN_RIGHT_PANEL_WIDTH);
    const extraTotal = leftExtra + rightExtra;
    const availableExtra = availableWidth - minTotal;
    const leftShare =
      extraTotal > 0 ? Math.round((leftExtra / extraTotal) * availableExtra) : 0;
    const nextLeft = clamp(
      MIN_LEFT_PANEL_WIDTH + leftShare,
      MIN_LEFT_PANEL_WIDTH,
      MAX_LEFT_PANEL_WIDTH,
    );
    const nextRight = clamp(
      availableWidth - nextLeft,
      MIN_RIGHT_PANEL_WIDTH,
      MAX_RIGHT_PANEL_WIDTH,
    );

    leftPanelWidthRef.current = nextLeft;
    rightPanelWidthRef.current = nextRight;
    setLeftPanelWidth(nextLeft);
    setRightPanelWidth(nextRight);
  }, []);

  useEffect(() => {
    fitPanelsToLayout();
    window.addEventListener("resize", fitPanelsToLayout);
    return () => window.removeEventListener("resize", fitPanelsToLayout);
  }, [fitPanelsToLayout]);

  const resetTimelineHeight = useCallback(() => {
    setTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
  }, [setTimelineHeight]);

  const resetPanelWidth = useCallback(
    (side: MotionPanelSide) => {
      setPanelWidth(
        side,
        side === "left" ? DEFAULT_LEFT_PANEL_WIDTH : DEFAULT_RIGHT_PANEL_WIDTH,
      );
    },
    [setPanelWidth],
  );

  const resizePanelFromKey = useCallback(
    (side: MotionPanelSide, event: ReactKeyboardEvent<HTMLDivElement>) => {
      const currentWidth =
        side === "left" ? leftPanelWidthRef.current : rightPanelWidthRef.current;
      const [min, max] = panelBounds(side);
      if (event.key === "Home") {
        event.preventDefault();
        setPanelWidth(side, min);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setPanelWidth(side, max);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const directionalDelta =
        event.key === "ArrowRight" ? PANEL_RESIZE_STEP : -PANEL_RESIZE_STEP;
      setPanelWidth(
        side,
        currentWidth + (side === "left" ? directionalDelta : -directionalDelta),
      );
    },
    [panelBounds, setPanelWidth],
  );

  const beginPanelResize = useCallback(
    (side: MotionPanelSide, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth =
        side === "left" ? leftPanelWidthRef.current : rightPanelWidthRef.current;

      try {
        target.setPointerCapture(pointerId);
      } catch {
        return;
      }

      resizingPanelRef.current = side;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId || resizingPanelRef.current !== side) {
          return;
        }
        const delta = moveEvent.clientX - startX;
        setPanelWidth(side, startWidth + (side === "left" ? delta : -delta));
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        resizingPanelRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* pointer capture may already be released */
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [setPanelWidth],
  );

  const beginTimelineResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = timelineHeightRef.current;

      try {
        target.setPointerCapture(pointerId);
      } catch {
        return;
      }

      resizingTimelineRef.current = true;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (moveEvent: PointerEvent) => {
        if (
          moveEvent.pointerId !== pointerId ||
          !resizingTimelineRef.current
        ) {
          return;
        }
        setTimelineHeight(startHeight + (startY - moveEvent.clientY));
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        resizingTimelineRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* pointer capture may already be released */
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [setTimelineHeight],
  );

  const resizeTimelineFromKey = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const [min, max] = timelineBounds();
      if (event.key === "Home") {
        event.preventDefault();
        setTimelineHeight(min);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setTimelineHeight(max);
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const delta =
        event.key === "ArrowUp" ? TIMELINE_RESIZE_STEP : -TIMELINE_RESIZE_STEP;
      setTimelineHeight(timelineHeightRef.current + delta);
    },
    [setTimelineHeight, timelineBounds],
  );

  useEffect(
    () => () => {
      resizingTimelineRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  const layoutStyle: CSSProperties = {
    gridTemplateColumns: `${leftPanelWidth}px ${RESIZE_HANDLE_WIDTH}px minmax(0, 1fr) ${RESIZE_HANDLE_WIDTH}px ${rightPanelWidth}px`,
  };

  const revealInspectorGroup = useCallback(
    (group: InspectorGroupDef) => {
      setOpenInspectorGroups((state) => ({ ...state, [group.id]: true }));
      setRightTab(group.defaultTab);
    },
    [setRightTab],
  );

  const useInEditor = async () => {
    try {
      const instance = await insertMotionInstance(composition.id);
      if (!instance) {
        toast.error(
          "Could not add motion scene",
          "The scene could not be placed on the editor timeline.",
        );
        return;
      }
      toast.success(
        "Motion scene added",
        `${composition.name} is on the editor timeline.`,
      );
      setDesktopPage("edit");
      navigate("editor");
    } catch (error) {
      toast.error(
        "Could not add motion scene",
        error instanceof Error
          ? error.message
          : "The scene could not be placed on the editor timeline.",
      );
    }
  };

  const undoMotionEdit = async () => {
    const result = await undo();
    if (!result.success) {
      toast.error("Undo failed", result.error?.message ?? "Could not undo the last edit.");
    }
  };

  const redoMotionEdit = async () => {
    const result = await redo();
    if (!result.success) {
      toast.error("Redo failed", result.error?.message ?? "Could not redo the last edit.");
    }
  };

  const exportCurrentScene = useCallback(async () => {
    if (isExportingScene) return;
    setIsExportingScene(true);
    setExportActive(true);
    setExportProgress(0);
    try {
      const result = await exportMotionCompositionSceneMp4({
        project,
        composition,
        compositionLibrary: project.motionCompositions ?? [],
        onProgress: (progress) => {
          setExportProgress(Math.round(progress.progress * 100));
        },
      });
      toast.success("Motion scene exported", result.filename);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      console.error("[MotionCreator] Scene export failed:", error);
      toast.error(
        "Motion export failed",
        error instanceof Error ? error.message : "Could not export the scene.",
      );
    } finally {
      setIsExportingScene(false);
      setExportActive(false);
      setExportProgress(null);
    }
  }, [composition, isExportingScene, project, setExportActive]);

  useEffect(() => {
    const openMotionExport = () => {
      void exportCurrentScene();
    };
    window.addEventListener("openreel:menu:export", openMotionExport);
    return () => {
      window.removeEventListener("openreel:menu:export", openMotionExport);
    };
  }, [exportCurrentScene]);

  useEffect(() => {
    const groupId = getInspectorGroupIdForTab(rightTab);
    if (!groupId) return;
    setOpenInspectorGroups((state) =>
      state[groupId] ? state : { ...state, [groupId]: true },
    );
  }, [rightTab, rightTabRevealNonce]);

  useEffect(() => {
    const container = inspectorScrollRef.current;
    if (!container) return;
    const target = container.querySelector(
      `[data-inspector-panel="${rightTab}"]`,
    );
    if (
      target instanceof HTMLElement &&
      typeof target.scrollIntoView === "function"
    ) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [rightTab, rightTabRevealNonce, openInspectorGroups]);

  return (
    <div
      ref={shellRef}
      data-testid="motion-creator-shell"
      className={`flex ${embedded ? "h-full w-full" : "h-screen w-screen"} flex-col overflow-hidden bg-bg font-sans text-fg`}
    >
      <header className="flex h-[60px] shrink-0 items-center gap-[18px] border-b border-border bg-bg-1 px-[18px]">
        <div className="flex min-w-0 shrink-0 items-center gap-[18px]">
          {!embedded ? (
            <WorkspaceModeTabs
              activeMode="motion"
              ariaLabel="Workspaces"
              onSelectMode={(mode) => {
                if (mode === "video") {
                  navigate("editor");
                }
              }}
            />
          ) : null}
        </div>

        <div className="pointer-events-none hidden min-w-0 flex-1 items-center justify-center lg:flex">
          <div className="pointer-events-auto">
            <SceneSwitcher composition={composition} />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <MotionHeaderIconButton
            icon="arrow.uturn.backward"
            label="Undo"
            disabled={!canUndo || isExportingScene}
            onClick={undoMotionEdit}
          />
          <MotionHeaderIconButton
            icon="arrow.uturn.forward"
            label="Redo"
            disabled={!canRedo || isExportingScene}
            onClick={redoMotionEdit}
          />
          <div className="mx-1 h-5 w-px bg-border" />
          <ExportButton
            exporting={isExportingScene}
            progress={exportProgress}
            onExport={exportCurrentScene}
            onUseInEditor={useInEditor}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <MotionToolRail />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg p-2.5">
          <div
            ref={layoutRef}
            data-testid="motion-creator-layout"
            className="grid min-h-0 flex-1"
            style={layoutStyle}
          >
            <aside
              className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-1 shadow-sm"
              style={{ gridColumn: 1, gridRow: 1 }}
            >
              <nav
                aria-label="Motion workspace tabs"
                className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-2"
              >
                {LEFT_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const active = leftTab === tab.id;
                  return (
                    <Button
                      key={tab.id}
                      label={tab.label}
                      icon={<Icon size={14} aria-hidden />}
                      variant={active ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setLeftTab(tab.id)}
                      className="min-w-[4.15rem] flex-1 justify-center"
                    />
                  );
                })}
              </nav>
              <div className="min-h-0 flex-1">
                {leftTab === "start" ? (
                  <MotionStartPanel composition={composition} />
                ) : null}
                {leftTab === "layers" ? <LayerPanel composition={composition} /> : null}
                {leftTab === "creation" ? <CreationWorkspacePanel /> : null}
                {leftTab === "assets" ? <AssetPanel composition={composition} /> : null}
                {leftTab === "templates" ? <MotionTemplateBrowser /> : null}
              </div>
            </aside>

            <PanelResizeHandle
              side="left"
              label="Resize workspace"
              value={leftPanelWidth}
              min={MIN_LEFT_PANEL_WIDTH}
              max={MAX_LEFT_PANEL_WIDTH}
              gridColumn={2}
              gridRow={1}
              onPointerDown={(event) => beginPanelResize("left", event)}
              onDoubleClick={() => resetPanelWidth("left")}
              onKeyDown={(event) => resizePanelFromKey("left", event)}
            />

            <main
              className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-bg-1 shadow-sm"
              style={{ gridColumn: 3, gridRow: 1 }}
            >
              <StageCanvas composition={composition} />
            </main>

            <PanelResizeHandle
              side="right"
              label="Resize inspector"
              value={rightPanelWidth}
              min={MIN_RIGHT_PANEL_WIDTH}
              max={MAX_RIGHT_PANEL_WIDTH}
              gridColumn={4}
              gridRow={1}
              onPointerDown={(event) => beginPanelResize("right", event)}
              onDoubleClick={() => resetPanelWidth("right")}
              onKeyDown={(event) => resizePanelFromKey("right", event)}
            />

            <aside
              className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-1 shadow-sm"
              style={{ gridColumn: 5, gridRow: 1 }}
            >
              <div className="shrink-0 border-b border-border px-3.5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold leading-tight text-fg">
                    {inspectorSubtitle}
                  </div>
                  <div className="truncate text-[11px] leading-tight text-fg-3">
                    {inspectorType}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {INSPECTOR_GROUPS.map((group) => {
                    const Icon = group.icon;
                    const active = group.panels.some((panel) => panel.id === rightTab);
                    return (
                      <Button
                        key={group.id}
                        label={group.label}
                        icon={<Icon size={13} aria-hidden />}
                        variant={active ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => revealInspectorGroup(group)}
                        className="justify-start"
                      />
                    );
                  })}
                </div>
              </div>
              <SectionDefaultsContext.Provider value={{ collapseAll: true }}>
                <div
                  ref={inspectorScrollRef}
                  className="min-h-0 flex-1 overflow-auto"
                >
                  {INSPECTOR_GROUPS.map((group) => (
                    <InspectorWorkflowGroup
                      key={group.id}
                      group={group}
                      composition={composition}
                      activeTab={rightTab}
                      open={openInspectorGroups[group.id]}
                      onToggle={() =>
                        setOpenInspectorGroups((state) => ({
                          ...state,
                          [group.id]: !state[group.id],
                        }))
                      }
                      onSelectPanel={setRightTab}
                    />
                  ))}
                </div>
              </SectionDefaultsContext.Provider>
            </aside>
          </div>
        </div>
      </div>

      <section
        className="relative shrink-0 bg-bg px-2.5 pb-2.5"
        style={{ height: `${timelineHeight}px` }}
      >
        <TimelineResizeHandle
          value={timelineHeight}
          min={MIN_TIMELINE_HEIGHT}
          max={timelineBounds()[1]}
          onPointerDown={beginTimelineResize}
          onDoubleClick={resetTimelineHeight}
          onKeyDown={resizeTimelineFromKey}
        />
        <div className="h-full overflow-hidden rounded-xl border border-border bg-bg-1 shadow-sm">
          <MotionTimeline composition={composition} />
        </div>
      </section>

      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-bg-1 px-2.5 text-[11px] text-fg-muted">
        <div className="flex items-center gap-2">
          {parentCompositionId ? (
            <Button
              label="Back"
              variant="ghost"
              size="sm"
              icon={<ChevronLeft size={13} aria-hidden />}
              tooltip={
                parentComposition
                  ? `Back to ${parentComposition.name}`
                  : "Back to parent scene"
              }
              onClick={goBackComposition}
            />
          ) : null}
          <div className="flex items-center gap-0.5">
            <FooterToggle
              icon={LayoutGrid}
              label="Show layer switches"
              active={timelineColumnMode === "switches"}
              onClick={() => setTimelineColumnMode("switches")}
            />
            <FooterToggle
              icon={SlidersHorizontal}
              label="Show transfer modes"
              active={timelineColumnMode === "modes"}
              onClick={() => setTimelineColumnMode("modes")}
            />
            <FooterToggle
              icon={Diamond}
              label={autoKeyframe ? "Auto-keyframe on" : "Auto-keyframe off"}
              active={autoKeyframe}
              onClick={() => setAutoKeyframe(!autoKeyframe)}
            />
          </div>
          <span className="tabular-nums">
            Frame Render Time: <span className="text-fg-3">2.1ms</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {exportProgress !== null ? (
            <span className="tabular-nums text-accent">Exporting {exportProgress}%</span>
          ) : null}
          <span className="text-fg-3">{composition.width}×{composition.height}</span>
          <span>Toggle Switches / Modes</span>
        </div>
      </footer>
    </div>
  );
}

function InspectorWorkflowGroup({
  group,
  composition,
  activeTab,
  open,
  onToggle,
  onSelectPanel,
}: {
  group: InspectorGroupDef;
  composition: MotionComposition;
  activeTab: MotionRightTab;
  open: boolean;
  onToggle: () => void;
  onSelectPanel: (tab: MotionRightTab) => void;
}): JSX.Element {
  const GroupIcon = group.icon;
  const hasActivePanel = group.panels.some((panel) => panel.id === activeTab);

  return (
    <section className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors ${
          hasActivePanel ? "bg-selected text-accent" : "text-fg hover:bg-bg-2"
        }`}
      >
        <ChevronRight
          size={13}
          aria-hidden
          className={`shrink-0 transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
        />
        <GroupIcon size={14} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {group.label}
        </span>
      </button>
      {open ? (
        <div className="divide-y divide-border">
          {group.panels.map((panel) => {
            const active = panel.id === activeTab;
            return (
              <div key={`${group.id}-${panel.id}`} data-inspector-panel={panel.id}>
                <button
                  type="button"
                  onClick={() => onSelectPanel(panel.id)}
                  className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[12px] font-semibold transition-colors ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "bg-bg-1 text-fg-2 hover:bg-bg-2"
                  }`}
                >
                  <span className="truncate">{panel.label}</span>
                  {active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  ) : null}
                </button>
                <div className={active ? "" : "bg-bg-1"}>
                  {panel.render(composition)}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function FooterToggle({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={Icon}
      iconSize={13}
      size="sm"
      active={active}
      variant="ghost"
      onClick={onClick}
    />
  );
}

function MotionHeaderIconButton({
  icon,
  label,
  active = false,
  disabled = false,
  variant = "ghost",
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  variant?: "ghost" | "solid";
  onClick?: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={<Icon name={icon} size={14} ariaHidden />}
      size="sm"
      variant={variant}
      active={active}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function ExportButton({
  exporting,
  progress,
  onExport,
  onUseInEditor,
}: {
  exporting: boolean;
  progress: number | null;
  onExport: () => void;
  onUseInEditor: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="flex items-stretch overflow-hidden rounded-[8px] shadow-sm">
        <button
          type="button"
          aria-label="Export"
          disabled={exporting}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center bg-accent px-[18px] py-[9px] text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          {exporting ? `${progress ?? 0}%` : "Export"}
        </button>
        <button
          type="button"
          aria-label="Export options"
          aria-expanded={open}
          disabled={exporting}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center justify-center border-l border-white/25 bg-accent px-2 text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          <Icon name="chevron.down" size={12} ariaHidden />
        </button>
      </div>
      {open ? (
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 overflow-hidden rounded-lg border border-border bg-bg-elev p-1.5 shadow-lg">
            <Button
              label="Export video (MP4)"
              variant="ghost"
              size="sm"
              icon={<Icon name="square.and.arrow.up" size={15} ariaHidden className="text-fg-3" />}
              onClick={() => {
                onExport();
                setOpen(false);
              }}
              className="w-full justify-start"
            />
            <Button
              label="Use in Editor"
              variant="ghost"
              size="sm"
              icon={<Icon name="paperplane" size={15} ariaHidden className="text-fg-3" />}
              onClick={() => {
                onUseInEditor();
                setOpen(false);
              }}
              className="w-full justify-start"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function TimelineResizeHandle({
  value,
  min,
  max,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: {
  value: number;
  min: number;
  max: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title="Resize timeline"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className="group absolute left-0 top-0 z-20 h-3 w-full cursor-row-resize outline-none"
    >
      <span className="absolute inset-x-0 top-0 h-px bg-border transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
      <span className="absolute left-1/2 top-1 h-1 w-16 -translate-x-1/2 rounded-full bg-fg-muted/25 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>
  );
}

function PanelResizeHandle({
  side,
  label,
  value,
  min,
  max,
  gridColumn,
  gridRow,
  onPointerDown,
  onDoubleClick,
  onKeyDown,
}: {
  side: MotionPanelSide;
  label: string;
  value: number;
  min: number;
  max: number;
  gridColumn: number;
  gridRow: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}): JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={label}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className="group relative cursor-col-resize bg-border/70 outline-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:ring-2 focus-visible:ring-accent"
      style={{ gridColumn, gridRow }}
    >
      <span
        className={`pointer-events-none absolute top-3 bottom-3 w-px rounded-full bg-fg-muted/35 transition-colors group-hover:bg-accent group-focus-visible:bg-accent ${
          side === "left" ? "right-1" : "left-1"
        }`}
      />
    </div>
  );
}

function SceneSwitcher({
  composition,
}: {
  composition: MotionComposition;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const compositions = useProjectStore(
    (state) => state.project.motionCompositions ?? [],
  );
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );

  const selectComposition = (id: string) => {
    setActiveCompositionId(id);
    setOpen(false);
  };

  const createScene = async () => {
    const created = await createMotionComposition("Motion Scene");
    if (created) setActiveCompositionId(created.id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        label={composition.name}
        variant="ghost"
        size="sm"
        endContent={<Icon name="chevron.down" size={15} ariaHidden className="shrink-0 text-fg-muted" />}
        onClick={() => setOpen((value) => !value)}
        className="max-w-[260px]"
      />

      {open ? (
        <>
          <div
            role="presentation"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-1/2 top-[calc(100%+6px)] z-50 w-72 -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg-elev shadow-lg">
            <ToolcraftText
              type="label"
              color="secondary"
              weight="semibold"
              className="border-b border-border px-3 py-2 uppercase tracking-[0.08em]"
            >
              Sequences · {compositions.length}
            </ToolcraftText>
            <div className="max-h-72 overflow-auto p-1.5">
              {compositions.map((scene) => {
                const active = scene.id === composition.id;
                return (
                  <ToolcraftClickableCard
                    key={scene.id}
                    label={`Open ${scene.name}`}
                    onClick={() => selectComposition(scene.id)}
                    active={active}
                    variant={active ? "selected" : "transparent"}
                    padding={2}
                  >
                    <span className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1">
                      <ToolcraftText
                        type="body"
                        color={active ? "active" : "primary"}
                        weight="medium"
                        maxLines={1}
                      >
                        {scene.name}
                      </ToolcraftText>
                      <ToolcraftText type="supporting" color="secondary" className="tabular-nums">
                        {scene.width}×{scene.height} · {scene.duration.toFixed(1)}s
                      </ToolcraftText>
                    </span>
                    {active ? (
                      <Icon name="checkmark" size={15} ariaHidden className="shrink-0 text-accent" />
                    ) : null}
                    </span>
                  </ToolcraftClickableCard>
                );
              })}
            </div>
            <Button
              label="New sequence"
              icon={<Plus size={15} aria-hidden />}
              variant="ghost"
              size="sm"
              onClick={createScene}
              className="w-full justify-start border-t border-border"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
