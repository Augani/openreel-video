import type { Effect, Transform } from "../types/timeline";

export type RendererType = "webgpu" | "canvas2d";

export interface RendererConfig {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  maxTextureCache?: number;
  preferredRenderer?: RendererType;
}

export interface RenderLayer {
  texture: GPUTexture | ImageBitmap;
  transform: Transform;
  effects: Effect[];
  opacity: number;
  borderRadius: number;
  /** Sequence pixel aspect ratio the layer transform is laid out in (display space, then squeezed). Default 1. */
  pixelAspect?: number;
}

export interface Renderer {
  readonly type: RendererType;
  initialize(): Promise<boolean>;
  isSupported(): boolean;
  destroy(): void;
  beginFrame(): void;
  renderLayer(layer: RenderLayer): void;
  endFrame(): Promise<ImageBitmap>;
  createTextureFromImage(image: ImageBitmap): GPUTexture | ImageBitmap;
  releaseTexture(texture: GPUTexture | ImageBitmap): void;
  applyEffects(
    texture: GPUTexture | ImageBitmap,
    effects: Effect[],
  ): GPUTexture | ImageBitmap;
  onDeviceLost(callback: () => void): void;
  recreateDevice(): Promise<boolean>;
  resize(width: number, height: number): void;
  getMemoryUsage(): number;
  getDevice(): GPUDevice | null;
}

export function isWebGPUSupported(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return "gpu" in navigator && navigator.gpu !== undefined;
}

function getBestRendererType(preferred?: RendererType): RendererType {
  if (preferred === "canvas2d") {
    return "canvas2d";
  }

  if (isWebGPUSupported()) {
    return "webgpu";
  }

  return "canvas2d";
}

export class RendererFactory {
  private static instance: RendererFactory | null = null;
  private currentRenderer: Renderer | null = null;
  private config: RendererConfig | null = null;
  private creationRevision = 0;

  private constructor() {}

  static getInstance(): RendererFactory {
    if (!RendererFactory.instance) {
      RendererFactory.instance = new RendererFactory();
    }
    return RendererFactory.instance;
  }

  isWebGPUSupported(): boolean {
    return isWebGPUSupported();
  }

  getRendererType(preferred?: RendererType): RendererType {
    return getBestRendererType(preferred);
  }

  async createRenderer(config: RendererConfig): Promise<Renderer> {
    const revision = ++this.creationRevision;
    this.config = config;

    // Try WebGPU first
    if (getBestRendererType(config.preferredRenderer) === "webgpu") {
      let attempted: Renderer | null = null;
      try {
        const { WebGPURenderer } = await import("./webgpu-renderer-impl");
        const renderer = new WebGPURenderer(config);
        attempted = renderer;
        const initialized = await renderer.initialize();

        if (initialized) {
          if (revision === this.creationRevision)
            this.currentRenderer = renderer;

          return renderer;
        }

        renderer.destroy();
        attempted = null;

        console.warn("[RendererFactory] WebGPU init failed, using Canvas2D");
      } catch (error) {
        attempted?.destroy();
        console.warn("[RendererFactory] WebGPU error, using Canvas2D:", error);
      }
    }

    // Fallback to Canvas2D
    const { Canvas2DFallbackRenderer } = await import(
      "./canvas2d-fallback-renderer"
    );
    const renderer = new Canvas2DFallbackRenderer(config);
    await renderer.initialize();
    if (revision === this.creationRevision) this.currentRenderer = renderer;

    return renderer;
  }

  getCurrentRenderer(): Renderer | null {
    return this.currentRenderer;
  }

  destroyRenderer(): void {
    this.creationRevision++;
    if (this.currentRenderer) {
      this.currentRenderer.destroy();
      this.currentRenderer = null;
    }
  }

  async recreateRenderer(): Promise<Renderer | null> {
    if (!this.config) {
      return null;
    }
    this.destroyRenderer();
    return this.createRenderer(this.config);
  }
}

export function getRendererFactory(): RendererFactory {
  return RendererFactory.getInstance();
}
