import { create } from "zustand";
import { subscribeWithSelector, persist } from "zustand/middleware";

export type PanelId =
  | "mediaLibrary"
  | "inspector"
  | "effects"
  | "audioMixer"
  | "colorGrading"
  | "subtitles";

export type SelectionType =
  | "clip"
  | "track"
  | "effect"
  | "keyframe"
  | "marker"
  | "text-clip"
  | "shape-clip"
  | "subtitle";

export interface SelectionItem {
  type: SelectionType;
  id: string;
  trackId?: string;
}

export interface SnapSettings {
  enabled: boolean;
  snapToGrid: boolean;
  snapToClips: boolean;
  snapToPlayhead: boolean;
  snapToMarkers: boolean;
  gridSize: number;
  snapThreshold: number;
}

export interface PanelState {
  visible: boolean;
  width?: number;
  height?: number;
  collapsed?: boolean;
}

export interface KeyboardShortcuts {
  playPause: string;
  undo: string;
  redo: string;
  delete: string;
  split: string;
  copy: string;
  paste: string;
  cut: string;
  selectAll: string;
  zoomIn: string;
  zoomOut: string;
  zoomFit: string;
}

export interface UIState {
  selectedItems: SelectionItem[];
  lastSelectedItem: SelectionItem | null;
  snapSettings: SnapSettings;
  panels: Record<PanelId, PanelState>;
  shortcuts: KeyboardShortcuts;
  theme: "light" | "dark" | "system";
  showWaveforms: boolean;
  showThumbnails: boolean;
  showKeyframes: boolean;
  autoScroll: boolean;
  activeModal: string | null;
  modalData: Record<string, unknown> | null;
  contextMenu: {
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null;
  isDragging: boolean;
  dragType: "clip" | "media" | "effect" | "keyframe" | null;
  dragData: Record<string, unknown> | null;
  cropMode: boolean;
  cropClipId: string | null;
  showWelcomeScreen: boolean;
  skipWelcomeScreen: boolean;
  motionPathMode: boolean;
  motionPathClipId: string | null;
  keyframeEditorOpen: boolean;
  select: (item: SelectionItem, addToSelection?: boolean) => void;
  selectMultiple: (items: SelectionItem[]) => void;
  deselect: (itemId: string) => void;
  clearSelection: () => void;
  isSelected: (itemId: string) => boolean;
  getSelectedClipIds: () => string[];
  getSelectedTrackIds: () => string[];
  setSnapEnabled: (enabled: boolean) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setSnapToClips: (enabled: boolean) => void;
  setSnapToPlayhead: (enabled: boolean) => void;
  setSnapToMarkers: (enabled: boolean) => void;
  setGridSize: (size: number) => void;
  setSnapThreshold: (threshold: number) => void;
  toggleSnap: () => void;
  togglePanel: (panelId: PanelId) => void;
  setPanelVisible: (panelId: PanelId, visible: boolean) => void;
  setPanelWidth: (panelId: PanelId, width: number) => void;
  setPanelCollapsed: (panelId: PanelId, collapsed: boolean) => void;
  setShortcut: (action: keyof KeyboardShortcuts, shortcut: string) => void;
  resetShortcuts: () => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setShowWaveforms: (show: boolean) => void;
  setShowThumbnails: (show: boolean) => void;
  setShowKeyframes: (show: boolean) => void;
  setAutoScroll: (enabled: boolean) => void;
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  hideContextMenu: () => void;
  startDrag: (
    type: "clip" | "media" | "effect" | "keyframe",
    data: Record<string, unknown>,
  ) => void;
  endDrag: () => void;
  setCropMode: (enabled: boolean, clipId?: string) => void;
  setShowWelcomeScreen: (show: boolean) => void;
  setSkipWelcomeScreen: (skip: boolean) => void;
  setMotionPathMode: (enabled: boolean, clipId?: string) => void;
  setKeyframeEditorOpen: (open: boolean) => void;
  toggleKeyframeEditor: () => void;
  exportState: {
    isExporting: boolean;
    progress: number;
    phase: string;
  };
  setExportState: (state: {
    isExporting: boolean;
    progress: number;
    phase: string;
  }) => void;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
  children?: ContextMenuItem[];
}

const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  playPause: "Space",
  undo: "Meta+z",
  redo: "Meta+Shift+z",
  delete: "Backspace",
  split: "s",
  copy: "Meta+c",
  paste: "Meta+v",
  cut: "Meta+x",
  selectAll: "Meta+a",
  zoomIn: "=",
  zoomOut: "-",
  zoomFit: "Shift+z",
};

const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  snapToGrid: true,
  snapToClips: true,
  snapToPlayhead: true,
  snapToMarkers: true,
  gridSize: 1, // 1 second
  snapThreshold: 10, // 10 pixels
};

