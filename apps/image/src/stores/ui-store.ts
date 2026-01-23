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
  | 'burn'
  | 'brush'
  | 'clone-stamp'
  | 'healing-brush'
  | 'spot-healing'
  | 'sponge'
  | 'smudge'
  | 'blur'
  | 'sharpen'
  | 'gradient'
  | 'paint-bucket'
  | 'free-transform'
  | 'warp'
  | 'perspective'
  | 'liquify';
export type Panel = 'layers' | 'assets' | 'templates' | 'text' | 'shapes' | 'uploads' | 'elements';

export type CropAspectRatio = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | 'original';

export interface CropState {
  isActive: boolean;
  layerId: string | null;
  aspectRatio: CropAspectRatio;
  cropRect: { x: number; y: number; width: number; height: number } | null;
  lockAspect: boolean;
  initialAspectRatio: number | null;
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

export interface BrushSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  color: string;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
}

export interface CloneStampSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  aligned: boolean;
  sampleAllLayers: boolean;
  sourcePoint: { x: number; y: number } | null;
}

export interface HealingBrushSettings {
  size: number;
  hardness: number;
  mode: 'normal' | 'replace' | 'multiply' | 'screen';
  sourcePoint: { x: number; y: number } | null;
  aligned: boolean;
}

export interface SpotHealingSettings {
  size: number;
  type: 'proximity-match' | 'create-texture' | 'content-aware';
  sampleAllLayers: boolean;
}

export interface SpongeSettings {
  size: number;
  flow: number;
  mode: 'desaturate' | 'saturate';
}

export interface SmudgeSettings {
  size: number;
  strength: number;
  fingerPainting: boolean;
  sampleAllLayers: boolean;
}

export interface BlurSharpenSettings {
  size: number;
  strength: number;
  mode: 'blur' | 'sharpen';
  sampleAllLayers: boolean;
}

export interface GradientSettings {
  type: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  colors: string[];
  opacity: number;
  reverse: boolean;
  dither: boolean;
}

export interface PaintBucketSettings {
  color: string;
  tolerance: number;
  contiguous: boolean;
  antiAlias: boolean;
  opacity: number;
  fillType: 'foreground' | 'pattern';
}

export interface TransformSettings {
  mode: 'free' | 'scale' | 'rotate' | 'skew' | 'distort' | 'perspective' | 'warp';
  maintainAspectRatio: boolean;
  interpolation: 'nearest' | 'bilinear' | 'bicubic';
}

export interface LiquifySettings {
  brushSize: number;
  brushDensity: number;
  brushPressure: number;
  brushRate: number;
  tool: 'forward-warp' | 'reconstruct' | 'smooth' | 'twirl-clockwise' | 'twirl-counterclockwise' | 'pucker' | 'bloat' | 'push-left' | 'freeze' | 'thaw';
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
  brushSettings: BrushSettings;
  cloneStampSettings: CloneStampSettings;
  healingBrushSettings: HealingBrushSettings;
  spotHealingSettings: SpotHealingSettings;
  spongeSettings: SpongeSettings;
  smudgeSettings: SmudgeSettings;
  blurSharpenSettings: BlurSharpenSettings;
  gradientSettings: GradientSettings;
  paintBucketSettings: PaintBucketSettings;
  transformSettings: TransformSettings;
  liquifySettings: LiquifySettings;
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
  setCropLockAspect: (locked: boolean) => void;
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
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setCloneStampSettings: (settings: Partial<CloneStampSettings>) => void;
  setHealingBrushSettings: (settings: Partial<HealingBrushSettings>) => void;
  setSpotHealingSettings: (settings: Partial<SpotHealingSettings>) => void;
  setSpongeSettings: (settings: Partial<SpongeSettings>) => void;
  setSmudgeSettings: (settings: Partial<SmudgeSettings>) => void;
  setBlurSharpenSettings: (settings: Partial<BlurSharpenSettings>) => void;
  setGradientSettings: (settings: Partial<GradientSettings>) => void;
  setPaintBucketSettings: (settings: Partial<PaintBucketSettings>) => void;
  setTransformSettings: (settings: Partial<TransformSettings>) => void;
  setLiquifySettings: (settings: Partial<LiquifySettings>) => void;
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
      lockAspect: false,
      initialAspectRatio: null,
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
    brushSettings: {
      size: 20,
      hardness: 100,
      opacity: 1,
      flow: 1,
      color: '#000000',
      blendMode: 'normal',
    },
    cloneStampSettings: {
      size: 30,
      hardness: 50,
      opacity: 1,
      flow: 1,
      aligned: true,
      sampleAllLayers: false,
      sourcePoint: null,
    },
    healingBrushSettings: {
      size: 30,
      hardness: 50,
      mode: 'normal',
      sourcePoint: null,
      aligned: true,
    },
    spotHealingSettings: {
      size: 30,
      type: 'content-aware',
      sampleAllLayers: false,
    },
    spongeSettings: {
      size: 30,
      flow: 50,
      mode: 'desaturate',
    },
    smudgeSettings: {
      size: 30,
      strength: 50,
      fingerPainting: false,
      sampleAllLayers: false,
    },
    blurSharpenSettings: {
      size: 30,
      strength: 50,
      mode: 'blur',
      sampleAllLayers: false,
    },
    gradientSettings: {
      type: 'linear',
      colors: ['#000000', '#ffffff'],
      opacity: 1,
      reverse: false,
      dither: true,
    },
    paintBucketSettings: {
      color: '#000000',
      tolerance: 32,
      contiguous: true,
      antiAlias: true,
      opacity: 1,
      fillType: 'foreground',
    },
    transformSettings: {
      mode: 'free',
      maintainAspectRatio: false,
      interpolation: 'bicubic',
    },
    liquifySettings: {
      brushSize: 100,
      brushDensity: 50,
      brushPressure: 100,
      brushRate: 80,
      tool: 'forward-warp',
    },

