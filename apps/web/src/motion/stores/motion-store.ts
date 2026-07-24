import { create } from "zustand";
import type {
  MotionExportRange,
  MotionExportResolutionScale,
} from "../export-motion-frame";
import type {
  MotionStagePreviewMode,
  MotionStagePreviewResolution,
} from "../stage-preview-mode";
import { normalizeMotionStagePreviewSettings } from "../stage-preview-mode";

export type MotionLeftTab =
  | "start"
  | "layers"
  | "assets"
  | "templates"
  | "creation";
export type MotionRightTab =
  | "properties"
  | "deform"
  | "presets"
  | "sync"
  | "tracker"
  | "graph"
  | "effects"
  | "masks"
  | "variables"
  | "queue";

export type MotionToolId =
  | "select"
  | "hand"
  | "zoom"
  | "move"
  | "rotate"
  | "anchor"
  | "pen"
  | "rectangle"
  | "ellipse"
  | "text"
  | "character"
  | "add";

export type MotionPreviewCameraView = "active" | "default";

export type MotionTimelineColumnMode = "switches" | "modes";

export type MotionRenderQueueStatus =
  | "queued"
  | "rendering"
  | "complete"
  | "failed"
  | "canceled";

export type MotionRenderQueueFormat =
  | "mp4"
  | "webm-alpha"
  | "mov-prores4444"
  | "png-sequence";

export type MotionRenderQueueMoveDirection = "up" | "down";

export interface MotionRenderQueueItem {
  readonly id: string;
  readonly compositionId: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly format: MotionRenderQueueFormat;
  readonly status: MotionRenderQueueStatus;
  readonly progress: number;
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly outputFilename?: string;
  readonly error?: string;
  readonly range?: MotionExportRange;
  readonly resolutionScale?: MotionExportResolutionScale;
  readonly cancelRequested?: boolean;
}

export interface AddMotionRenderQueueItemInput {
  readonly compositionId: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly format?: MotionRenderQueueFormat;
  readonly range?: MotionExportRange;
  readonly resolutionScale?: MotionExportResolutionScale;
}

export interface MotionLayerSelectionOptions {
  readonly additive?: boolean;
}

export interface MotionKeyframeSelectionOptions {
  readonly additive?: boolean;
}

export interface MotionRevealedProperties {
  readonly layerId: string;
  readonly properties: readonly string[];
}

