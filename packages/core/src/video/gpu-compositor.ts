import type { Effect, Transform } from "../types/timeline";
import type { Renderer, RenderLayer } from "./renderer-factory";
import type { BlendMode } from "./types";

interface GPUCompositeLayer {
  id: string;
  texture: GPUTexture | ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  transform: Transform;
  effects: Effect[];
  opacity: number;
  borderRadius: number;
  blendMode: BlendMode;
  zIndex: number;
  visible: boolean;
}

interface CompositorConfig {
  width: number;
  height: number;
  backgroundColor: [number, number, number, number];
  antialias?: boolean;
}

interface CompositorStats {
  layersComposited: number;
  lastCompositeDuration: number;
  averageCompositeDuration: number;
  texturesCreated: number;
  texturesReleased: number;
}

export class GPUCompositor {
  private renderer: Renderer | null = null;
  private config: CompositorConfig;
  private layers: Map<string, GPUCompositeLayer> = new Map();
  private sortedLayerIds: string[] = [];
  private isDirty = true;

  private stats: CompositorStats = {
    layersComposited: 0,
    lastCompositeDuration: 0,
    averageCompositeDuration: 0,
    texturesCreated: 0,
    texturesReleased: 0,
  };
  private compositeDurations: number[] = [];
  private maxDurationSamples = 60;

