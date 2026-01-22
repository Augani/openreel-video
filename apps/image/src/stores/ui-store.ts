import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type AppView = 'welcome' | 'editor';
export type Tool =
  | 'select'
  | 'hand'
  | 'text'
  | 'shape'
  | 'pen'
  | 'eyedropper'
  | 'zoom'
  | 'crop'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'lasso-polygon'
  | 'magic-wand'
  | 'eraser'
  | 'dodge'
  | 'burn';
export type Panel = 'layers' | 'assets' | 'templates' | 'text' | 'shapes' | 'uploads' | 'elements';

export type CropAspectRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | 'original';

export interface CropState {
  isActive: boolean;
  layerId: string | null;
  aspectRatio: CropAspectRatio;
  cropRect: { x: number; y: number; width: number; height: number } | null;
}

export interface PenSettings {
  color: string;
  width: number;
  opacity: number;
  smoothing: number;
}

export interface EraserSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  mode: 'brush' | 'pencil' | 'block';
}

export interface SelectionToolSettings {
  feather: number;
  antiAlias: boolean;
  mode: 'new' | 'add' | 'subtract' | 'intersect';
}

export interface MagicWandSettings {
  tolerance: number;
  contiguous: boolean;
  sampleAllLayers: boolean;
}

export interface DodgeBurnSettings {
  type: 'dodge' | 'burn';
  range: 'shadows' | 'midtones' | 'highlights';
  exposure: number;
  size: number;
}

export interface DrawingState {
  isDrawing: boolean;
  currentPath: { x: number; y: number }[];
}

interface UIState {
  currentView: AppView;
  activeTool: Tool;
  activePanel: Panel;
  isPanelCollapsed: boolean;
  isInspectorCollapsed: boolean;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  showGuides: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  snapToGuides: boolean;
  snapToObjects: boolean;
  gridSize: number;
  isExporting: boolean;
  exportProgress: number;
  notification: { type: 'success' | 'error' | 'info'; message: string } | null;
  crop: CropState;
  isExportDialogOpen: boolean;
  showShortcutsPanel: boolean;
  showSettingsDialog: boolean;
  penSettings: PenSettings;
  drawing: DrawingState;
  eraserSettings: EraserSettings;
  selectionToolSettings: SelectionToolSettings;
  magicWandSettings: MagicWandSettings;
  dodgeBurnSettings: DodgeBurnSettings;
}

interface UIActions {
  setCurrentView: (view: AppView) => void;
  setActiveTool: (tool: Tool) => void;
  setActivePanel: (panel: Panel) => void;
  togglePanelCollapsed: () => void;
  toggleInspectorCollapsed: () => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: () => void;
  toggleGrid: () => void;
  toggleGuides: () => void;
  toggleRulers: () => void;
  toggleSnapToGrid: () => void;
  toggleSnapToGuides: () => void;
  toggleSnapToObjects: () => void;
  setGridSize: (size: number) => void;
  setExporting: (exporting: boolean) => void;
  setExportProgress: (progress: number) => void;
  showNotification: (type: 'success' | 'error' | 'info', message: string) => void;
  clearNotification: () => void;
  startCrop: (layerId: string, initialRect: { x: number; y: number; width: number; height: number }) => void;
  updateCropRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  setCropAspectRatio: (ratio: CropAspectRatio) => void;
  cancelCrop: () => void;
  applyCrop: () => { layerId: string; cropRect: { x: number; y: number; width: number; height: number } } | null;
  openExportDialog: () => void;
  closeExportDialog: () => void;
  toggleShortcutsPanel: () => void;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
  setPenSettings: (settings: Partial<PenSettings>) => void;
  startDrawing: (point: { x: number; y: number }) => void;
  addDrawingPoint: (point: { x: number; y: number }) => void;
  finishDrawing: () => { x: number; y: number }[] | null;
  cancelDrawing: () => void;
  setEraserSettings: (settings: Partial<EraserSettings>) => void;
  setSelectionToolSettings: (settings: Partial<SelectionToolSettings>) => void;
  setMagicWandSettings: (settings: Partial<MagicWandSettings>) => void;
  setDodgeBurnSettings: (settings: Partial<DodgeBurnSettings>) => void;
}

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 8];

