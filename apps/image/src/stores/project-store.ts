import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  createProjectDocument,
  deserializeProject,
  duplicateLayerInProject,
} from '@openreel/image-core/operations';
import {
  AddArtboardCommand,
  AddLayerCommand,
  DuplicateLayerCommand,
  GroupLayersCommand,
  PasteLayersCommand,
  RemoveArtboardCommand,
  RemoveLayerCommand,
  ReorderLayerCommand,
  SetProjectNameCommand,
  UngroupLayersCommand,
  UpdateArtboardCommand,
  UpdateLayerStyleCommand,
  UpdateLayerTransformCommand,
  UpdateTextCommand,
} from '@openreel/image-core/commands';
import {
  Project,
  Layer,
  ImageLayer,
  TextLayer,
  ShapeLayer,
  GroupLayer,
  Artboard,
  MediaAsset,
  Transform,
  DEFAULT_TRANSFORM,
  DEFAULT_BLEND_MODE,
  DEFAULT_SHADOW,
  DEFAULT_INNER_SHADOW,
  DEFAULT_STROKE,
  DEFAULT_GLOW,
  DEFAULT_FILTER,
  DEFAULT_TEXT_STYLE,
  DEFAULT_SHAPE_STYLE,
  DEFAULT_LEVELS,
  DEFAULT_CURVES,
  DEFAULT_COLOR_BALANCE,
  DEFAULT_SELECTIVE_COLOR,
  DEFAULT_BLACK_WHITE,
  DEFAULT_PHOTO_FILTER,
  DEFAULT_CHANNEL_MIXER,
  DEFAULT_GRADIENT_MAP,
  DEFAULT_POSTERIZE,
  DEFAULT_THRESHOLD,
  CanvasSize,
  CanvasBackground,
} from '../types/project';
import { useHistoryStore } from './history-store';

interface LayerStyle {
  blendMode: Layer['blendMode'];
  shadow: Layer['shadow'];
  innerShadow: Layer['innerShadow'];
  stroke: Layer['stroke'];
  glow: Layer['glow'];
  filters: Layer['filters'];
}

interface ProjectState {
  project: Project | null;
  selectedLayerIds: string[];
  selectedArtboardId: string | null;
  copiedLayers: Layer[];
  copiedStyle: LayerStyle | null;
  isDirty: boolean;
}

interface ProjectActions {
  createProject: (name: string, size: CanvasSize, background?: CanvasBackground) => void;
  loadProject: (project: Project) => void;
  closeProject: () => void;
  setProjectName: (name: string) => void;

  // Convenience undo/redo that delegate to the history store.
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  addArtboard: (name: string, size: CanvasSize, position?: { x: number; y: number }) => string;
  removeArtboard: (artboardId: string) => void;
  updateArtboard: (artboardId: string, updates: Partial<Artboard>) => void;
  selectArtboard: (artboardId: string | null) => void;

  addImageLayer: (sourceId: string, transform?: Partial<Transform>) => string;
  addTextLayer: (content: string, transform?: Partial<Transform>) => string;
  addShapeLayer: (shapeType: ShapeLayer['shapeType'], transform?: Partial<Transform>) => string;
  addPathLayer: (points: { x: number; y: number }[], strokeColor: string, strokeWidth: number) => string;
  addGroupLayer: (childIds: string[]) => string;
  removeLayer: (layerId: string) => void;
  removeLayers: (layerIds: string[]) => void;
  updateLayer: <T extends Layer>(layerId: string, updates: Partial<T>) => void;
  updateLayerTransform: (layerId: string, transform: Partial<Transform>) => void;
  duplicateLayer: (layerId: string) => string | null;
  duplicateLayers: (layerIds: string[]) => string[];

  selectLayer: (layerId: string, addToSelection?: boolean) => void;
  selectLayers: (layerIds: string[]) => void;
  deselectLayer: (layerId: string) => void;
  deselectAllLayers: () => void;
  selectAllLayers: () => void;

  moveLayerUp: (layerId: string) => void;
  moveLayerDown: (layerId: string) => void;
  moveLayerToTop: (layerId: string) => void;
  moveLayerToBottom: (layerId: string) => void;
  reorderLayers: (layerIds: string[]) => void;

  copyLayers: () => void;
  cutLayers: () => void;
  pasteLayers: () => void;

