import type { Effect } from "../types/timeline";
import type { Renderer, RendererConfig, RenderLayer } from "./renderer-factory";
import { VideoEffectsEngine } from "./video-effects-engine";
import type { BlendMode } from "./types";
import {
  drawImageWithBlend,
  getNativeCanvasBlendOperation,
  isBlendMode,
  needsCpuBlend,
} from "./blend-reference";

export class Canvas2DFallbackRenderer implements Renderer {
  readonly type = "canvas2d" as const;

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private width: number;
  private height: number;
  private deviceLostCallbacks: Array<() => void> = [];
  private layers: RenderLayer[] = [];
  private pendingEffects = new WeakMap<ImageBitmap, Effect[]>();
  // Shared pixel path: Glow, Vignette, Sharpen, Film grain, opaque-frame Drop
  // Shadow and the pro effects live in VideoEffectsEngine, so the fallback
  // reuses it instead of a CSS-filter subset that silently dropped them.
  // Never initialize()d: applyEffectsToCanvas needs no renderer of its own.
  private effectsEngine: VideoEffectsEngine | null = null;

  constructor(config: RendererConfig) {
    this.width = config.width;
    this.height = config.height;
    this.canvas = new OffscreenCanvas(config.width, config.height);
  }

  async initialize(): Promise<boolean> {
    try {
      this.ctx = this.canvas.getContext("2d");
      return this.ctx !== null;
    } catch {
      return false;
    }
  }

  isSupported(): boolean {
    return true; // Canvas 2D is always supported
  }

  destroy(): void {
    this.ctx = null;
    this.deviceLostCallbacks = [];
    this.layers = [];
    this.effectsEngine?.dispose();
    this.effectsEngine = null;
  }

  beginFrame(): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.layers = [];
  }

  renderLayer(layer: RenderLayer): void {
    this.layers.push(layer);
  }

  async endFrame(): Promise<ImageBitmap> {
    if (!this.ctx) {
      throw new Error("Canvas2D context not initialized");
    }
    for (const layer of this.layers) {
      await this.renderLayerToCanvas(layer);
    }

    return createImageBitmap(this.canvas);
  }

  private async renderLayerToCanvas(layer: RenderLayer): Promise<void> {
    if (!this.ctx) return;

    const ctx = this.ctx;
    const { transform, opacity, borderRadius } = layer;
    let image: ImageBitmap;
    if (layer.texture instanceof ImageBitmap) {
      image = layer.texture;
    } else {
      // For GPU textures, we can't render them directly
      // This is a limitation of the Canvas2D fallback
      return;
    }

    const effects = this.pendingEffects.get(image) ?? layer.effects;
    const blendMode = resolveBlendMode(effects);
    const cpuBlend = needsCpuBlend(blendMode);
    // Modes with no Canvas2D op: draw the layer alone, then blend per pixel.
    const scratch = cpuBlend ? new OffscreenCanvas(this.width, this.height) : null;
    const target = (scratch?.getContext("2d") ?? ctx) as OffscreenCanvasRenderingContext2D;
    target.save();
    target.globalAlpha = cpuBlend ? 1 : opacity * transform.opacity;
    target.globalCompositeOperation = cpuBlend
      ? "source-over"
      : (getNativeCanvasBlendOperation(blendMode) ?? "source-over");
    let source: ImageBitmap | OffscreenCanvas = image;
    const processable = effects.filter(
      (effect) => effect.enabled && effect.type !== "blend",
    );
    if (processable.length > 0) {
      try {
        this.effectsEngine ??= new VideoEffectsEngine({
          width: image.width,
          height: image.height,
          useGPU: true,
          preferWebGPU: false,
        });
        const processed = await this.effectsEngine.applyEffectsToCanvas(
          image,
          processable,
        );
        if (processed) source = processed;
      } catch (error) {
        console.warn("[Canvas2DFallbackRenderer] effects failed:", error);
        target.filter = buildCanvasFilter(processable);
      }
    }

    // Translate to position
    const centerX = this.width / 2 + transform.position.x;
    const centerY = this.height / 2 + transform.position.y;
    target.translate(centerX, centerY);
    target.rotate((transform.rotation * Math.PI) / 180);
    target.scale(transform.scale.x, transform.scale.y);
    const drawX = -image.width * transform.anchor.x;
    const drawY = -image.height * transform.anchor.y;
    if (borderRadius > 0) {
      target.beginPath();
      this.roundRect(
        target,
        drawX,
        drawY,
        image.width,
        image.height,
        borderRadius,
      );
      target.clip();
    }

    // Draw the image
    target.drawImage(source, drawX, drawY);

    target.restore();
    if (scratch) {
      ctx.save();
      ctx.globalAlpha = opacity * transform.opacity;
      drawImageWithBlend(ctx, scratch, blendMode);
      ctx.restore();
    }
  }

  private roundRect(
    ctx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  createTextureFromImage(image: ImageBitmap): ImageBitmap {
    // Canvas2D doesn't use GPU textures, just return the image
    return image;
  }

  releaseTexture(_texture: GPUTexture | ImageBitmap): void {
    // No-op for Canvas2D
  }

  applyEffects(
    texture: GPUTexture | ImageBitmap,
    effects: Effect[],
  ): GPUTexture | ImageBitmap {
    if (texture instanceof ImageBitmap) {
      this.pendingEffects.set(
        texture,
        effects.filter((effect) => effect.enabled),
      );
    }
    return texture;
  }

  onDeviceLost(callback: () => void): void {
    this.deviceLostCallbacks.push(callback);
  }

  async recreateDevice(): Promise<boolean> {
    // Canvas2D doesn't have device loss
    return true;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  getMemoryUsage(): number {
    return this.width * this.height * 4;
  }

  getDevice(): GPUDevice | null {
    return null;
  }
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildCanvasFilter(effects: readonly Effect[]): string {
  const filters: string[] = [];
  for (const effect of effects) {
    if (!effect.enabled) continue;
    const params = effect.params;
    switch (effect.type) {
      case "brightness":
        filters.push(`brightness(${1 + readNumber(params.value, 0) / 100})`);
        break;
      case "contrast":
        filters.push(`contrast(${readNumber(params.value, 1)})`);
        break;
      case "saturation":
        filters.push(`saturate(${readNumber(params.value, 1)})`);
        break;
      case "grayscale":
        filters.push(`grayscale(${readNumber(params.amount, 1)})`);
        break;
      case "sepia":
        filters.push(`sepia(${readNumber(params.amount, 1)})`);
        break;
      case "invert":
        filters.push(`invert(${readNumber(params.amount, 1)})`);
        break;
      case "hue":
        filters.push(`hue-rotate(${readNumber(params.rotation, 0)}deg)`);
        break;
      case "blur":
        filters.push(`blur(${Math.max(0, readNumber(params.radius, 0))}px)`);
        break;
      case "shadow":
        filters.push(
          `drop-shadow(${readNumber(params.offsetX, 0)}px ${readNumber(params.offsetY, 0)}px ${Math.max(0, readNumber(params.blur, 0))}px ${typeof params.color === "string" ? params.color : "#000000"})`,
        );
        break;
    }
  }
  return filters.length > 0 ? filters.join(" ") : "none";
}

function resolveBlendMode(effects: readonly Effect[]): BlendMode {
  const blend = effects.find((effect) => effect.enabled && effect.type === "blend");
  const mode = blend?.params.mode;
  return isBlendMode(mode) ? mode : "normal";
}
