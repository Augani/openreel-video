import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface Guide {
  id: string;
  type: 'horizontal' | 'vertical';
  position: number;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SmartGuide {
  type: 'horizontal' | 'vertical';
  position: number;
  start: number;
  end: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SmartGuide[];
}

export type DragMode = 'none' | 'move' | 'resize' | 'rotate' | 'marquee' | 'pan' | 'paint' | 'crop';
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface CanvasState {
  canvasRef: HTMLCanvasElement | null;
  context: CanvasRenderingContext2D | null;
  containerRef: HTMLDivElement | null;

  isDragging: boolean;
  dragMode: DragMode;
  dragStartX: number;
  dragStartY: number;
  dragCurrentX: number;
  dragCurrentY: number;

  activeResizeHandle: ResizeHandle | null;

  isMarqueeSelecting: boolean;
  marqueeStart: { x: number; y: number } | null;
  marqueeRect: SelectionRect | null;

  guides: Guide[];
  activeGuide: string | null;

  hoveredLayerId: string | null;

  transformOriginX: number;
  transformOriginY: number;

  renderCount: number;

  smartGuides: SmartGuide[];
}

interface CanvasActions {
  setCanvasRef: (canvas: HTMLCanvasElement | null) => void;
  setContainerRef: (container: HTMLDivElement | null) => void;

  startDrag: (mode: DragMode, x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: () => void;

  setActiveResizeHandle: (handle: ResizeHandle | null) => void;

  startMarqueeSelect: (x: number, y: number) => void;
  updateMarqueeSelect: (x: number, y: number) => void;
  endMarqueeSelect: () => SelectionRect | null;

  addGuide: (type: 'horizontal' | 'vertical', position: number) => string;
  removeGuide: (id: string) => void;
  updateGuide: (id: string, position: number) => void;
  setActiveGuide: (id: string | null) => void;
  clearGuides: () => void;

  setHoveredLayerId: (id: string | null) => void;

  setTransformOrigin: (x: number, y: number) => void;

  requestRender: () => void;

  setSmartGuides: (guides: SmartGuide[]) => void;
  clearSmartGuides: () => void;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

export const useCanvasStore = create<CanvasState & CanvasActions>()(
  subscribeWithSelector((set, get) => ({
    canvasRef: null,
    context: null,
    containerRef: null,

    isDragging: false,
    dragMode: 'none',
    dragStartX: 0,
    dragStartY: 0,
    dragCurrentX: 0,
    dragCurrentY: 0,

    activeResizeHandle: null,

    isMarqueeSelecting: false,
    marqueeStart: null,
    marqueeRect: null,

    guides: [],
    activeGuide: null,

    hoveredLayerId: null,

    transformOriginX: 0.5,
    transformOriginY: 0.5,

    renderCount: 0,

    smartGuides: [],

    setCanvasRef: (canvas) => {
      set({
        canvasRef: canvas,
        context: canvas?.getContext('2d') ?? null,
      });
    },

    setContainerRef: (container) => {
      set({ containerRef: container });
    },

    startDrag: (mode, x, y) => {
      set({
        isDragging: true,
        dragMode: mode,
        dragStartX: x,
        dragStartY: y,
        dragCurrentX: x,
        dragCurrentY: y,
      });
    },

    updateDrag: (x, y) => {
      set({
        dragCurrentX: x,
        dragCurrentY: y,
      });
    },

    endDrag: () => {
      set({
        isDragging: false,
        dragMode: 'none',
        activeResizeHandle: null,
      });
    },

    setActiveResizeHandle: (handle) => {
      set({ activeResizeHandle: handle });
    },

    startMarqueeSelect: (x, y) => {
      set({
        isMarqueeSelecting: true,
        marqueeStart: { x, y },
        marqueeRect: { x, y, width: 0, height: 0 },
      });
    },

    updateMarqueeSelect: (x, y) => {
      const { marqueeStart } = get();
      if (marqueeStart) {
        set({
          marqueeRect: {
            x: Math.min(marqueeStart.x, x),
            y: Math.min(marqueeStart.y, y),
            width: Math.abs(x - marqueeStart.x),
            height: Math.abs(y - marqueeStart.y),
          },
        });
      }
    },

    endMarqueeSelect: () => {
      const { marqueeRect } = get();
      set({
        isMarqueeSelecting: false,
        marqueeStart: null,
        marqueeRect: null,
      });
      return marqueeRect;
    },

    addGuide: (type, position) => {
      const id = generateId();
      set((state) => ({
        guides: [...state.guides, { id, type, position }],
      }));
      return id;
    },

    removeGuide: (id) => {
      set((state) => ({
        guides: state.guides.filter((g) => g.id !== id),
      }));
    },

    updateGuide: (id, position) => {
      set((state) => ({
        guides: state.guides.map((g) => (g.id === id ? { ...g, position } : g)),
      }));
    },

    setActiveGuide: (id) => {
      set({ activeGuide: id });
    },

    clearGuides: () => {
      set({ guides: [] });
    },

    setHoveredLayerId: (id) => {
      set({ hoveredLayerId: id });
    },

    setTransformOrigin: (x, y) => {
      set({ transformOriginX: x, transformOriginY: y });
    },

    requestRender: () => {
      set((state) => ({ renderCount: state.renderCount + 1 }));
    },

    setSmartGuides: (guides) => {
      set({ smartGuides: guides });
    },

    clearSmartGuides: () => {
      set({ smartGuides: [] });
    },
  }))
);
