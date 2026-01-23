import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  Selection,
  SelectionState,
  SelectionType,
  SelectionMode,
  SelectionBounds,
  DEFAULT_MAGIC_WAND_OPTIONS,
  DEFAULT_COLOR_RANGE_OPTIONS,
  createEmptySelection,
  boundsFromPath,
  combineSelections,
  selectionToPath2D,
  MagicWandOptions,
  ColorRangeOptions,
} from '../types/selection';

const generateId = () => `sel-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

interface SelectionActions {
  startSelection: (type: SelectionType, point: { x: number; y: number }) => void;
  updateSelection: (point: { x: number; y: number }) => void;
  finishSelection: () => Selection | null;
  cancelSelection: () => void;

  setActiveSelection: (selection: Selection | null) => void;
  clearSelection: () => void;
  selectAll: (bounds: SelectionBounds) => void;
  invertSelection: (canvasBounds: SelectionBounds) => void;

  featherSelection: (amount: number) => void;
  expandSelection: (amount: number) => void;
  contractSelection: (amount: number) => void;

  setSelectionMode: (mode: SelectionMode) => void;
  setMagicWandOptions: (options: Partial<MagicWandOptions>) => void;
  setColorRangeOptions: (options: Partial<ColorRangeOptions>) => void;

  saveSelection: (name?: string) => void;
  loadSelection: (id: string) => void;
  deleteSelection: (id: string) => void;

  selectByColor: (
    imageData: ImageData,
    x: number,
    y: number,
    options: MagicWandOptions
  ) => void;

  hasSelection: () => boolean;
  getSelectionPath: () => Path2D | null;
}

export const useSelectionStore = create<SelectionState & SelectionActions>()(
  subscribeWithSelector((set, get) => ({
    active: null,
    saved: [],
    mode: 'new',
    isSelecting: false,
    marching: true,
    magicWandOptions: DEFAULT_MAGIC_WAND_OPTIONS,
    colorRangeOptions: DEFAULT_COLOR_RANGE_OPTIONS,
    tempPath: [],
    startPoint: null,

    startSelection: (_type, point) => {
      set({
        isSelecting: true,
        startPoint: point,
        tempPath: [point],
      });
    },

    updateSelection: (point) => {
      const { isSelecting, startPoint, tempPath } = get();
      if (!isSelecting || !startPoint) return;

      set({ tempPath: [...tempPath, point] });
    },

    finishSelection: () => {
      const { isSelecting, startPoint, tempPath, mode, active } = get();
      if (!isSelecting || !startPoint) return null;

      let newSelection: Selection;

      if (tempPath.length === 2) {
        const bounds: SelectionBounds = {
          x: Math.min(startPoint.x, tempPath[1].x),
          y: Math.min(startPoint.y, tempPath[1].y),
          width: Math.abs(tempPath[1].x - startPoint.x),
          height: Math.abs(tempPath[1].y - startPoint.y),
        };

        newSelection = {
          ...createEmptySelection(),
          id: generateId(),
          bounds,
          path: [
            { x: bounds.x, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
            { x: bounds.x, y: bounds.y + bounds.height },
          ],
        };
      } else {
        newSelection = {
          ...createEmptySelection(),
          id: generateId(),
          bounds: boundsFromPath(tempPath),
          path: tempPath,
        };
      }

      const finalSelection = active && mode !== 'new'
        ? combineSelections(active, newSelection, mode)
        : newSelection;

      set({
        active: finalSelection,
        isSelecting: false,
        tempPath: [],
        startPoint: null,
      });

      return finalSelection;
    },

    cancelSelection: () => {
      set({
        isSelecting: false,
        tempPath: [],
        startPoint: null,
      });
    },

    setActiveSelection: (selection) => {
      set({ active: selection });
    },

    clearSelection: () => {
      set({ active: null });
    },

    selectAll: (bounds) => {
      const selection: Selection = {
        id: generateId(),
        type: 'rectangular',
        bounds,
        path: [
          { x: bounds.x, y: bounds.y },
          { x: bounds.x + bounds.width, y: bounds.y },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
          { x: bounds.x, y: bounds.y + bounds.height },
        ],
        feather: 0,
        antiAlias: true,
        opacity: 1,
      };
      set({ active: selection });
    },

    invertSelection: (canvasBounds) => {
      const { active } = get();
      if (!active) {
        get().selectAll(canvasBounds);
        return;
      }

      const inverted: Selection = {
        ...active,
        id: generateId(),
      };
      set({ active: inverted });
    },

    featherSelection: (amount) => {
      const { active } = get();
      if (!active) return;

      set({
        active: { ...active, feather: amount },
      });
    },

    expandSelection: (amount) => {
      const { active } = get();
      if (!active) return;

      const newBounds: SelectionBounds = {
        x: active.bounds.x - amount,
        y: active.bounds.y - amount,
        width: active.bounds.width + amount * 2,
        height: active.bounds.height + amount * 2,
      };

      const newPath = active.path.map((p) => {
        const cx = active.bounds.x + active.bounds.width / 2;
        const cy = active.bounds.y + active.bounds.height / 2;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const newDist = dist + amount;
        const scale = dist > 0 ? newDist / dist : 1;
        return {
          x: cx + dx * scale,
          y: cy + dy * scale,
        };
      });

      set({
        active: { ...active, bounds: newBounds, path: newPath },
      });
    },

    contractSelection: (amount) => {
      get().expandSelection(-amount);
    },

    setSelectionMode: (mode) => {
      set({ mode });
    },

    setMagicWandOptions: (options) => {
      set((state) => ({
        magicWandOptions: { ...state.magicWandOptions, ...options },
      }));
    },

    setColorRangeOptions: (options) => {
      set((state) => ({
        colorRangeOptions: { ...state.colorRangeOptions, ...options },
      }));
    },

    saveSelection: (_name) => {
      const { active, saved } = get();
      if (!active) return;

      const savedSelection: Selection = {
        ...active,
        id: generateId(),
      };

      set({ saved: [...saved, savedSelection] });
    },

    loadSelection: (id) => {
      const { saved, mode, active } = get();
      const selection = saved.find((s) => s.id === id);
      if (!selection) return;

      const finalSelection = active && mode !== 'new'
        ? combineSelections(active, selection, mode)
        : selection;

      set({ active: finalSelection });
    },

    deleteSelection: (id) => {
      set((state) => ({
        saved: state.saved.filter((s) => s.id !== id),
      }));
    },

    selectByColor: (imageData, x, y, options) => {
      const { mode, active } = get();

      const pixelIndex = (Math.floor(y) * imageData.width + Math.floor(x)) * 4;
      const targetR = imageData.data[pixelIndex];
      const targetG = imageData.data[pixelIndex + 1];
      const targetB = imageData.data[pixelIndex + 2];

      const visited = new Set<number>();
      const selected: { x: number; y: number }[] = [];
      const tolerance = options.tolerance;

      const colorMatch = (index: number): boolean => {
        const r = imageData.data[index];
        const g = imageData.data[index + 1];
        const b = imageData.data[index + 2];

        const diff = Math.sqrt(
          Math.pow(r - targetR, 2) +
          Math.pow(g - targetG, 2) +
          Math.pow(b - targetB, 2)
        );

        return diff <= tolerance * 1.732;
      };

      if (options.contiguous) {
        const stack: { x: number; y: number }[] = [{ x: Math.floor(x), y: Math.floor(y) }];

        while (stack.length > 0) {
          const { x: px, y: py } = stack.pop()!;
          const key = py * imageData.width + px;

          if (
            px < 0 ||
            px >= imageData.width ||
            py < 0 ||
            py >= imageData.height ||
            visited.has(key)
          ) {
            continue;
          }

          visited.add(key);
          const index = key * 4;

          if (colorMatch(index)) {
            selected.push({ x: px, y: py });
            stack.push({ x: px + 1, y: py });
            stack.push({ x: px - 1, y: py });
            stack.push({ x: px, y: py + 1 });
            stack.push({ x: px, y: py - 1 });
          }
        }
      } else {
        for (let py = 0; py < imageData.height; py++) {
          for (let px = 0; px < imageData.width; px++) {
            const index = (py * imageData.width + px) * 4;
            if (colorMatch(index)) {
              selected.push({ x: px, y: py });
            }
          }
        }
      }

      if (selected.length === 0) return;

      const bounds = boundsFromPath(selected);

      const newSelection: Selection = {
        id: generateId(),
        type: 'magic-wand',
        bounds,
        path: computeSelectionOutline(selected, imageData.width, imageData.height),
        feather: 0,
        antiAlias: true,
        opacity: 1,
      };

      const finalSelection = active && mode !== 'new'
        ? combineSelections(active, newSelection, mode)
        : newSelection;

      set({ active: finalSelection });
    },

    hasSelection: () => {
      return get().active !== null;
    },

    getSelectionPath: () => {
      const { active } = get();
      if (!active) return null;
      return selectionToPath2D(active);
    },
  }))
);

function computeSelectionOutline(
  pixels: { x: number; y: number }[],
  _width: number,
  _height: number
): { x: number; y: number }[] {
  if (pixels.length === 0) return [];

  const pixelSet = new Set(pixels.map((p) => `${p.x},${p.y}`));
  const edgePixels: { x: number; y: number }[] = [];

  for (const pixel of pixels) {
    const isEdge =
      !pixelSet.has(`${pixel.x - 1},${pixel.y}`) ||
      !pixelSet.has(`${pixel.x + 1},${pixel.y}`) ||
      !pixelSet.has(`${pixel.x},${pixel.y - 1}`) ||
      !pixelSet.has(`${pixel.x},${pixel.y + 1}`);

    if (isEdge) {
      edgePixels.push(pixel);
    }
  }

  if (edgePixels.length === 0) return pixels;

  const outline: { x: number; y: number }[] = [];
  const visited = new Set<string>();

  let current = edgePixels[0];
  outline.push(current);
  visited.add(`${current.x},${current.y}`);

  const directions = [
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 },
  ];

  for (let i = 0; i < edgePixels.length * 2; i++) {
    let found = false;

    for (const dir of directions) {
      const next = { x: current.x + dir.dx, y: current.y + dir.dy };
      const key = `${next.x},${next.y}`;

      if (!visited.has(key) && edgePixels.some((p) => p.x === next.x && p.y === next.y)) {
        outline.push(next);
        visited.add(key);
        current = next;
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  return outline;
}