interface MotionSurfaceState {
  activeCompositionId: string | null;
  compositionNavigationStack: string[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  selectedKeyframeIds: string[];
  selectedLightId: string | null;
  selectedAudioClipId: string | null;
  selectedProperty: string | null;
  revealedProperties: MotionRevealedProperties | null;
  playhead: number;
  isPlaying: boolean;
  loopPlayback: boolean;
  previewMuted: boolean;
  playbackRate: number;
  previewMode: MotionStagePreviewMode;
  previewResolution: MotionStagePreviewResolution;
  workAreaStart: number | null;
  workAreaEnd: number | null;
  autoKeyframe: boolean;
  snapEnabled: boolean;
  showStageGrid: boolean;
  showStageGuides: boolean;
  gridSize: number;
  zoom: number;
  stagePanX: number;
  stagePanY: number;
  activeTool: MotionToolId;
  maskDrawMode: boolean;
  showSafeMargins: boolean;
  showTransparencyGrid: boolean;
  previewCameraView: MotionPreviewCameraView;
  timelineColumnMode: MotionTimelineColumnMode;
  leftTab: MotionLeftTab;
  rightTab: MotionRightTab;
  rightTabRevealNonce: number;
  renderQueue: MotionRenderQueueItem[];
  exportActive: boolean;
  setActiveCompositionId: (compositionId: string | null) => void;
  openComposition: (
    compositionId: string,
    parentCompositionId?: string | null,
  ) => void;
  goBackComposition: () => void;
  selectLayer: (
    layerId: string | null,
    options?: MotionLayerSelectionOptions,
  ) => void;
  setSelectedLayers: (layerIds: readonly string[]) => void;
  toggleLayerSelection: (layerId: string) => void;
  selectKeyframe: (
    keyframeId: string | null,
    options?: MotionKeyframeSelectionOptions,
  ) => void;
  setSelectedKeyframes: (keyframeIds: readonly string[]) => void;
  selectLight: (lightId: string | null, property?: string | null) => void;
  selectAudioClip: (audioClipId: string | null) => void;
  setSelectedProperty: (property: string | null) => void;
  togglePropertyReveal: (
    layerId: string,
    properties: readonly string[],
  ) => void;
  clearPropertyReveal: () => void;
  setPlayhead: (playhead: number) => void;
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  setExportActive: (active: boolean) => void;
  setLoopPlayback: (loop: boolean) => void;
  setPreviewMuted: (muted: boolean) => void;
  togglePreviewMuted: () => void;
  setPlaybackRate: (rate: number) => void;
  setPreviewMode: (mode: MotionStagePreviewMode) => void;
  setPreviewResolution: (resolution: MotionStagePreviewResolution) => void;
  setWorkArea: (start: number, end: number) => void;
  clearWorkArea: () => void;
  setAutoKeyframe: (enabled: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setShowStageGrid: (visible: boolean) => void;
  setShowStageGuides: (visible: boolean) => void;
  setGridSize: (size: number) => void;
  setZoom: (zoom: number) => void;
  setStagePan: (x: number, y: number) => void;
  resetStagePan: () => void;
  setActiveTool: (tool: MotionToolId) => void;
  setMaskDrawMode: (enabled: boolean) => void;
  setShowSafeMargins: (visible: boolean) => void;
  setShowTransparencyGrid: (visible: boolean) => void;
  setPreviewCameraView: (view: MotionPreviewCameraView) => void;
  setTimelineColumnMode: (mode: MotionTimelineColumnMode) => void;
  setLeftTab: (tab: MotionLeftTab) => void;
  setRightTab: (tab: MotionRightTab) => void;
  addRenderQueueItem: (item: AddMotionRenderQueueItemInput) => string;
  updateRenderQueueItem: (
    itemId: string,
    updates: Partial<Omit<MotionRenderQueueItem, "id" | "createdAt">>,
  ) => void;
  removeRenderQueueItem: (itemId: string) => void;
  moveRenderQueueItem: (
    itemId: string,
    direction: MotionRenderQueueMoveDirection,
  ) => void;
  cancelRenderQueueItem: (itemId: string) => void;
  clearRenderQueue: () => void;
  clearCompletedRenderQueueItems: () => void;
}

export const useMotionStore = create<MotionSurfaceState>((set) => ({
  activeCompositionId: null,
  compositionNavigationStack: [],
  selectedLayerId: null,
  selectedLayerIds: [],
  selectedKeyframeIds: [],
  selectedLightId: null,
  selectedAudioClipId: null,
  selectedProperty: null,
  revealedProperties: null,
  playhead: 0,
  isPlaying: false,
  loopPlayback: true,
  previewMuted: false,
  playbackRate: 1,
  previewMode: "final",
  previewResolution: "full",
  workAreaStart: null,
  workAreaEnd: null,
  autoKeyframe: false,
  snapEnabled: true,
  showStageGrid: true,
  showStageGuides: true,
  gridSize: 40,
  zoom: 1,
  stagePanX: 0,
  stagePanY: 0,
  activeTool: "select",
  maskDrawMode: false,
  showSafeMargins: false,
  showTransparencyGrid: false,
  previewCameraView: "active",
  timelineColumnMode: "switches",
  leftTab: "start",
  rightTab: "properties",
  rightTabRevealNonce: 0,
  renderQueue: [],
  exportActive: false,
  setActiveCompositionId: (compositionId) =>
    set({
      activeCompositionId: compositionId,
      compositionNavigationStack: [],
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedKeyframeIds: [],
      selectedLightId: null,
      selectedAudioClipId: null,
      selectedProperty: null,
      playhead: 0,
      isPlaying: false,
      workAreaStart: null,
      workAreaEnd: null,
      stagePanX: 0,
      stagePanY: 0,
    }),
  openComposition: (compositionId, parentCompositionId) =>
    set((state) => {
      if (state.activeCompositionId === compositionId) {
        return {};
      }
      const parentId = parentCompositionId ?? state.activeCompositionId;
      return {
        activeCompositionId: compositionId,
        compositionNavigationStack: parentId
          ? [...state.compositionNavigationStack, parentId]
          : state.compositionNavigationStack,
        selectedLayerId: null,
        selectedLayerIds: [],
        selectedKeyframeIds: [],
        selectedLightId: null,
        selectedAudioClipId: null,
        selectedProperty: null,
        playhead: 0,
        isPlaying: false,
        workAreaStart: null,
        workAreaEnd: null,
        stagePanX: 0,
        stagePanY: 0,
      };
    }),
  goBackComposition: () =>
    set((state) => {
      const parentId =
        state.compositionNavigationStack[
          state.compositionNavigationStack.length - 1
        ];
      if (!parentId) return {};
      return {
        activeCompositionId: parentId,
        compositionNavigationStack: state.compositionNavigationStack.slice(0, -1),
        selectedLayerId: null,
        selectedLayerIds: [],
        selectedKeyframeIds: [],
        selectedLightId: null,
        selectedAudioClipId: null,
        selectedProperty: null,
        playhead: 0,
        isPlaying: false,
        workAreaStart: null,
        workAreaEnd: null,
        stagePanX: 0,
        stagePanY: 0,
      };
    }),
  selectLayer: (layerId, options = {}) =>
    set((state) => {
      const nextSelection = resolveLayerSelectionState(
        layerId,
        options.additive
          ? toggleLayerId(state.selectedLayerIds, layerId)
          : layerId
            ? [layerId]
            : [],
        state.selectedProperty,
      );
      return {
        ...nextSelection,
        selectedLightId: null,
        selectedAudioClipId: null,
        selectedKeyframeIds: layerSelectionMatches(state, nextSelection)
          ? state.selectedKeyframeIds
          : [],
      };
    }),
  setSelectedLayers: (layerIds) =>
    set((state) => {
      const nextSelection = resolveLayerSelectionState(
          getLastLayerId(layerIds),
          normalizeLayerIds(layerIds),
          state.selectedProperty,
        );
      return {
        ...nextSelection,
        selectedLightId: null,
        selectedAudioClipId: null,
        selectedKeyframeIds: layerSelectionMatches(state, nextSelection)
          ? state.selectedKeyframeIds
          : [],
      };
    }),
  toggleLayerSelection: (layerId) =>
    set((state) =>
      ({
        ...resolveLayerSelectionState(
          layerId,
          toggleLayerId(state.selectedLayerIds, layerId),
          state.selectedProperty,
        ),
        selectedLightId: null,
        selectedAudioClipId: null,
        selectedKeyframeIds: [],
      }),
    ),
  selectLight: (lightId, property = "light.intensity") =>
    set((state) => ({
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedLightId: lightId,
      selectedAudioClipId: null,
      selectedProperty: lightId ? property ?? "light.intensity" : null,
      selectedKeyframeIds:
        state.selectedLightId === lightId ? state.selectedKeyframeIds : [],
    })),
  selectAudioClip: (audioClipId) =>
    set({
      selectedLayerId: null,
      selectedLayerIds: [],
      selectedKeyframeIds: [],
      selectedLightId: null,
      selectedAudioClipId: audioClipId,
      selectedProperty: null,
    }),
  selectKeyframe: (keyframeId, options = {}) =>
    set((state) => ({
      selectedKeyframeIds: options.additive
        ? toggleSelectionId(state.selectedKeyframeIds, keyframeId)
        : keyframeId
          ? [keyframeId]
          : [],
    })),
  setSelectedKeyframes: (keyframeIds) =>
    set({ selectedKeyframeIds: normalizeSelectionIds(keyframeIds) }),
  setSelectedProperty: (property) => set({ selectedProperty: property }),
  togglePropertyReveal: (layerId, properties) =>
    set((state) => {
      const normalized = normalizeRevealProperties(properties);
      if (normalized.length === 0) {
        return state.revealedProperties?.layerId === layerId
          ? { revealedProperties: null }
          : {};
      }
      const current = state.revealedProperties;
      if (
        current &&
        current.layerId === layerId &&
        revealPropertiesEqual(current.properties, normalized)
      ) {
        return { revealedProperties: null };
      }
      return { revealedProperties: { layerId, properties: normalized } };
    }),
  clearPropertyReveal: () => set({ revealedProperties: null }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  play: () =>
    set((state) => (state.exportActive ? {} : { isPlaying: true })),
  pause: () => set({ isPlaying: false }),
  togglePlayback: () =>
    set((state) =>
      state.exportActive ? {} : { isPlaying: !state.isPlaying },
    ),
  setExportActive: (exportActive) =>
    set({ exportActive, ...(exportActive ? { isPlaying: false } : {}) }),
  setLoopPlayback: (loopPlayback) => set({ loopPlayback }),
  setPreviewMuted: (previewMuted) => set({ previewMuted }),
  togglePreviewMuted: () =>
    set((state) => ({ previewMuted: !state.previewMuted })),
  setPlaybackRate: (rate) =>
    set({
      playbackRate: Math.min(4, Math.max(0.25, Number.isFinite(rate) ? rate : 1)),
    }),
  setPreviewMode: (mode) =>
    set((state) => ({
      previewMode: normalizeMotionStagePreviewSettings({
        mode,
        resolution: state.previewResolution,
      }).mode,
    })),
  setPreviewResolution: (resolution) =>
    set((state) => ({
      previewResolution: normalizeMotionStagePreviewSettings({
        mode: state.previewMode,
        resolution,
      }).resolution,
    })),
  setWorkArea: (start, end) => {
    const safeStart = Math.max(0, Number.isFinite(start) ? start : 0);
    const safeEnd = Math.max(
      safeStart + 1 / 1000,
      Number.isFinite(end) ? end : safeStart + 1,
    );
    set({ workAreaStart: safeStart, workAreaEnd: safeEnd });
  },
  clearWorkArea: () => set({ workAreaStart: null, workAreaEnd: null }),
  setAutoKeyframe: (autoKeyframe) => set({ autoKeyframe }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setShowStageGrid: (showStageGrid) => set({ showStageGrid }),
  setShowStageGuides: (showStageGuides) => set({ showStageGuides }),
  setGridSize: (size) =>
    set({
      gridSize: Math.min(240, Math.max(4, Number.isFinite(size) ? size : 40)),
    }),
  setZoom: (zoom) => set({ zoom: Math.min(2, Math.max(0.25, zoom)) }),
  setStagePan: (x, y) =>
    set({
      stagePanX: Number.isFinite(x) ? x : 0,
      stagePanY: Number.isFinite(y) ? y : 0,
    }),
  resetStagePan: () => set({ stagePanX: 0, stagePanY: 0 }),
  setActiveTool: (activeTool) =>
    set((state) => ({
      activeTool,
      maskDrawMode: activeTool === "pen" ? state.maskDrawMode : false,
    })),
  setMaskDrawMode: (maskDrawMode) => set({ maskDrawMode }),
  setShowSafeMargins: (showSafeMargins) => set({ showSafeMargins }),
  setShowTransparencyGrid: (showTransparencyGrid) =>
    set({ showTransparencyGrid }),
  setPreviewCameraView: (previewCameraView) => set({ previewCameraView }),
  setTimelineColumnMode: (timelineColumnMode) => set({ timelineColumnMode }),
  setLeftTab: (tab) => set({ leftTab: tab }),
  setRightTab: (tab) =>
    set((state) => ({
      rightTab: tab,
      rightTabRevealNonce: state.rightTabRevealNonce + 1,
    })),
  addRenderQueueItem: (item) => {
    const id = `motion-render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      renderQueue: [
        ...state.renderQueue,
        {
          ...item,
          id,
          format: item.format ?? "mp4",
          status: "queued",
          progress: 0,
          createdAt: Date.now(),
        },
      ],
    }));
    return id;
  },
  updateRenderQueueItem: (itemId, updates) =>
    set((state) => ({
      renderQueue: state.renderQueue.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item,
      ),
    })),
  removeRenderQueueItem: (itemId) =>
    set((state) => ({
      renderQueue: state.renderQueue.filter((item) => item.id !== itemId),
    })),
  moveRenderQueueItem: (itemId, direction) =>
    set((state) => {
      const index = state.renderQueue.findIndex((item) => item.id === itemId);
      if (index < 0) return state;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.renderQueue.length) return state;
      const next = [...state.renderQueue];
      const moved = next[index];
      next[index] = next[target];
      next[target] = moved;
      return { renderQueue: next };
    }),
  cancelRenderQueueItem: (itemId) =>
    set((state) => ({
      renderQueue: state.renderQueue.map((item) => {
        if (item.id !== itemId) return item;
        if (item.status === "queued" || item.status === "failed") {
          return {
            ...item,
            status: "canceled",
            cancelRequested: true,
            completedAt: Date.now(),
          };
        }
        if (item.status === "rendering") {
          return { ...item, cancelRequested: true };
        }
        return item;
      }),
    })),
  clearRenderQueue: () => set({ renderQueue: [] }),
  clearCompletedRenderQueueItems: () =>
    set((state) => ({
      renderQueue: state.renderQueue.filter(
        (item) => item.status !== "complete" && item.status !== "failed",
      ),
    })),
}));

function normalizeRevealProperties(
  properties: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const property of properties) {
    if (typeof property !== "string") continue;
    const trimmed = property.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function revealPropertiesEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((property) => setA.has(property));
}

function resolveLayerSelectionState(
  requestedLayerId: string | null,
  selectedLayerIds: readonly string[],
  selectedProperty: string | null,
): Pick<
  MotionSurfaceState,
  "selectedLayerId" | "selectedLayerIds" | "selectedProperty"
> {
  const normalizedLayerIds = normalizeLayerIds(selectedLayerIds);
  const selectedLayerId =
    requestedLayerId && normalizedLayerIds.includes(requestedLayerId)
      ? requestedLayerId
      : getLastLayerId(normalizedLayerIds);

  return {
    selectedLayerId,
    selectedLayerIds: normalizedLayerIds,
    selectedProperty: selectedLayerId
      ? selectedProperty ?? "transform.position.x"
      : null,
  };
}

function toggleLayerId(
  layerIds: readonly string[],
  layerId: string | null,
): string[] {
  if (!layerId) return [];
  const selected = new Set(layerIds);
  if (selected.has(layerId)) {
    selected.delete(layerId);
  } else {
    selected.add(layerId);
  }
  return Array.from(selected);
}

function toggleSelectionId(
  selectedIds: readonly string[],
  selectedId: string | null,
): string[] {
  if (!selectedId) return [];
  const selected = new Set(selectedIds);
  if (selected.has(selectedId)) selected.delete(selectedId);
  else selected.add(selectedId);
  return Array.from(selected);
}

function normalizeSelectionIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function layerSelectionMatches(
  state: Pick<MotionSurfaceState, "selectedLayerId" | "selectedLayerIds">,
  next: Pick<MotionSurfaceState, "selectedLayerId" | "selectedLayerIds">,
): boolean {
  if (state.selectedLayerId !== next.selectedLayerId) return false;
  if (state.selectedLayerIds.length !== next.selectedLayerIds.length) return false;
  const current = new Set(state.selectedLayerIds);
  return next.selectedLayerIds.every((id) => current.has(id));
}

function normalizeLayerIds(layerIds: readonly string[]): string[] {
  return Array.from(new Set(layerIds.filter(Boolean)));
}

function getLastLayerId(layerIds: readonly string[]): string | null {
  return layerIds[layerIds.length - 1] ?? null;
}
