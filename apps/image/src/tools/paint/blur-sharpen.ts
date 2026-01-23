import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from '../brush/brush-engine';

export type BlurSharpenMode = 'blur' | 'sharpen';

export interface BlurSharpenSettings extends Omit<BrushSettings, 'color'> {
  mode: BlurSharpenMode;
  strength: number;
  sampleAllLayers: boolean;
}

export const DEFAULT_BLUR_SHARPEN_SETTINGS: BlurSharpenSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  size: 30,
  hardness: 50,
  mode: 'blur',
  strength: 0.5,
  sampleAllLayers: false,
};

export interface BlurSharpenStroke {
  points: Array<{
    x: number;
    y: number;
    pressure: number;
  }>;
  settings: BlurSharpenSettings;
}

export class BlurSharpenTool {
  private settings: BlurSharpenSettings;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private isActive: boolean = false;
  private currentStroke: BlurSharpenStroke | null = null;

  constructor(settings: Partial<BlurSharpenSettings> = {}) {
    this.settings = { ...DEFAULT_BLUR_SHARPEN_SETTINGS, ...settings };
  }

  setCanvas(canvas: OffscreenCanvas): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  startStroke(x: number, y: number, pressure: number = 1): void {
    this.isActive = true;
    this.currentStroke = {
      points: [{ x, y, pressure }],
      settings: { ...this.settings },
    };
  }

  continueStroke(x: number, y: number, pressure: number = 1): void {
    if (!this.isActive || !this.currentStroke) return;
    this.currentStroke.points.push({ x, y, pressure });
  }

  endStroke(): BlurSharpenStroke | null {
    this.isActive = false;
    const stroke = this.currentStroke;
    this.currentStroke = null;
    return stroke;
  }

  apply(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1
  ): void {
    if (!this.canvas || !this.ctx) return;

    const size = Math.ceil(this.settings.size);
    const halfSize = size / 2;

    const targetX = Math.floor(x - halfSize);
    const targetY = Math.floor(y - halfSize);

    if (
      targetX < 0 ||
      targetY < 0 ||
      targetX + size > this.canvas.width ||
      targetY + size > this.canvas.height
    ) {
      return;
    }

    const imageData = this.ctx.getImageData(targetX, targetY, size, size);
    const processedData = this.settings.mode === 'blur'
      ? this.applyBlur(imageData, pressure)
      : this.applySharpen(imageData, pressure);

    this.applyBrushMask(processedData, size, this.settings.hardness);

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(processedData, 0, 0);

    outputCtx.save();
    outputCtx.globalAlpha = this.settings.opacity;
    outputCtx.drawImage(tempCanvas, targetX, targetY);
    outputCtx.restore();
  }

  private applyBlur(imageData: ImageData, pressure: number): ImageData {
    const { width, height, data } = imageData;
    const result = new ImageData(new Uint8ClampedArray(data), width, height);
    const strength = this.settings.strength * pressure;
    const kernelSize = Math.max(3, Math.floor(strength * 7));
    const halfKernel = Math.floor(kernelSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, count = 0;

        for (let ky = -halfKernel; ky <= halfKernel; ky++) {
          for (let kx = -halfKernel; kx <= halfKernel; kx++) {
            const px = x + kx;
            const py = y + ky;

            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              r += data[idx];
              g += data[idx + 1];
              b += data[idx + 2];
              count++;
            }
          }
        }

        const idx = (y * width + x) * 4;
        const blend = strength;
        result.data[idx] = Math.round(data[idx] * (1 - blend) + (r / count) * blend);
        result.data[idx + 1] = Math.round(data[idx + 1] * (1 - blend) + (g / count) * blend);
        result.data[idx + 2] = Math.round(data[idx + 2] * (1 - blend) + (b / count) * blend);
        result.data[idx + 3] = data[idx + 3];
      }
    }

    return result;
  }

  private applySharpen(imageData: ImageData, pressure: number): ImageData {
    const { width, height, data } = imageData;
    const result = new ImageData(new Uint8ClampedArray(data), width, height);
    const strength = this.settings.strength * pressure * 2;

    const kernel = [
      0, -1, 0,
      -1, 5, -1,
      0, -1, 0,
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let r = 0, g = 0, b = 0;

        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = x + kx;
            const py = y + ky;
            const idx = (py * width + px) * 4;
            const ki = (ky + 1) * 3 + (kx + 1);
            r += data[idx] * kernel[ki];
            g += data[idx + 1] * kernel[ki];
            b += data[idx + 2] * kernel[ki];
          }
        }

        const idx = (y * width + x) * 4;
        result.data[idx] = Math.round(
          data[idx] * (1 - strength) + Math.max(0, Math.min(255, r)) * strength
        );
        result.data[idx + 1] = Math.round(
          data[idx + 1] * (1 - strength) + Math.max(0, Math.min(255, g)) * strength
        );
        result.data[idx + 2] = Math.round(
          data[idx + 2] * (1 - strength) + Math.max(0, Math.min(255, b)) * strength
        );
        result.data[idx + 3] = data[idx + 3];
      }
    }

    return result;
  }

  private applyBrushMask(imageData: ImageData, size: number, hardness: number): void {
    const data = imageData.data;
    const center = size / 2;
    const radius = size / 2;
    const hardnessNorm = hardness / 100;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = distance / radius;

        let alpha = 1;
        if (normalizedDist > hardnessNorm) {
          alpha = 1 - (normalizedDist - hardnessNorm) / (1 - hardnessNorm);
          alpha = Math.max(0, Math.min(1, alpha));
        }
        if (normalizedDist > 1) {
          alpha = 0;
        }

        const idx = (y * size + x) * 4;
        data[idx + 3] = Math.round(data[idx + 3] * alpha);
      }
    }
  }

  applyStroke(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: BlurSharpenStroke
  ): void {
    const { points, settings } = stroke;
    if (points.length < 1) return;

    const originalSettings = { ...this.settings };
    this.settings = { ...settings };

    const spacingPx = Math.max(1, (settings.size * settings.spacing) / 100);

    for (let i = 0; i < points.length; i++) {
      const point = points[i];

      if (i > 0) {
        const prev = points[i - 1];
        const dx = point.x - prev.x;
        const dy = point.y - prev.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.ceil(distance / spacingPx);

        for (let step = 0; step < steps; step++) {
          const t = step / steps;
          const interpX = prev.x + dx * t;
          const interpY = prev.y + dy * t;
          const interpPressure = prev.pressure + (point.pressure - prev.pressure) * t;

          this.apply(outputCtx, interpX, interpY, interpPressure);
        }
      }

      this.apply(outputCtx, point.x, point.y, point.pressure);
    }

    this.settings = originalSettings;
  }

  getSettings(): BlurSharpenSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<BlurSharpenSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  isActiveStroke(): boolean {
    return this.isActive;
  }
}