const DEFAULT_PANELS: Record<PanelId, PanelState> = {
  mediaLibrary: { visible: true, width: 300 },
  inspector: { visible: true, width: 300 },
  effects: { visible: false, width: 300 },
  audioMixer: { visible: false, width: 300 },
  colorGrading: { visible: false, width: 400 },
  subtitles: { visible: false, width: 300 },
};

export const useUIStore = create<UIState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        selectedItems: [],
        lastSelectedItem: null,

        snapSettings: DEFAULT_SNAP_SETTINGS,

        panels: DEFAULT_PANELS,

        shortcuts: DEFAULT_SHORTCUTS,

        theme: "dark",
        showWaveforms: true,
        showThumbnails: true,
        showKeyframes: true,
        autoScroll: true,

        activeModal: null,
        modalData: null,

        contextMenu: null,

        isDragging: false,
        dragType: null,
        dragData: null,

        cropMode: false,
        cropClipId: null,

        motionPathMode: false,
        motionPathClipId: null,

        keyframeEditorOpen: false,

        showWelcomeScreen: true,
        skipWelcomeScreen: false,

        exportState: {
          isExporting: false,
          progress: 0,
          phase: "",
        },

        setExportState: (state) => set({ exportState: state }),

        select: (item: SelectionItem, addToSelection = false) => {
          const { selectedItems } = get();
          if (addToSelection) {
            // Multi-select mode: only add item if not already selected to prevent duplicates
            const isAlreadySelected = selectedItems.some(
              (s) => s.id === item.id,
            );
            if (!isAlreadySelected) {
              set({
                selectedItems: [...selectedItems, item],
                lastSelectedItem: item, // Track most recent selection for extended selections
              });
            }
          } else {
            // Single-select mode: clear previous selection and select only this item
            set({
              selectedItems: [item],
              lastSelectedItem: item,
            });
          }
        },

        selectMultiple: (items: SelectionItem[]) => {
          set({
            selectedItems: items,
            lastSelectedItem: items.length > 0 ? items[items.length - 1] : null,
          });
        },

        deselect: (itemId: string) => {
          const { selectedItems, lastSelectedItem } = get();
          const newSelection = selectedItems.filter((s) => s.id !== itemId);
          set({
            selectedItems: newSelection,
            // If deselecting the lastSelectedItem, promote the newest remaining item
            // This prevents lastSelectedItem from pointing to a non-existent item
            lastSelectedItem:
              lastSelectedItem?.id === itemId
                ? newSelection.length > 0
                  ? newSelection[newSelection.length - 1] // Use last item in remaining selection
                  : null
                : lastSelectedItem,
          });
        },

        clearSelection: () => {
          set({
            selectedItems: [],
            lastSelectedItem: null,
          });
        },

        isSelected: (itemId: string) => {
          const { selectedItems } = get();
          return selectedItems.some((s) => s.id === itemId);
        },

        getSelectedClipIds: () => {
          const { selectedItems } = get();
          // Filter selections to include all clip-like types (video/audio/text/shape clips)
          // Excludes track, effect, keyframe, and marker selections
          return selectedItems
            .filter(
              (s) =>
                s.type === "clip" ||
                s.type === "text-clip" ||
                s.type === "shape-clip",
            )
            .map((s) => s.id);
        },

        getSelectedTrackIds: () => {
          const { selectedItems } = get();
          // Filter selections to only track types, excluding all clip and effect selections
          return selectedItems
            .filter((s) => s.type === "track")
            .map((s) => s.id);
        },

        setSnapEnabled: (enabled: boolean) => {
          set((state) => ({
            snapSettings: { ...state.snapSettings, enabled },
          }));
        },

        setSnapToGrid: (enabled: boolean) => {
          set((state) => ({
            snapSettings: { ...state.snapSettings, snapToGrid: enabled },
          }));
        },

        setSnapToClips: (enabled: boolean) => {
          set((state) => ({
            snapSettings: { ...state.snapSettings, snapToClips: enabled },
          }));
        },

        setSnapToPlayhead: (enabled: boolean) => {
          set((state) => ({
            snapSettings: { ...state.snapSettings, snapToPlayhead: enabled },
          }));
        },

        setSnapToMarkers: (enabled: boolean) => {
          set((state) => ({
            snapSettings: { ...state.snapSettings, snapToMarkers: enabled },
          }));
        },

        setGridSize: (size: number) => {
          set((state) => ({
            snapSettings: {
              ...state.snapSettings,
              gridSize: Math.max(0.01, size),
            },
          }));
        },

        setSnapThreshold: (threshold: number) => {
          set((state) => ({
            snapSettings: {
              ...state.snapSettings,
              snapThreshold: Math.max(1, threshold),
            },
          }));
        },

        toggleSnap: () => {
          set((state) => ({
            snapSettings: {
              ...state.snapSettings,
              enabled: !state.snapSettings.enabled,
            },
          }));
        },

        togglePanel: (panelId: PanelId) => {
          set((state) => ({
            // Use spread operator to create new panels object (immutability for Zustand reactivity)
            panels: {
              ...state.panels,
              [panelId]: {
                ...state.panels[panelId], // Shallow copy existing panel state
                visible: !state.panels[panelId].visible, // Toggle visibility
              },
            },
          }));
        },

        setPanelVisible: (panelId: PanelId, visible: boolean) => {
          set((state) => ({
            // Create new panels object to trigger subscribers
            panels: {
              ...state.panels,
              [panelId]: {
                ...state.panels[panelId],
                visible,
              },
            },
          }));
        },

        setPanelWidth: (panelId: PanelId, width: number) => {
          set((state) => ({
            panels: {
              ...state.panels,
              [panelId]: {
                ...state.panels[panelId],
                // Clamp width between min (200px) and max (800px) for usability
                width: Math.max(200, Math.min(800, width)),
              },
            },
          }));
        },

        setPanelCollapsed: (panelId: PanelId, collapsed: boolean) => {
          set((state) => ({
            panels: {
              ...state.panels,
              [panelId]: {
                ...state.panels[panelId],
                collapsed,
              },
            },
          }));
        },

        setShortcut: (action: keyof KeyboardShortcuts, shortcut: string) => {
          set((state) => ({
            shortcuts: {
              ...state.shortcuts,
              [action]: shortcut,
            },
          }));
        },

        resetShortcuts: () => {
          set({ shortcuts: DEFAULT_SHORTCUTS });
        },

        setTheme: (theme: "light" | "dark" | "system") => {
          set({ theme });
        },

        setShowWaveforms: (show: boolean) => {
          set({ showWaveforms: show });
        },

        setShowThumbnails: (show: boolean) => {
          set({ showThumbnails: show });
        },

        setShowKeyframes: (show: boolean) => {
          set({ showKeyframes: show });
        },

        setAutoScroll: (enabled: boolean) => {
          set({ autoScroll: enabled });
        },

        openModal: (modalId: string, data?: Record<string, unknown>) => {
          set({
            activeModal: modalId,
            modalData: data || null,
          });
        },

        closeModal: () => {
          set({
            activeModal: null,
            modalData: null,
          });
        },

        showContextMenu: (x: number, y: number, items: ContextMenuItem[]) => {
          set({
            contextMenu: { visible: true, x, y, items },
          });
        },

        hideContextMenu: () => {
          set({ contextMenu: null });
        },

        startDrag: (
          type: "clip" | "media" | "effect" | "keyframe",
          data: Record<string, unknown>,
        ) => {
          // Store drag metadata to enable drop target validation and visual feedback
          // dragType allows components to show appropriate drop zone indicators
          set({
            isDragging: true,
            dragType: type,
            dragData: data, // Arbitrary data passed from drag source to drop target
          });
        },

        endDrag: () => {
          // Clear all drag state to prevent stale data affecting subsequent interactions
          set({
            isDragging: false,
            dragType: null,
            dragData: null,
          });
        },

        setCropMode: (enabled: boolean, clipId?: string) => {
          set({
            cropMode: enabled,
            cropClipId: enabled ? clipId || null : null,
          });
        },

        setMotionPathMode: (enabled: boolean, clipId?: string) => {
          set({
            motionPathMode: enabled,
            motionPathClipId: enabled ? clipId || null : null,
          });
        },

        setKeyframeEditorOpen: (open: boolean) => {
          set({ keyframeEditorOpen: open });
        },

        toggleKeyframeEditor: () => {
          set((state) => ({ keyframeEditorOpen: !state.keyframeEditorOpen }));
        },

        setShowWelcomeScreen: (show: boolean) => {
          set({ showWelcomeScreen: show });
        },

        setSkipWelcomeScreen: (skip: boolean) => {
          set({
            skipWelcomeScreen: skip,
            showWelcomeScreen: skip ? false : get().showWelcomeScreen,
          });
        },
      }),
      {
        name: "openreel-ui-preferences",
        // Only persist user preferences, not transient state (selections, drag state, modals)
        // This prevents localStorage bloat and ensures clean state on new sessions
        partialize: (state) => ({
          snapSettings: state.snapSettings,
          panels: state.panels,
          shortcuts: state.shortcuts,
          theme: state.theme,
          showWaveforms: state.showWaveforms,
          showThumbnails: state.showThumbnails,
          showKeyframes: state.showKeyframes,
          autoScroll: state.autoScroll,
          skipWelcomeScreen: state.skipWelcomeScreen,
          // NOT persisted: selectedItems, isDragging, contextMenu, activeModal, showWelcomeScreen
        }),
      },
    ),
  ),
);
