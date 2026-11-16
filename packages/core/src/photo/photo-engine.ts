import { generateId } from "../utils";
import type {
  PhotoLayer,
  PhotoProject,
  PhotoBlendMode,
  LayerTransform,
  CreateLayerOptions,
  ReorderResult,
  CompositeOptions,
} from "./types";
import {
  DEFAULT_LAYER_TRANSFORM,
  DEFAULT_BLEND_MODE,
  DEFAULT_LAYER_OPACITY,
} from "./types";

interface PhotoEngineConfig {
  width?: number;
  height?: number;
}

export class PhotoEngine {
  private defaultWidth: number;
  private defaultHeight: number;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(config: PhotoEngineConfig = {}) {
    this.defaultWidth = config.width ?? 1920;
    this.defaultHeight = config.height ?? 1080;
  }

  createProject(
    width: number = this.defaultWidth,
    height: number = this.defaultHeight,
    name: string = "Untitled",
  ): PhotoProject {
    return {
      id: generateId(),
      name,
      width,
      height,
      layers: [],
      selectedLayerIndex: -1,
      backgroundColor: "#ffffff",
    };
  }

  importPhoto(
    project: PhotoProject,
    image: ImageBitmap,
    name: string = "Background",
  ): PhotoProject {
    const baseLayer = this.createLayer({
      name,
      type: "image",
      content: image,
    });

    return {
      ...project,
      width: image.width,
      height: image.height,
      layers: [baseLayer],
      selectedLayerIndex: 0,
    };
  }

  createLayer(options: CreateLayerOptions = {}): PhotoLayer {
    return {
      id: generateId(),
      name: options.name ?? "Layer",
      type: options.type ?? "image",
      content: options.content ?? null,
      opacity: options.opacity ?? DEFAULT_LAYER_OPACITY,
      blendMode: options.blendMode ?? DEFAULT_BLEND_MODE,
      visible: true,
      locked: false,
      mask: null,
      adjustments: [],
      transform: { ...DEFAULT_LAYER_TRANSFORM },
    };
  }

  addLayer(
    project: PhotoProject,
    options: CreateLayerOptions = {},
  ): PhotoProject {
    const newLayer = this.createLayer(options);
    const layers = [...project.layers];
    const insertIndex = options.insertAt ?? project.selectedLayerIndex + 1;
    const clampedIndex = Math.max(0, Math.min(insertIndex, layers.length));

    layers.splice(clampedIndex, 0, newLayer);

    return {
      ...project,
      layers,
      selectedLayerIndex: clampedIndex,
    };
  }

  removeLayer(project: PhotoProject, layerId: string): PhotoProject {
    const layerIndex = project.layers.findIndex((l) => l.id === layerId);
    if (layerIndex === -1) {
      return project;
    }

    const layers = project.layers.filter((l) => l.id !== layerId);
    let selectedLayerIndex = project.selectedLayerIndex;

    // Adjust selection if needed
    if (selectedLayerIndex >= layers.length) {
      selectedLayerIndex = Math.max(0, layers.length - 1);
    } else if (selectedLayerIndex > layerIndex) {
      selectedLayerIndex--;
    }

    return {
      ...project,
      layers,
      selectedLayerIndex: layers.length > 0 ? selectedLayerIndex : -1,
    };
  }

  reorderLayers(
    project: PhotoProject,
    fromIndex: number,
    toIndex: number,
  ): ReorderResult {
    if (
      fromIndex < 0 ||
      fromIndex >= project.layers.length ||
      toIndex < 0 ||
      toIndex >= project.layers.length
    ) {
      return {
        success: false,
        layers: project.layers,
        error: "Invalid layer index",
      };
    }

    if (fromIndex === toIndex) {
      return {
        success: true,
        layers: project.layers,
      };
    }
    const layers = [...project.layers];
    const [removed] = layers.splice(fromIndex, 1);
    layers.splice(toIndex, 0, removed);

    return {
      success: true,
      layers,
    };
  }

