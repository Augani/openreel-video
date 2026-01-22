import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
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
  CanvasSize,
  CanvasBackground,
} from '../types/project';

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

export const useProjectStore = create<ProjectState & ProjectActions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      project: null,
      selectedLayerIds: [],
      selectedArtboardId: null,
      copiedLayers: [],
      copiedStyle: null,
      isDirty: false,

      createProject: (name, size, background) => {
        const artboardId = generateId();
        const project: Project = {
          id: generateId(),
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          artboards: [
            {
              id: artboardId,
              name: 'Artboard 1',
              size,
              background: background ?? { type: 'color', color: '#ffffff' },
              layerIds: [],
              position: { x: 0, y: 0 },
            },
          ],
          layers: {},
          assets: {},
          activeArtboardId: artboardId,
        };
        set({ project, selectedLayerIds: [], selectedArtboardId: artboardId, isDirty: true });
      },

      loadProject: (project) => {
        set({
          project,
          selectedLayerIds: [],
          selectedArtboardId: project.activeArtboardId,
          isDirty: false,
        });
      },

      closeProject: () => {
        set({ project: null, selectedLayerIds: [], selectedArtboardId: null, isDirty: false });
      },

      setProjectName: (name) => {
        set((state) => {
          if (state.project) {
            state.project.name = name;
            state.project.updatedAt = Date.now();
            state.isDirty = true;
          }
        });
      },

      addArtboard: (name, size, position) => {
        const id = generateId();
        set((state) => {
          if (state.project) {
            state.project.artboards.push({
              id,
              name,
              size,
              background: { type: 'color', color: '#ffffff' },
              layerIds: [],
              position: position ?? { x: (state.project.artboards.length % 3) * (size.width + 100), y: Math.floor(state.project.artboards.length / 3) * (size.height + 100) },
            });
            state.project.updatedAt = Date.now();
            state.isDirty = true;
          }
        });
        return id;
      },

      removeArtboard: (artboardId) => {
        set((state) => {
          if (state.project && state.project.artboards.length > 1) {
            const artboard = state.project.artboards.find((a) => a.id === artboardId);
            if (artboard) {
              artboard.layerIds.forEach((layerId) => {
                delete state.project!.layers[layerId];
              });
              state.project.artboards = state.project.artboards.filter((a) => a.id !== artboardId);
              if (state.selectedArtboardId === artboardId) {
                state.selectedArtboardId = state.project.artboards[0]?.id ?? null;
              }
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      updateArtboard: (artboardId, updates) => {
        set((state) => {
          if (state.project) {
            const artboard = state.project.artboards.find((a) => a.id === artboardId);
            if (artboard) {
              Object.assign(artboard, updates);
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      selectArtboard: (artboardId) => {
        set({ selectedArtboardId: artboardId, selectedLayerIds: [] });
      },

      addImageLayer: (sourceId, transform) => {
        const id = generateId();
        const asset = get().project?.assets[sourceId];
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
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
              };
              state.project.layers[id] = layer;
              artboard.layerIds.unshift(id);
              state.selectedLayerIds = [id];
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
        return id;
      },

      addTextLayer: (content, transform) => {
        const id = generateId();
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
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
              };
              state.project.layers[id] = layer;
              artboard.layerIds.unshift(id);
              state.selectedLayerIds = [id];
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
        return id;
      },

      addShapeLayer: (shapeType, transform) => {
        const id = generateId();
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
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
              };
              state.project.layers[id] = layer;
              artboard.layerIds.unshift(id);
              state.selectedLayerIds = [id];
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
        return id;
      },

      addPathLayer: (points, strokeColor, strokeWidth) => {
        const id = generateId();
        set((state) => {
          if (state.project && state.selectedArtboardId && points.length > 1) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
              const minX = Math.min(...points.map((p) => p.x));
              const minY = Math.min(...points.map((p) => p.y));
              const maxX = Math.max(...points.map((p) => p.x));
              const maxY = Math.max(...points.map((p) => p.y));
              const width = Math.max(maxX - minX, 1);
              const height = Math.max(maxY - minY, 1);

              const normalizedPoints = points.map((p) => ({
                x: p.x - minX,
                y: p.y - minY,
              }));

              const layer: ShapeLayer = {
                id,
                name: 'Drawing',
                type: 'shape',
                visible: true,
                locked: false,
                transform: {
                  ...DEFAULT_TRANSFORM,
                  x: minX,
                  y: minY,
                  width,
                  height,
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
                shapeType: 'path',
                shapeStyle: {
                  ...DEFAULT_SHAPE_STYLE,
                  fill: null,
                  stroke: strokeColor,
                  strokeWidth,
                },
                points: normalizedPoints,
                mask: null,
                clippingMask: false,
                levels: { ...DEFAULT_LEVELS },
                curves: { ...DEFAULT_CURVES },
                colorBalance: { ...DEFAULT_COLOR_BALANCE },
              };
              state.project.layers[id] = layer;
              artboard.layerIds.unshift(id);
              state.selectedLayerIds = [id];
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
        return id;
      },

      addGroupLayer: (childIds) => {
        const id = generateId();
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard && childIds.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              childIds.forEach((childId) => {
                const child = state.project!.layers[childId];
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

              childIds.forEach((childId) => {
                const child = state.project!.layers[childId];
                if (child) {
                  child.transform.x -= groupX;
                  child.transform.y -= groupY;
                  child.parentId = id;
                }
              });

              const layer: GroupLayer = {
                id,
                name: 'Group',
                type: 'group',
                visible: true,
                locked: false,
                transform: {
                  ...DEFAULT_TRANSFORM,
                  x: groupX,
                  y: groupY,
                  width: groupWidth,
                  height: groupHeight,
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
                childIds,
                expanded: true,
                mask: null,
                clippingMask: false,
                levels: { ...DEFAULT_LEVELS },
                curves: { ...DEFAULT_CURVES },
                colorBalance: { ...DEFAULT_COLOR_BALANCE },
              };

              state.project.layers[id] = layer;
              const firstChildIndex = artboard.layerIds.findIndex((lid) => childIds.includes(lid));
              artboard.layerIds = artboard.layerIds.filter((lid) => !childIds.includes(lid));
              artboard.layerIds.splice(firstChildIndex, 0, id);
              state.selectedLayerIds = [id];
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
        return id;
      },

      removeLayer: (layerId) => {
        set((state) => {
          if (state.project) {
            const layer = state.project.layers[layerId];
            if (layer) {
              if (layer.type === 'group') {
                (layer as GroupLayer).childIds.forEach((childId) => {
                  delete state.project!.layers[childId];
                });
              }
              delete state.project.layers[layerId];
              state.project.artboards.forEach((artboard) => {
                artboard.layerIds = artboard.layerIds.filter((id) => id !== layerId);
              });
              state.selectedLayerIds = state.selectedLayerIds.filter((id) => id !== layerId);
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      removeLayers: (layerIds) => {
        layerIds.forEach((id) => get().removeLayer(id));
      },

      updateLayer: (layerId, updates) => {
        set((state) => {
          if (state.project) {
            const layer = state.project.layers[layerId];
            if (layer) {
              Object.assign(layer, updates);
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      updateLayerTransform: (layerId, transform) => {
        set((state) => {
          if (state.project) {
            const layer = state.project.layers[layerId];
            if (layer) {
              Object.assign(layer.transform, transform);
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      duplicateLayer: (layerId) => {
        const { project, selectedArtboardId } = get();
        if (!project || !selectedArtboardId) return null;

        const layer = project.layers[layerId];
        if (!layer) return null;

        const newId = generateId();
        set((state) => {
          if (state.project) {
            const artboard = state.project.artboards.find((a) => a.id === selectedArtboardId);
            if (artboard) {
              const newLayer = JSON.parse(JSON.stringify(layer));
              newLayer.id = newId;
              newLayer.name = `${layer.name} copy`;
              newLayer.transform.x += 20;
              newLayer.transform.y += 20;
              state.project.layers[newId] = newLayer;
              const originalIndex = artboard.layerIds.indexOf(layerId);
              artboard.layerIds.splice(originalIndex, 0, newId);
              state.selectedLayerIds = [newId];
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
        return newId;
      },

      duplicateLayers: (layerIds) => {
        return layerIds.map((id) => get().duplicateLayer(id)).filter((id): id is string => id !== null);
      },

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

      selectLayers: (layerIds) => {
        set({ selectedLayerIds: layerIds });
      },

      deselectLayer: (layerId) => {
        set((state) => {
          state.selectedLayerIds = state.selectedLayerIds.filter((id) => id !== layerId);
        });
      },

      deselectAllLayers: () => {
        set({ selectedLayerIds: [] });
      },

      selectAllLayers: () => {
        const { project, selectedArtboardId } = get();
        if (project && selectedArtboardId) {
          const artboard = project.artboards.find((a) => a.id === selectedArtboardId);
          if (artboard) {
            set({ selectedLayerIds: [...artboard.layerIds] });
          }
        }
      },

      moveLayerUp: (layerId) => {
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
              const index = artboard.layerIds.indexOf(layerId);
              if (index > 0) {
                [artboard.layerIds[index - 1], artboard.layerIds[index]] = [artboard.layerIds[index], artboard.layerIds[index - 1]];
                state.project.updatedAt = Date.now();
                state.isDirty = true;
              }
            }
          }
        });
      },

      moveLayerDown: (layerId) => {
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
              const index = artboard.layerIds.indexOf(layerId);
              if (index < artboard.layerIds.length - 1) {
                [artboard.layerIds[index], artboard.layerIds[index + 1]] = [artboard.layerIds[index + 1], artboard.layerIds[index]];
                state.project.updatedAt = Date.now();
                state.isDirty = true;
              }
            }
          }
        });
      },

      moveLayerToTop: (layerId) => {
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
              artboard.layerIds = artboard.layerIds.filter((id) => id !== layerId);
              artboard.layerIds.unshift(layerId);
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      moveLayerToBottom: (layerId) => {
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
              artboard.layerIds = artboard.layerIds.filter((id) => id !== layerId);
              artboard.layerIds.push(layerId);
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

      reorderLayers: (layerIds) => {
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
            if (artboard) {
              artboard.layerIds = layerIds;
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          }
        });
      },

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
        if (copiedLayers.length > 0 && selectedArtboardId && project) {
          const newIds: string[] = [];
          set((state) => {
            if (state.project) {
              const artboard = state.project.artboards.find((a) => a.id === selectedArtboardId);
              if (artboard) {
                copiedLayers.forEach((layer) => {
                  const newId = generateId();
                  const newLayer = JSON.parse(JSON.stringify(layer));
                  newLayer.id = newId;
                  newLayer.name = `${layer.name} copy`;
                  newLayer.transform.x += 20;
                  newLayer.transform.y += 20;
                  state.project!.layers[newId] = newLayer;
                  artboard.layerIds.unshift(newId);
                  newIds.push(newId);
                });
                state.selectedLayerIds = newIds;
                state.project.updatedAt = Date.now();
                state.isDirty = true;
              }
            }
          });
        }
      },

      groupLayers: (layerIds) => {
        if (layerIds.length < 2) return null;
        return get().addGroupLayer(layerIds);
      },

      ungroupLayers: (groupId) => {
        set((state) => {
          if (state.project && state.selectedArtboardId) {
            const group = state.project.layers[groupId] as GroupLayer;
            if (group && group.type === 'group') {
              const artboard = state.project.artboards.find((a) => a.id === state.selectedArtboardId);
              if (artboard) {
                const groupIndex = artboard.layerIds.indexOf(groupId);
                const { x: groupX, y: groupY } = group.transform;
                group.childIds.forEach((childId) => {
                  const child = state.project!.layers[childId];
                  if (child) {
                    child.transform.x += groupX;
                    child.transform.y += groupY;
                    child.parentId = null;
                  }
                });
                artboard.layerIds.splice(groupIndex, 1, ...group.childIds);
                delete state.project.layers[groupId];
                state.selectedLayerIds = group.childIds;
                state.project.updatedAt = Date.now();
                state.isDirty = true;
              }
            }
          }
        });
      },

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
        if (copiedStyle && selectedLayerIds.length > 0) {
          set((state) => {
            if (state.project) {
              selectedLayerIds.forEach((layerId) => {
                const layer = state.project!.layers[layerId];
                if (layer) {
                  layer.blendMode = copiedStyle.blendMode ? JSON.parse(JSON.stringify(copiedStyle.blendMode)) : DEFAULT_BLEND_MODE;
                  layer.shadow = copiedStyle.shadow ? JSON.parse(JSON.stringify(copiedStyle.shadow)) : DEFAULT_SHADOW;
                  layer.innerShadow = copiedStyle.innerShadow ? JSON.parse(JSON.stringify(copiedStyle.innerShadow)) : DEFAULT_INNER_SHADOW;
                  layer.stroke = copiedStyle.stroke ? JSON.parse(JSON.stringify(copiedStyle.stroke)) : DEFAULT_STROKE;
                  layer.glow = copiedStyle.glow ? JSON.parse(JSON.stringify(copiedStyle.glow)) : DEFAULT_GLOW;
                  layer.filters = copiedStyle.filters ? JSON.parse(JSON.stringify(copiedStyle.filters)) : DEFAULT_FILTER;
                }
              });
              state.project.updatedAt = Date.now();
              state.isDirty = true;
            }
          });
        }
      },

      markDirty: () => set({ isDirty: true }),
      markClean: () => set({ isDirty: false }),
    }))
  )
);