  copyLayerStyle: () => void;
  pasteLayerStyle: () => void;

  groupLayers: (layerIds: string[]) => string | null;
  ungroupLayers: (groupId: string) => void;

  addAsset: (asset: MediaAsset) => void;
  removeAsset: (assetId: string) => void;

  markDirty: () => void;
  markClean: () => void;
}

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Helper to apply a command and update the project in one shot.
function execCmd(
  project: Project,
  command: Parameters<ReturnType<typeof useHistoryStore['getState']>['execute']>[0],
): Project {
  return useHistoryStore.getState().execute(command, project);
}

export const useProjectStore = create<ProjectState & ProjectActions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      project: null,
      selectedLayerIds: [],
      selectedArtboardId: null,
      copiedLayers: [],
      copiedStyle: null,
      isDirty: false,

      // ── Project lifecycle ────────────────────────────────────────────────

      createProject: (name, size, background) => {
        const artboardId = generateId();
        const project = createProjectDocument({
          id: generateId(),
          artboardId,
          name,
          size,
          background,
        });
        useHistoryStore.getState().clear(project);
        set({ project, selectedLayerIds: [], selectedArtboardId: artboardId, isDirty: true });
      },

      loadProject: (project) => {
        const parsed = deserializeProject(project as unknown as Record<string, unknown>);
        if (!parsed.success) {
          console.error('[project-store] Invalid project:', parsed.error);
          return;
        }
        const validated = parsed.data;
        set({
          project: validated,
          selectedLayerIds: [],
          selectedArtboardId: validated.activeArtboardId,
          isDirty: false,
        });
      },

      closeProject: () => {
        useHistoryStore.getState().clear();
        set({ project: null, selectedLayerIds: [], selectedArtboardId: null, isDirty: false });
      },

      setProjectName: (name) => {
        const { project } = get();
        if (!project) return;
        const cmd = new SetProjectNameCommand(name, project.name);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      // ── Undo / Redo ─────────────────────────────────────────────────────

      undo: () => {
        const { project } = get();
        if (!project) return;
        const newProject = useHistoryStore.getState().undo(project);
        if (newProject) {
          set({
            project: newProject,
            selectedLayerIds: [],
            selectedArtboardId: newProject.activeArtboardId,
            isDirty: true,
          });
        }
      },

      redo: () => {
        const { project } = get();
        if (!project) return;
        const newProject = useHistoryStore.getState().redo(project);
        if (newProject) {
          set({
            project: newProject,
            selectedLayerIds: [],
            selectedArtboardId: newProject.activeArtboardId,
            isDirty: true,
          });
        }
      },

      canUndo: () => useHistoryStore.getState().canUndo(),
      canRedo: () => useHistoryStore.getState().canRedo(),

      // ── Artboard operations ──────────────────────────────────────────────

      addArtboard: (name, size, position) => {
        const { project } = get();
        if (!project) return '';
        const id = generateId();
        const artboard: Artboard = {
          id,
          name,
          size,
          background: { type: 'color', color: '#ffffff' },
          layerIds: [],
          position: position ?? {
            x: (project.artboards.length % 3) * (size.width + 100),
            y: Math.floor(project.artboards.length / 3) * (size.height + 100),
          },
        };
        const insertIndex = project.artboards.length;
        const cmd = new AddArtboardCommand(artboard, insertIndex);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
        return id;
      },

      removeArtboard: (artboardId) => {
        const { project } = get();
        if (!project || project.artboards.length <= 1) return;
        const artboard = project.artboards.find((a) => a.id === artboardId);
        if (!artboard) return;
        const removedLayers: Record<string, Layer> = {};
        artboard.layerIds.forEach((id) => {
          if (project.layers[id]) removedLayers[id] = project.layers[id];
        });
        const originalIndex = project.artboards.findIndex((a) => a.id === artboardId);
        const cmd = new RemoveArtboardCommand(artboardId, artboard, removedLayers, originalIndex);
        const newProject = execCmd(project, cmd);
        const { selectedArtboardId } = get();
        const nextSelectedArtboard =
          selectedArtboardId === artboardId
            ? newProject.artboards[0]?.id ?? null
            : selectedArtboardId;
        set({ project: newProject, selectedArtboardId: nextSelectedArtboard, isDirty: true });
      },

      updateArtboard: (artboardId, updates) => {
        const { project } = get();
        if (!project) return;
        const artboard = project.artboards.find((a) => a.id === artboardId);
        if (!artboard) return;
        const prevValues: Partial<Artboard> = {};
        (Object.keys(updates) as (keyof Artboard)[]).forEach((k) => {
          (prevValues as Record<string, unknown>)[k] = artboard[k];
        });
        const cmd = new UpdateArtboardCommand(artboardId, updates, prevValues);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      selectArtboard: (artboardId) => {
        set({ selectedArtboardId: artboardId, selectedLayerIds: [] });
      },

      // ── Layer add helpers ────────────────────────────────────────────────

      addImageLayer: (sourceId, transform) => {
        const id = generateId();
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return id;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return id;
        const asset = project.assets[sourceId];
        const layer: ImageLayer = {
          id,
          name: asset?.name ?? 'Image',
          type: 'image',
          visible: true,
          locked: false,
          transform: {
            ...DEFAULT_TRANSFORM,
            width: asset?.width ?? 200,
            height: asset?.height ?? 200,
            x: (artboard.size.width - (asset?.width ?? 200)) / 2,
            y: (artboard.size.height - (asset?.height ?? 200)) / 2,
            ...transform,
          },
          blendMode: DEFAULT_BLEND_MODE,
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          stroke: DEFAULT_STROKE,
          glow: DEFAULT_GLOW,
          filters: DEFAULT_FILTER,
          parentId: null,
          sourceId,
          cropRect: null,
          flipHorizontal: false,
          flipVertical: false,
          mask: null,
          clippingMask: false,
          levels: { ...DEFAULT_LEVELS },
          curves: { ...DEFAULT_CURVES },
          colorBalance: { ...DEFAULT_COLOR_BALANCE },
          selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
          blackWhite: { ...DEFAULT_BLACK_WHITE },
          photoFilter: { ...DEFAULT_PHOTO_FILTER },
          channelMixer: { ...DEFAULT_CHANNEL_MIXER },
          gradientMap: { ...DEFAULT_GRADIENT_MAP },
          posterize: { ...DEFAULT_POSTERIZE },
          threshold: { ...DEFAULT_THRESHOLD },
        };
        const cmd = new AddLayerCommand(selectedArtboardId, layer, 0);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: [id], isDirty: true });
        return id;
      },

      addTextLayer: (content, transform) => {
        const id = generateId();
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return id;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return id;
        const layer: TextLayer = {
          id,
          name: content.slice(0, 20) || 'Text',
          type: 'text',
          visible: true,
          locked: false,
          transform: {
            ...DEFAULT_TRANSFORM,
            width: 200,
            height: 50,
            x: (artboard.size.width - 200) / 2,
            y: (artboard.size.height - 50) / 2,
            ...transform,
          },
          blendMode: DEFAULT_BLEND_MODE,
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          stroke: DEFAULT_STROKE,
          glow: DEFAULT_GLOW,
          filters: DEFAULT_FILTER,
          parentId: null,
          flipHorizontal: false,
          flipVertical: false,
          content,
          style: DEFAULT_TEXT_STYLE,
          autoSize: true,
          mask: null,
          clippingMask: false,
          levels: { ...DEFAULT_LEVELS },
          curves: { ...DEFAULT_CURVES },
          colorBalance: { ...DEFAULT_COLOR_BALANCE },
          selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
          blackWhite: { ...DEFAULT_BLACK_WHITE },
          photoFilter: { ...DEFAULT_PHOTO_FILTER },
          channelMixer: { ...DEFAULT_CHANNEL_MIXER },
          gradientMap: { ...DEFAULT_GRADIENT_MAP },
          posterize: { ...DEFAULT_POSTERIZE },
          threshold: { ...DEFAULT_THRESHOLD },
        };
        const cmd = new AddLayerCommand(selectedArtboardId, layer, 0);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: [id], isDirty: true });
        return id;
      },

      addShapeLayer: (shapeType, transform) => {
        const id = generateId();
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return id;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return id;
        const layer: ShapeLayer = {
          id,
          name: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
          type: 'shape',
          visible: true,
          locked: false,
          transform: {
            ...DEFAULT_TRANSFORM,
            width: 100,
            height: 100,
            x: (artboard.size.width - 100) / 2,
            y: (artboard.size.height - 100) / 2,
            ...transform,
          },
          blendMode: DEFAULT_BLEND_MODE,
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          stroke: DEFAULT_STROKE,
          glow: DEFAULT_GLOW,
          filters: DEFAULT_FILTER,
          parentId: null,
          flipHorizontal: false,
          flipVertical: false,
          shapeType,
          shapeStyle: DEFAULT_SHAPE_STYLE,
          mask: null,
          clippingMask: false,
          levels: { ...DEFAULT_LEVELS },
          curves: { ...DEFAULT_CURVES },
          colorBalance: { ...DEFAULT_COLOR_BALANCE },
          selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
          blackWhite: { ...DEFAULT_BLACK_WHITE },
          photoFilter: { ...DEFAULT_PHOTO_FILTER },
          channelMixer: { ...DEFAULT_CHANNEL_MIXER },
          gradientMap: { ...DEFAULT_GRADIENT_MAP },
          posterize: { ...DEFAULT_POSTERIZE },
          threshold: { ...DEFAULT_THRESHOLD },
        };
        const cmd = new AddLayerCommand(selectedArtboardId, layer, 0);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: [id], isDirty: true });
        return id;
      },

      addPathLayer: (points, strokeColor, strokeWidth) => {
        const id = generateId();
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId || points.length <= 1) return id;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return id;
        const minX = Math.min(...points.map((p) => p.x));
        const minY = Math.min(...points.map((p) => p.y));
        const maxX = Math.max(...points.map((p) => p.x));
        const maxY = Math.max(...points.map((p) => p.y));
        const width = Math.max(maxX - minX, 1);
        const height = Math.max(maxY - minY, 1);
        const normalizedPoints = points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
        const layer: ShapeLayer = {
          id,
          name: 'Drawing',
          type: 'shape',
          visible: true,
          locked: false,
          transform: { ...DEFAULT_TRANSFORM, x: minX, y: minY, width, height },
          blendMode: DEFAULT_BLEND_MODE,
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          stroke: DEFAULT_STROKE,
          glow: DEFAULT_GLOW,
          filters: DEFAULT_FILTER,
          parentId: null,
          flipHorizontal: false,
          flipVertical: false,
          shapeType: 'path',
          shapeStyle: { ...DEFAULT_SHAPE_STYLE, fill: null, stroke: strokeColor, strokeWidth },
          points: normalizedPoints,
          mask: null,
          clippingMask: false,
          levels: { ...DEFAULT_LEVELS },
          curves: { ...DEFAULT_CURVES },
          colorBalance: { ...DEFAULT_COLOR_BALANCE },
          selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
          blackWhite: { ...DEFAULT_BLACK_WHITE },
          photoFilter: { ...DEFAULT_PHOTO_FILTER },
          channelMixer: { ...DEFAULT_CHANNEL_MIXER },
          gradientMap: { ...DEFAULT_GRADIENT_MAP },
          posterize: { ...DEFAULT_POSTERIZE },
          threshold: { ...DEFAULT_THRESHOLD },
        };
        const cmd = new AddLayerCommand(selectedArtboardId, layer, 0, 'Draw path');
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: [id], isDirty: true });
        return id;
      },

      addGroupLayer: (childIds) => {
        const id = generateId();
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId || childIds.length === 0) return id;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return id;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        childIds.forEach((childId) => {
          const child = project.layers[childId];
          if (child) {
            const { x, y, width, height } = child.transform;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + width);
            maxY = Math.max(maxY, y + height);
          }
        });

        const groupX = minX;
        const groupY = minY;
        const groupWidth = maxX - minX;
        const groupHeight = maxY - minY;

        // Capture children before state (with adjusted coordinates) for the group.
        const childLayersBefore: Record<string, Layer> = {};
        const adjustedChildren: Record<string, Layer> = {};
        childIds.forEach((childId) => {
          const child = project.layers[childId];
          if (child) {
            childLayersBefore[childId] = JSON.parse(JSON.stringify(child));
            adjustedChildren[childId] = {
              ...JSON.parse(JSON.stringify(child)),
              transform: { ...child.transform, x: child.transform.x - groupX, y: child.transform.y - groupY },
              parentId: id,
            };
          }
        });

        const groupLayer: GroupLayer = {
          id,
          name: 'Group',
          type: 'group',
          visible: true,
          locked: false,
          transform: { ...DEFAULT_TRANSFORM, x: groupX, y: groupY, width: groupWidth, height: groupHeight },
          blendMode: DEFAULT_BLEND_MODE,
          shadow: DEFAULT_SHADOW,
          innerShadow: DEFAULT_INNER_SHADOW,
          stroke: DEFAULT_STROKE,
          glow: DEFAULT_GLOW,
          filters: DEFAULT_FILTER,
          parentId: null,
          flipHorizontal: false,
          flipVertical: false,
          childIds,
          expanded: true,
          mask: null,
          clippingMask: false,
          levels: { ...DEFAULT_LEVELS },
          curves: { ...DEFAULT_CURVES },
          colorBalance: { ...DEFAULT_COLOR_BALANCE },
          selectiveColor: { ...DEFAULT_SELECTIVE_COLOR },
          blackWhite: { ...DEFAULT_BLACK_WHITE },
          photoFilter: { ...DEFAULT_PHOTO_FILTER },
          channelMixer: { ...DEFAULT_CHANNEL_MIXER },
          gradientMap: { ...DEFAULT_GRADIENT_MAP },
          posterize: { ...DEFAULT_POSTERIZE },
          threshold: { ...DEFAULT_THRESHOLD },
        };

        const firstChildIndex = artboard.layerIds.findIndex((lid) => childIds.includes(lid));
        const prevArtboardLayerIds = [...artboard.layerIds];
        const cmd = new GroupLayersCommand(
          selectedArtboardId,
          groupLayer,
          Math.max(firstChildIndex, 0),
          prevArtboardLayerIds,
          adjustedChildren,
        );
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: [id], isDirty: true });
        return id;
      },

      removeLayer: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !project.layers[layerId]) return;
        const layer = project.layers[layerId];
        // Find which artboard owns this layer.
        const ownerArtboard = project.artboards.find(
          (a) => a.layerIds.includes(layerId) || Object.values(project.layers).some(
            (l) => l.type === 'group' && (l as GroupLayer).childIds.includes(layerId) && a.layerIds.includes(l.id)
          )
        ) ?? project.artboards.find((a) => a.id === selectedArtboardId);
        const artboardId = ownerArtboard?.id ?? selectedArtboardId ?? project.artboards[0]?.id ?? '';
        const originalIndex = ownerArtboard?.layerIds.indexOf(layerId) ?? 0;
        const cmd = new RemoveLayerCommand(layerId, artboardId, layer, Math.max(originalIndex, 0));
        const newProject = execCmd(project, cmd);
        set({
          project: newProject,
          selectedLayerIds: get().selectedLayerIds.filter((id) => id !== layerId),
          isDirty: true,
        });
      },

      removeLayers: (layerIds) => {
        layerIds.forEach((id) => get().removeLayer(id));
      },

      updateLayer: (layerId, updates) => {
        const { project } = get();
        if (!project || !project.layers[layerId]) return;
        const layer = project.layers[layerId];
        // Build prevValues capturing only the keys being updated.
        const prevValues: Partial<Layer> = {};
        (Object.keys(updates) as (keyof Layer)[]).forEach((k) => {
          (prevValues as Record<string, unknown>)[k] = layer[k];
        });
        let cmd;
        const textLayer = layer as TextLayer;
        const updatesTyped = updates as Record<string, unknown>;
        if (layer.type === 'text' && ('content' in updates || 'style' in updates)) {
          cmd = new UpdateTextCommand(
            layerId,
            (updatesTyped.content as string | undefined) ?? textLayer.content,
            textLayer.content,
            (updatesTyped.style as TextLayer['style'] | undefined) ?? null,
            (updatesTyped.style !== undefined) ? textLayer.style : null,
          );
        } else {
          cmd = new UpdateLayerStyleCommand(layerId, updates as Partial<Layer>, prevValues);
        }
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      updateLayerTransform: (layerId, transform) => {
        const { project } = get();
        if (!project || !project.layers[layerId]) return;
        const layer = project.layers[layerId];
        const prevTransform: Partial<Transform> = {};
        (Object.keys(transform) as (keyof Transform)[]).forEach((k) => {
          (prevTransform as Record<string, unknown>)[k] = layer.transform[k];
        });
        const cmd = new UpdateLayerTransformCommand(layerId, transform, prevTransform);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      duplicateLayer: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return null;
        const newId = generateId();
        const duplicated = duplicateLayerInProject(project, selectedArtboardId, layerId, newId);
        if (!duplicated) return null;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        const originalIndex = artboard?.layerIds.indexOf(layerId) ?? 0;
        const cmd = new DuplicateLayerCommand(
          selectedArtboardId,
          duplicated.project.layers[newId],
          Math.max(originalIndex, 0),
        );
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: [newId], isDirty: true });
        return newId;
      },

      duplicateLayers: (layerIds) =>
        layerIds.map((id) => get().duplicateLayer(id)).filter((id): id is string => id !== null),

      // ── Selection (no commands needed, pure UI state) ────────────────────

      selectLayer: (layerId, addToSelection = false) => {
        set((state) => {
          if (addToSelection) {
            if (!state.selectedLayerIds.includes(layerId)) {
              state.selectedLayerIds.push(layerId);
            }
          } else {
            state.selectedLayerIds = [layerId];
          }
        });
      },

      selectLayers: (layerIds) => set({ selectedLayerIds: layerIds }),

      deselectLayer: (layerId) => {
        set((state) => {
          state.selectedLayerIds = state.selectedLayerIds.filter((id) => id !== layerId);
        });
      },

      deselectAllLayers: () => set({ selectedLayerIds: [] }),

      selectAllLayers: () => {
        const { project, selectedArtboardId } = get();
        if (project && selectedArtboardId) {
          const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
          if (artboard) set({ selectedLayerIds: [...artboard.layerIds] });
        }
      },

      // ── Layer reorder operations ─────────────────────────────────────────

      moveLayerUp: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const index = artboard.layerIds.indexOf(layerId);
        if (index <= 0) return;
        const newIds = [...artboard.layerIds];
        [newIds[index - 1], newIds[index]] = [newIds[index], newIds[index - 1]];
        const cmd = new ReorderLayerCommand(selectedArtboardId, newIds, artboard.layerIds, 'Move layer up');
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      moveLayerDown: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const index = artboard.layerIds.indexOf(layerId);
        if (index >= artboard.layerIds.length - 1) return;
        const newIds = [...artboard.layerIds];
        [newIds[index], newIds[index + 1]] = [newIds[index + 1], newIds[index]];
        const cmd = new ReorderLayerCommand(selectedArtboardId, newIds, artboard.layerIds, 'Move layer down');
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      moveLayerToTop: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const newIds = [layerId, ...artboard.layerIds.filter((id) => id !== layerId)];
        const cmd = new ReorderLayerCommand(selectedArtboardId, newIds, artboard.layerIds, 'Move layer to top');
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      moveLayerToBottom: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const newIds = [...artboard.layerIds.filter((id) => id !== layerId), layerId];
        const cmd = new ReorderLayerCommand(selectedArtboardId, newIds, artboard.layerIds, 'Move layer to bottom');
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      reorderLayers: (layerIds) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const cmd = new ReorderLayerCommand(selectedArtboardId, layerIds, artboard.layerIds);
        const newProject = execCmd(project, cmd);
        set({ project: newProject, isDirty: true });
      },

      // ── Copy / paste ─────────────────────────────────────────────────────

      copyLayers: () => {
        const { project, selectedLayerIds } = get();
        if (project && selectedLayerIds.length > 0) {
          const layers = selectedLayerIds.map((id) => project.layers[id]).filter(Boolean);
          set({ copiedLayers: JSON.parse(JSON.stringify(layers)) });
        }
      },

      cutLayers: () => {
        get().copyLayers();
        get().removeLayers(get().selectedLayerIds);
      },

      pasteLayers: () => {
        const { copiedLayers, selectedArtboardId, project } = get();
        if (!copiedLayers.length || !selectedArtboardId || !project) return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const pastedLayers: Layer[] = copiedLayers.map((layer) => ({
          ...JSON.parse(JSON.stringify(layer)),
          id: generateId(),
          name: `${layer.name} copy`,
          transform: { ...layer.transform, x: layer.transform.x + 20, y: layer.transform.y + 20 },
        }));
        const cmd = new PasteLayersCommand(selectedArtboardId, pastedLayers, artboard.layerIds);
        const newProject = execCmd(project, cmd);
        set({
          project: newProject,
          selectedLayerIds: pastedLayers.map((l) => l.id),
          isDirty: true,
        });
      },

      // ── Style copy/paste (pure UI state + one UpdateLayerStyleCommand) ──

      copyLayerStyle: () => {
        const { project, selectedLayerIds } = get();
        if (project && selectedLayerIds.length === 1) {
          const layer = project.layers[selectedLayerIds[0]];
          if (layer) {
            set({
              copiedStyle: {
                blendMode: layer.blendMode ? JSON.parse(JSON.stringify(layer.blendMode)) : DEFAULT_BLEND_MODE,
                shadow: layer.shadow ? JSON.parse(JSON.stringify(layer.shadow)) : DEFAULT_SHADOW,
                innerShadow: layer.innerShadow ? JSON.parse(JSON.stringify(layer.innerShadow)) : DEFAULT_INNER_SHADOW,
                stroke: layer.stroke ? JSON.parse(JSON.stringify(layer.stroke)) : DEFAULT_STROKE,
                glow: layer.glow ? JSON.parse(JSON.stringify(layer.glow)) : DEFAULT_GLOW,
                filters: layer.filters ? JSON.parse(JSON.stringify(layer.filters)) : DEFAULT_FILTER,
              },
            });
          }
        }
      },

      pasteLayerStyle: () => {
        const { copiedStyle, selectedLayerIds } = get();
        let currentProject = get().project;
        if (!copiedStyle || !selectedLayerIds.length || !currentProject) return;

        for (const layerId of selectedLayerIds) {
          const layer = currentProject.layers[layerId];
          if (!layer) continue;
          const styleUpdates: Partial<Layer> = {
            blendMode: structuredClone(copiedStyle.blendMode ?? DEFAULT_BLEND_MODE),
            shadow: structuredClone(copiedStyle.shadow ?? DEFAULT_SHADOW),
            innerShadow: structuredClone(copiedStyle.innerShadow ?? DEFAULT_INNER_SHADOW),
            stroke: structuredClone(copiedStyle.stroke ?? DEFAULT_STROKE),
            glow: structuredClone(copiedStyle.glow ?? DEFAULT_GLOW),
            filters: structuredClone(copiedStyle.filters ?? DEFAULT_FILTER),
          };
          const prevValues: Partial<Layer> = {
            blendMode: layer.blendMode,
            shadow: layer.shadow,
            innerShadow: layer.innerShadow,
            stroke: layer.stroke,
            glow: layer.glow,
            filters: layer.filters,
          };
          const cmd = new UpdateLayerStyleCommand(layerId, styleUpdates, prevValues, 'Paste layer style');
          currentProject = execCmd(currentProject, cmd);
        }
        set({ project: currentProject, isDirty: true });
      },

      // ── Group / ungroup ──────────────────────────────────────────────────

      groupLayers: (layerIds) => {
        if (layerIds.length < 2) return null;
        return get().addGroupLayer(layerIds);
      },

      ungroupLayers: (groupId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return;
        const group = project.layers[groupId] as GroupLayer;
        if (!group || group.type !== 'group') return;
        const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
        if (!artboard) return;
        const prevArtboardLayerIds = [...artboard.layerIds];
        const childLayersBefore: Record<string, Layer> = {};
        group.childIds.forEach((childId) => {
          if (project.layers[childId]) {
            childLayersBefore[childId] = JSON.parse(JSON.stringify(project.layers[childId]));
          }
        });
        const cmd = new UngroupLayersCommand(
          selectedArtboardId,
          groupId,
          JSON.parse(JSON.stringify(group)),
          prevArtboardLayerIds,
          childLayersBefore,
        );
        const newProject = execCmd(project, cmd);
        set({ project: newProject, selectedLayerIds: group.childIds, isDirty: true });
      },

      // ── Assets (no undo needed for asset registration) ───────────────────

      addAsset: (asset) => {
        set((state) => {
          if (state.project) {
            state.project.assets[asset.id] = asset;
            state.project.updatedAt = Date.now();
            state.isDirty = true;
          }
        });
      },

      removeAsset: (assetId) => {
        set((state) => {
          if (state.project) {
            delete state.project.assets[assetId];
            state.project.updatedAt = Date.now();
            state.isDirty = true;
          }
        });
      },

      markDirty: () => set({ isDirty: true }),
      markClean: () => set({ isDirty: false }),
    }))
  )
);