  setLayerOpacity(
    project: PhotoProject,
    layerId: string,
    opacity: number,
  ): PhotoProject {
    const clampedOpacity = Math.max(0, Math.min(1, opacity));

    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, opacity: clampedOpacity } : layer,
      ),
    };
  }

  setLayerVisibility(
    project: PhotoProject,
    layerId: string,
    visible?: boolean,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId
          ? { ...layer, visible: visible ?? !layer.visible }
          : layer,
      ),
    };
  }

  setLayerBlendMode(
    project: PhotoProject,
    layerId: string,
    blendMode: PhotoBlendMode,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, blendMode } : layer,
      ),
    };
  }

  setLayerTransform(
    project: PhotoProject,
    layerId: string,
    transform: Partial<LayerTransform>,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId
          ? { ...layer, transform: { ...layer.transform, ...transform } }
          : layer,
      ),
    };
  }

  setLayerLocked(
    project: PhotoProject,
    layerId: string,
    locked: boolean,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, locked } : layer,
      ),
    };
  }

  renameLayer(
    project: PhotoProject,
    layerId: string,
    name: string,
  ): PhotoProject {
    return {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, name } : layer,
      ),
    };
  }

  duplicateLayer(project: PhotoProject, layerId: string): PhotoProject {
    const sourceLayer = project.layers.find((l) => l.id === layerId);
    if (!sourceLayer) {
      return project;
    }

    const sourceIndex = project.layers.findIndex((l) => l.id === layerId);
    const duplicatedLayer: PhotoLayer = {
      ...sourceLayer,
      id: generateId(),
      name: `${sourceLayer.name} Copy`,
    };

    const layers = [...project.layers];
    layers.splice(sourceIndex + 1, 0, duplicatedLayer);

    return {
      ...project,
      layers,
      selectedLayerIndex: sourceIndex + 1,
    };
  }

  selectLayer(project: PhotoProject, layerId: string): PhotoProject {
    const index = project.layers.findIndex((l) => l.id === layerId);
    if (index === -1) {
      return project;
    }

    return {
      ...project,
      selectedLayerIndex: index,
    };
  }

  getSelectedLayer(project: PhotoProject): PhotoLayer | null {
    if (
      project.selectedLayerIndex < 0 ||
      project.selectedLayerIndex >= project.layers.length
    ) {
      return null;
    }
    return project.layers[project.selectedLayerIndex];
  }

  getLayer(project: PhotoProject, layerId: string): PhotoLayer | null {
    return project.layers.find((l) => l.id === layerId) ?? null;
  }

  async renderComposite(
    project: PhotoProject,
    options: CompositeOptions = {},
  ): Promise<ImageBitmap> {
    const width = options.width ?? project.width;
    const height = options.height ?? project.height;
    const includeHidden = options.includeHidden ?? false;
    const backgroundColor = options.backgroundColor ?? project.backgroundColor;
    if (
      !this.canvas ||
      this.canvas.width !== width ||
      this.canvas.height !== height
    ) {
      this.canvas = new OffscreenCanvas(width, height);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }

    const ctx = this.ctx!;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    for (const layer of project.layers) {
      // Skip hidden layers unless includeHidden is true
      if (!layer.visible && !includeHidden) {
        continue;
      }

      // Skip layers without content
      if (!layer.content && layer.type === "image") {
        continue;
      }
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = this.getCanvasBlendMode(layer.blendMode);
      if (layer.content) {
        ctx.save();
        this.applyLayerTransform(ctx, layer, width, height);
        ctx.drawImage(layer.content, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    return createImageBitmap(this.canvas);
  }

  private applyLayerTransform(
    ctx: OffscreenCanvasRenderingContext2D,
    layer: PhotoLayer,
    _canvasWidth: number,
    _canvasHeight: number,
  ): void {
    const { transform, content } = layer;
    if (!content) return;

    const contentWidth = content.width;
    const contentHeight = content.height;
    const anchorX = contentWidth * transform.anchorX;
    const anchorY = contentHeight * transform.anchorY;
    ctx.translate(transform.x + anchorX, transform.y + anchorY);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-anchorX, -anchorY);
  }

  private getCanvasBlendMode(
    blendMode: PhotoBlendMode,
  ): GlobalCompositeOperation {
    const blendModeMap: Record<PhotoBlendMode, GlobalCompositeOperation> = {
      normal: "source-over",
      multiply: "multiply",
      screen: "screen",
      overlay: "overlay",
      softLight: "soft-light",
      hardLight: "hard-light",
      colorDodge: "color-dodge",
      colorBurn: "color-burn",
      difference: "difference",
      exclusion: "exclusion",
      hue: "hue",
      saturation: "saturation",
      color: "color",
      luminosity: "luminosity",
    };

    return blendModeMap[blendMode] ?? "source-over";
  }

  async flattenLayers(project: PhotoProject): Promise<PhotoProject> {
    if (project.layers.length === 0) {
      return project;
    }

    const composite = await this.renderComposite(project);
    const flattenedLayer = this.createLayer({
      name: "Flattened",
      type: "image",
      content: composite,
    });

    return {
      ...project,
      layers: [flattenedLayer],
      selectedLayerIndex: 0,
    };
  }

  async mergeLayerDown(
    project: PhotoProject,
    layerId: string,
  ): Promise<PhotoProject> {
    const layerIndex = project.layers.findIndex((l) => l.id === layerId);
    if (layerIndex <= 0) {
      // Can't merge the bottom layer or if layer not found
      return project;
    }

    const topLayer = project.layers[layerIndex];
    const bottomLayer = project.layers[layerIndex - 1];
    const tempProject: PhotoProject = {
      ...project,
      layers: [bottomLayer, topLayer],
      backgroundColor: "transparent",
    };
    const mergedContent = await this.renderComposite(tempProject);
    const mergedLayer: PhotoLayer = {
      ...bottomLayer,
      content: mergedContent,
      name: bottomLayer.name,
    };
    const layers = [...project.layers];
    layers.splice(layerIndex - 1, 2, mergedLayer);

    return {
      ...project,
      layers,
      selectedLayerIndex: Math.min(
        project.selectedLayerIndex,
        layers.length - 1,
      ),
    };
  }

  canModifyLayer(project: PhotoProject, layerId: string): boolean {
    const layer = this.getLayer(project, layerId);
    return layer !== null && !layer.locked;
  }

  getVisibleLayers(project: PhotoProject): PhotoLayer[] {
    return project.layers.filter((l) => l.visible);
  }

  getLayerCount(project: PhotoProject): number {
    return project.layers.length;
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}
let photoEngineInstance: PhotoEngine | null = null;

export function getPhotoEngine(): PhotoEngine {
  if (!photoEngineInstance) {
    photoEngineInstance = new PhotoEngine();
  }
  return photoEngineInstance;
}