  constructor(config: CompositorConfig) {
    this.config = {
      ...config,
      antialias: config.antialias ?? true,
    };
  }

  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
    this.isDirty = true;
  }

  getRenderer(): Renderer | null {
    return this.renderer;
  }

  getDevice(): GPUDevice | null {
    return this.renderer?.getDevice() ?? null;
  }

  setBackgroundColor(color: [number, number, number, number]): void {
    this.config.backgroundColor = color;
    this.isDirty = true;
  }

  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;
    if (this.renderer) {
      this.renderer.resize(width, height);
    }
    this.isDirty = true;
  }

  addLayer(layer: GPUCompositeLayer): void {
    this.layers.set(layer.id, layer);
    this.sortLayers();
    this.isDirty = true;
  }

  updateLayer(layerId: string, updates: Partial<GPUCompositeLayer>): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      Object.assign(layer, updates);
      if (updates.zIndex !== undefined) {
        this.sortLayers();
      }
      this.isDirty = true;
    }
  }

  removeLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      if (this.renderer && layer.texture) {
        this.renderer.releaseTexture(layer.texture as GPUTexture | ImageBitmap);
        this.stats.texturesReleased++;
      }
      this.layers.delete(layerId);
      this.sortLayers();
      this.isDirty = true;
    }
  }

  clearLayers(): void {
    if (this.renderer) {
      for (const layer of this.layers.values()) {
        if (layer.texture) {
          this.renderer.releaseTexture(
            layer.texture as GPUTexture | ImageBitmap,
          );
          this.stats.texturesReleased++;
        }
      }
    }
    this.layers.clear();
    this.sortedLayerIds = [];
    this.isDirty = true;
  }

  getLayer(layerId: string): GPUCompositeLayer | undefined {
    return this.layers.get(layerId);
  }

  getLayers(): GPUCompositeLayer[] {
    return this.sortedLayerIds
      .map((id) => this.layers.get(id)!)
      .filter(Boolean);
  }

  setLayerVisibility(layerId: string, visible: boolean): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.visible = visible;
      this.isDirty = true;
    }
  }

  setLayerOpacity(layerId: string, opacity: number): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.opacity = Math.max(0, Math.min(1, opacity));
      this.isDirty = true;
    }
  }

  setLayerBlendMode(layerId: string, blendMode: BlendMode): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.blendMode = blendMode;
      this.isDirty = true;
    }
  }

  setLayerTransform(layerId: string, transform: Transform): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.transform = transform;
      this.isDirty = true;
    }
  }

  setLayerZIndex(layerId: string, zIndex: number): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.zIndex = zIndex;
      this.sortLayers();
      this.isDirty = true;
    }
  }

  private sortLayers(): void {
    this.sortedLayerIds = Array.from(this.layers.keys()).sort((a, b) => {
      const layerA = this.layers.get(a)!;
      const layerB = this.layers.get(b)!;
      return layerA.zIndex - layerB.zIndex;
    });
  }

  async createTextureFromCanvas(
    canvas: HTMLCanvasElement | OffscreenCanvas,
  ): Promise<GPUTexture | ImageBitmap> {
    if (!this.renderer) {
      throw new Error("Renderer not set");
    }

    const bitmap = await createImageBitmap(canvas);
    const texture = this.renderer.createTextureFromImage(bitmap);
    this.stats.texturesCreated++;

    if (texture !== bitmap) {
      bitmap.close();
    }

    return texture;
  }

  async createTextureFromBitmap(
    bitmap: ImageBitmap,
  ): Promise<GPUTexture | ImageBitmap> {
    if (!this.renderer) {
      throw new Error("Renderer not set");
    }

    const texture = this.renderer.createTextureFromImage(bitmap);
    this.stats.texturesCreated++;
    return texture;
  }

  async composite(): Promise<ImageBitmap> {
    if (!this.renderer) {
      throw new Error("Renderer not set");
    }

    const startTime = performance.now();

    this.renderer.beginFrame();

    let layersComposited = 0;

    for (const layerId of this.sortedLayerIds) {
      const layer = this.layers.get(layerId);
      if (!layer || !layer.visible) continue;

      let texture: GPUTexture | ImageBitmap = layer.texture as
        | GPUTexture
        | ImageBitmap;

      if (layer.texture instanceof ImageBitmap) {
        texture = this.renderer.createTextureFromImage(layer.texture);
      } else if (
        layer.texture instanceof HTMLCanvasElement ||
        layer.texture instanceof OffscreenCanvas
      ) {
        const bitmap = await createImageBitmap(layer.texture);
        texture = this.renderer.createTextureFromImage(bitmap);
        if (texture !== bitmap) {
          bitmap.close();
        }
      }

      // The blend mode needs the backdrop: the renderer composites the layer in its own pass (RenderLayer.blendMode).
      const effectsToApply = [...layer.effects];
      if (effectsToApply.length > 0) {
        texture = this.renderer.applyEffects(texture, effectsToApply);
      }

      const renderLayer: RenderLayer = {
        texture,
        transform: layer.transform,
        effects: [],
        blendMode: layer.blendMode,
        opacity: layer.opacity,
        borderRadius: layer.borderRadius,
      };

      this.renderer.renderLayer(renderLayer);
      layersComposited++;
    }

    const result = await this.renderer.endFrame();

    const duration = performance.now() - startTime;
    this.recordCompositeDuration(duration);
    this.stats.layersComposited = layersComposited;
    this.isDirty = false;

    return result;
  }

  async compositeToCanvas(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ): Promise<void> {
    const bitmap = await this.composite();
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  private recordCompositeDuration(duration: number): void {
    this.stats.lastCompositeDuration = duration;
    this.compositeDurations.push(duration);

    if (this.compositeDurations.length > this.maxDurationSamples) {
      this.compositeDurations.shift();
    }

    const sum = this.compositeDurations.reduce((a, b) => a + b, 0);
    this.stats.averageCompositeDuration = sum / this.compositeDurations.length;
  }

  isDirtyFrame(): boolean {
    return this.isDirty;
  }

  markDirty(): void {
    this.isDirty = true;
  }

  getStats(): CompositorStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      layersComposited: 0,
      lastCompositeDuration: 0,
      averageCompositeDuration: 0,
      texturesCreated: 0,
      texturesReleased: 0,
    };
    this.compositeDurations = [];
  }

  dispose(): void {
    this.clearLayers();
    this.renderer = null;
  }
}

let gpuCompositorInstance: GPUCompositor | null = null;

export function initializeGPUCompositor(
  config: CompositorConfig,
): GPUCompositor {
  if (gpuCompositorInstance) {
    gpuCompositorInstance.dispose();
  }
  gpuCompositorInstance = new GPUCompositor(config);
  return gpuCompositorInstance;
}