    setCurrentView: (view) => set({ currentView: view }),
    setActiveTool: (tool) => {
      const updates: Partial<UIState> = { activeTool: tool };
      if (tool === 'blur') {
        updates.blurSharpenSettings = { ...get().blurSharpenSettings, mode: 'blur' };
      } else if (tool === 'sharpen') {
        updates.blurSharpenSettings = { ...get().blurSharpenSettings, mode: 'sharpen' };
      } else if (tool === 'dodge') {
        updates.dodgeBurnSettings = { ...get().dodgeBurnSettings, type: 'dodge' };
      } else if (tool === 'burn') {
        updates.dodgeBurnSettings = { ...get().dodgeBurnSettings, type: 'burn' };
      }
      set(updates);
    },
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
          lockAspect: false,
          initialAspectRatio: initialRect.width / initialRect.height,
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

    setCropLockAspect: (locked) =>
      set((s) => ({
        crop: {
          ...s.crop,
          lockAspect: locked,
          initialAspectRatio: locked && s.crop.cropRect
            ? s.crop.cropRect.width / s.crop.cropRect.height
            : s.crop.initialAspectRatio,
        },
      })),

    cancelCrop: () =>
      set({
        crop: {
          isActive: false,
          layerId: null,
          aspectRatio: 'free',
          cropRect: null,
          lockAspect: false,
          initialAspectRatio: null,
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
          lockAspect: false,
          initialAspectRatio: null,
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

    setBrushSettings: (settings) =>
      set((s) => ({
        brushSettings: { ...s.brushSettings, ...settings },
      })),

    setCloneStampSettings: (settings) =>
      set((s) => ({
        cloneStampSettings: { ...s.cloneStampSettings, ...settings },
      })),

    setHealingBrushSettings: (settings) =>
      set((s) => ({
        healingBrushSettings: { ...s.healingBrushSettings, ...settings },
      })),

    setSpotHealingSettings: (settings) =>
      set((s) => ({
        spotHealingSettings: { ...s.spotHealingSettings, ...settings },
      })),

    setSpongeSettings: (settings) =>
      set((s) => ({
        spongeSettings: { ...s.spongeSettings, ...settings },
      })),

    setSmudgeSettings: (settings) =>
      set((s) => ({
        smudgeSettings: { ...s.smudgeSettings, ...settings },
      })),

    setBlurSharpenSettings: (settings) =>
      set((s) => ({
        blurSharpenSettings: { ...s.blurSharpenSettings, ...settings },
      })),

    setGradientSettings: (settings) =>
      set((s) => ({
        gradientSettings: { ...s.gradientSettings, ...settings },
      })),

    setPaintBucketSettings: (settings) =>
      set((s) => ({
        paintBucketSettings: { ...s.paintBucketSettings, ...settings },
      })),

    setTransformSettings: (settings) =>
      set((s) => ({
        transformSettings: { ...s.transformSettings, ...settings },
      })),

    setLiquifySettings: (settings) =>
      set((s) => ({
        liquifySettings: { ...s.liquifySettings, ...settings },
      })),
  }))
);
