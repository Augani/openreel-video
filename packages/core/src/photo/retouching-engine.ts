import type { BrushStroke, BrushPoint, CloneSource } from "./types";

interface BrushConfig {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
}

const DEFAULT_BRUSH_CONFIG: BrushConfig = {
  size: 20,
  hardness: 0.5,
  opacity: 1,
  flow: 1,
  spacing: 0.25,
};

export class RetouchingEngine {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private brushConfig: BrushConfig = { ...DEFAULT_BRUSH_CONFIG };
  private cloneSource: CloneSource | null = null;

  setBrushConfig(config: Partial<BrushConfig>): void {
    this.brushConfig = { ...this.brushConfig, ...config };
  }

  getBrushConfig(): BrushConfig {
    return { ...this.brushConfig };
  }

  setBrushSize(size: number): void {
    this.brushConfig.size = Math.max(1, Math.min(500, size));
  }

  setBrushHardness(hardness: number): void {
    this.brushConfig.hardness = Math.max(0, Math.min(1, hardness));
  }

  setCloneSource(x: number, y: number, layerId: string | null = null): void {
    this.cloneSource = { x, y, layerId };
  }

  getCloneSource(): CloneSource | null {
    return this.cloneSource ? { ...this.cloneSource } : null;
  }

  async spotHeal(
    image: ImageBitmap,
    x: number,
    y: number,
    radius?: number,
  ): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);
    const healRadius = radius ?? this.brushConfig.size / 2;

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Sample surrounding pixels
    const sampleRadius = healRadius * 1.5;
    const samples: { r: number; g: number; b: number; weight: number }[] = [];

    // Collect samples from surrounding ring
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const sampleX = Math.round(x + Math.cos(angle) * sampleRadius);
      const sampleY = Math.round(y + Math.sin(angle) * sampleRadius);

      if (
        sampleX >= 0 &&
        sampleX < canvas.width &&
        sampleY >= 0 &&
        sampleY < canvas.height
      ) {
        const idx = (sampleY * canvas.width + sampleX) * 4;
        samples.push({
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2],
          weight: 1,
        });
      }
    }

    if (samples.length === 0) {
      return createImageBitmap(canvas);
    }
    let totalWeight = 0;
    let avgR = 0,
      avgG = 0,
      avgB = 0;
    for (const sample of samples) {
      avgR += sample.r * sample.weight;
      avgG += sample.g * sample.weight;
      avgB += sample.b * sample.weight;
      totalWeight += sample.weight;
    }
    avgR /= totalWeight;
    avgG /= totalWeight;
    avgB /= totalWeight;
    const radiusSq = healRadius * healRadius;
    const hardness = this.brushConfig.hardness;

    for (
      let py = Math.max(0, Math.floor(y - healRadius));
      py < Math.min(canvas.height, Math.ceil(y + healRadius));
      py++
    ) {
      for (
        let px = Math.max(0, Math.floor(x - healRadius));
        px < Math.min(canvas.width, Math.ceil(x + healRadius));
        px++
      ) {
        const dx = px - x;
        const dy = py - y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= radiusSq) {
          const dist = Math.sqrt(distSq);
          const normalizedDist = dist / healRadius;
          let alpha: number;
          if (normalizedDist <= hardness) {
            alpha = 1;
          } else {
            alpha = 1 - (normalizedDist - hardness) / (1 - hardness);
          }
          alpha *= this.brushConfig.opacity;

          const idx = (py * canvas.width + px) * 4;

          // Blend with surrounding average
          data[idx] = Math.round(data[idx] * (1 - alpha) + avgR * alpha);
          data[idx + 1] = Math.round(
            data[idx + 1] * (1 - alpha) + avgG * alpha,
          );
          data[idx + 2] = Math.round(
            data[idx + 2] * (1 - alpha) + avgB * alpha,
          );
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async spotHealStroke(
    image: ImageBitmap,
    stroke: BrushStroke,
  ): Promise<ImageBitmap> {
    let result = image;

    for (const point of stroke.points) {
      const radius = (stroke.size / 2) * point.pressure;
      result = await this.spotHeal(result, point.x, point.y, radius);
    }

    return result;
  }

  async cloneStamp(
    image: ImageBitmap,
    targetX: number,
    targetY: number,
    radius?: number,
  ): Promise<ImageBitmap> {
    if (!this.cloneSource) {
      return createImageBitmap(image);
    }

    const { ctx, canvas } = this.getCanvas(image.width, image.height);
    const cloneRadius = radius ?? this.brushConfig.size / 2;

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const sourceX = this.cloneSource.x;
    const sourceY = this.cloneSource.y;
    const radiusSq = cloneRadius * cloneRadius;
    const hardness = this.brushConfig.hardness;

    // Copy pixels from source to target
    for (
      let py = Math.max(0, Math.floor(targetY - cloneRadius));
      py < Math.min(canvas.height, Math.ceil(targetY + cloneRadius));
      py++
    ) {
      for (
        let px = Math.max(0, Math.floor(targetX - cloneRadius));
        px < Math.min(canvas.width, Math.ceil(targetX + cloneRadius));
        px++
      ) {
        const dx = px - targetX;
        const dy = py - targetY;
        const distSq = dx * dx + dy * dy;

        if (distSq <= radiusSq) {
          const srcX = Math.round(sourceX + dx);
          const srcY = Math.round(sourceY + dy);

          if (
            srcX >= 0 &&
            srcX < canvas.width &&
            srcY >= 0 &&
            srcY < canvas.height
          ) {
            const dist = Math.sqrt(distSq);
            const normalizedDist = dist / cloneRadius;
            let alpha: number;
            if (normalizedDist <= hardness) {
              alpha = 1;
            } else {
              alpha = 1 - (normalizedDist - hardness) / (1 - hardness);
            }
            alpha *= this.brushConfig.opacity;

            const srcIdx = (srcY * canvas.width + srcX) * 4;
            const dstIdx = (py * canvas.width + px) * 4;

            // Blend source pixels to target
            data[dstIdx] = Math.round(
              data[dstIdx] * (1 - alpha) + data[srcIdx] * alpha,
            );
            data[dstIdx + 1] = Math.round(
              data[dstIdx + 1] * (1 - alpha) + data[srcIdx + 1] * alpha,
            );
            data[dstIdx + 2] = Math.round(
              data[dstIdx + 2] * (1 - alpha) + data[srcIdx + 2] * alpha,
            );
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  async cloneStampStroke(
    image: ImageBitmap,
    stroke: BrushStroke,
  ): Promise<ImageBitmap> {
    if (!this.cloneSource) {
      return createImageBitmap(image);
    }

    let result = image;
    const initialSourceX = this.cloneSource.x;
    const initialSourceY = this.cloneSource.y;
    const firstPoint = stroke.points[0];

    for (const point of stroke.points) {
      const offsetX = point.x - firstPoint.x;
      const offsetY = point.y - firstPoint.y;
      this.cloneSource.x = initialSourceX + offsetX;
      this.cloneSource.y = initialSourceY + offsetY;

      const radius = (stroke.size / 2) * point.pressure;
      result = await this.cloneStamp(result, point.x, point.y, radius);
    }
    this.cloneSource.x = initialSourceX;
    this.cloneSource.y = initialSourceY;

    return result;
  }

  async removeRedEye(
    image: ImageBitmap,
    x: number,
    y: number,
    radius: number,
  ): Promise<ImageBitmap> {
    const { ctx, canvas } = this.getCanvas(image.width, image.height);

    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const radiusSq = radius * radius;
    for (
      let py = Math.max(0, Math.floor(y - radius));
      py < Math.min(canvas.height, Math.ceil(y + radius));
      py++
    ) {
      for (
        let px = Math.max(0, Math.floor(x - radius));
        px < Math.min(canvas.width, Math.ceil(x + radius));
        px++
      ) {
        const dx = px - x;
        const dy = py - y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= radiusSq) {
          const idx = (py * canvas.width + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Detect red pixels (high red, low green and blue)
          const isRed = r > 80 && r > g * 1.5 && r > b * 1.5;

          if (isRed) {
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            data[idx] = Math.round(luminance * 0.3);
            data[idx + 1] = Math.round(g * 0.8 + luminance * 0.2);
            data[idx + 2] = Math.round(b * 0.8 + luminance * 0.2);
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return createImageBitmap(canvas);
  }

  createStroke(points: BrushPoint[]): BrushStroke {
    return {
      points,
      size: this.brushConfig.size,
      hardness: this.brushConfig.hardness,
      opacity: this.brushConfig.opacity,
      flow: this.brushConfig.flow,
      spacing: this.brushConfig.spacing,
    };
  }

  generateBrushMask(
    size: number = this.brushConfig.size,
    hardness: number = this.brushConfig.hardness,
  ): OffscreenCanvas {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d")!;

    const radius = size / 2;
    const centerX = radius;
    const centerY = radius;
    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      radius * hardness,
      centerX,
      centerY,
      radius,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
  }

  private getCanvas(
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
    if (
      !this.canvas ||
      this.canvas.width !== width ||
      this.canvas.height !== height
    ) {
      this.canvas = new OffscreenCanvas(width, height);
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    return { canvas: this.canvas, ctx: this.ctx! };
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.cloneSource = null;
  }
}
let retouchingEngineInstance: RetouchingEngine | null = null;

export function getRetouchingEngine(): RetouchingEngine {
  if (!retouchingEngineInstance) {
    retouchingEngineInstance = new RetouchingEngine();
  }
  return retouchingEngineInstance;
}