export const useUIStore = create<UIState & UIActions>()(
  subscribeWithSelector((set, get) => ({
    currentView: 'welcome',
    activeTool: 'select',
    activePanel: 'layers',
    isPanelCollapsed: false,
    isInspectorCollapsed: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    showGrid: false,
    showGuides: true,
    showRulers: true,
    snapToGrid: false,
    snapToGuides: true,
    snapToObjects: true,
    gridSize: 10,
    isExporting: false,
    exportProgress: 0,
    notification: null,
    crop: {
      isActive: false,
      layerId: null,
      aspectRatio: 'free',
      cropRect: null,
    },
    isExportDialogOpen: false,
    showShortcutsPanel: false,
    showSettingsDialog: false,
    penSettings: {
      color: '#000000',
      width: 4,
      opacity: 1,
      smoothing: 0.5,
    },
    drawing: {
      isDrawing: false,
      currentPath: [],
    },
    eraserSettings: {
      size: 20,
      hardness: 100,
      opacity: 1,
      flow: 1,
      mode: 'brush',
    },
    selectionToolSettings: {
      feather: 0,
      antiAlias: true,
      mode: 'new',
    },
    magicWandSettings: {
      tolerance: 32,
      contiguous: true,
      sampleAllLayers: false,
    },
    dodgeBurnSettings: {
      type: 'dodge',
      range: 'midtones',
      exposure: 50,
      size: 30,
    },

    setCurrentView: (view) => set({ currentView: view }),
    setActiveTool: (tool) => set({ activeTool: tool }),
    setActivePanel: (panel) => set({ activePanel: panel }),
    togglePanelCollapsed: () => set((s) => ({ isPanelCollapsed: !s.isPanelCollapsed })),
    toggleInspectorCollapsed: () => set((s) => ({ isInspectorCollapsed: !s.isInspectorCollapsed })),

    setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(8, zoom)) }),
    setPan: (x, y) => set({ panX: x, panY: y }),
    resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),

    zoomIn: () => {
      const { zoom } = get();
      const nextLevel = ZOOM_LEVELS.find((l) => l > zoom) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
      set({ zoom: nextLevel });
    },

    zoomOut: () => {
      const { zoom } = get();
      const prevLevel = [...ZOOM_LEVELS].reverse().find((l) => l < zoom) ?? ZOOM_LEVELS[0];
      set({ zoom: prevLevel });
    },

    zoomToFit: () => {
      set({ zoom: 1, panX: 0, panY: 0 });
    },

    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
    toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
    toggleSnapToGrid: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
    toggleSnapToGuides: () => set((s) => ({ snapToGuides: !s.snapToGuides })),
    toggleSnapToObjects: () => set((s) => ({ snapToObjects: !s.snapToObjects })),
    setGridSize: (size) => set({ gridSize: size }),

    setExporting: (exporting) => set({ isExporting: exporting }),
    setExportProgress: (progress) => set({ exportProgress: progress }),

    showNotification: (type, message) => {
      set({ notification: { type, message } });
      setTimeout(() => {
        set({ notification: null });
      }, 4000);
    },

    clearNotification: () => set({ notification: null }),

    startCrop: (layerId, initialRect) =>
      set({
        crop: {
          isActive: true,
          layerId,
          aspectRatio: 'free',
          cropRect: initialRect,
        },
        activeTool: 'crop',
      }),

    updateCropRect: (rect) =>
      set((s) => ({
        crop: { ...s.crop, cropRect: rect },
      })),

    setCropAspectRatio: (ratio) =>
      set((s) => ({
        crop: { ...s.crop, aspectRatio: ratio },
      })),

    cancelCrop: () =>
      set({
        crop: {
          isActive: false,
          layerId: null,
          aspectRatio: 'free',
          cropRect: null,
        },
        activeTool: 'select',
      }),

    applyCrop: () => {
      const { crop } = get();
      if (!crop.isActive || !crop.layerId || !crop.cropRect) return null;

      const result = { layerId: crop.layerId, cropRect: crop.cropRect };

      set({
        crop: {
          isActive: false,
          layerId: null,
          aspectRatio: 'free',
          cropRect: null,
        },
        activeTool: 'select',
      });

      return result;
    },

    openExportDialog: () => set({ isExportDialogOpen: true }),
    closeExportDialog: () => set({ isExportDialogOpen: false }),

    toggleShortcutsPanel: () => set((s) => ({ showShortcutsPanel: !s.showShortcutsPanel })),

    openSettingsDialog: () => set({ showSettingsDialog: true }),
    closeSettingsDialog: () => set({ showSettingsDialog: false }),

    setPenSettings: (settings) =>
      set((s) => ({
        penSettings: { ...s.penSettings, ...settings },
      })),

    startDrawing: (point) =>
      set({
        drawing: {
          isDrawing: true,
          currentPath: [point],
        },
      }),

    addDrawingPoint: (point) =>
      set((s) => ({
        drawing: {
          ...s.drawing,
          currentPath: [...s.drawing.currentPath, point],
        },
      })),

    finishDrawing: () => {
      const { drawing } = get();
      if (!drawing.isDrawing || drawing.currentPath.length < 2) {
        set({ drawing: { isDrawing: false, currentPath: [] } });
        return null;
      }

      const path = [...drawing.currentPath];
      set({ drawing: { isDrawing: false, currentPath: [] } });
      return path;
    },

    cancelDrawing: () =>
      set({
        drawing: {
          isDrawing: false,
          currentPath: [],
        },
      }),

    setEraserSettings: (settings) =>
      set((s) => ({
        eraserSettings: { ...s.eraserSettings, ...settings },
      })),

    setSelectionToolSettings: (settings) =>
      set((s) => ({
        selectionToolSettings: { ...s.selectionToolSettings, ...settings },
      })),

    setMagicWandSettings: (settings) =>
      set((s) => ({
        magicWandSettings: { ...s.magicWandSettings, ...settings },
      })),

    setDodgeBurnSettings: (settings) =>
      set((s) => ({
        dodgeBurnSettings: { ...s.dodgeBurnSettings, ...settings },
      })),
  }))
);
