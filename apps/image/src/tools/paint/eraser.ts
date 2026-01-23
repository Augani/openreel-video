import { BrushSettings, DEFAULT_BRUSH_SETTINGS, BrushEngine } from '../brush/brush-engine';

export type EraserMode = 'brush' | 'pencil' | 'block';

export interface EraserSettings extends BrushSettings {
  mode: EraserMode;
  eraseToHistory: boolean;
  historyStateIndex: number | null;
}

export const DEFAULT_ERASER_SETTINGS: EraserSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  hardness: 100,
  mode: 'brush',
  eraseToHistory: false,
  historyStateIndex: null,
};

export interface EraserStroke {
  points: Array<{
    x: number;
    y: number;
    pressure: number;
  }>;
  settings: EraserSettings;
}

export class EraserTool {
  private settings: EraserSettings;
  private brushEngine: BrushEngine;
  private isErasing: boolean = false;
  private currentStroke: EraserStroke | null = null;
  private historyCanvas: OffscreenCanvas | null = null;

  constructor(settings: Partial<EraserSettings> = {}) {
    this.settings = { ...DEFAULT_ERASER_SETTINGS, ...settings };
    this.brushEngine = new BrushEngine(1920, 1080);
  }

  resize(width: number, height: number): void {
    this.brushEngine.resize(width, height);
  }

  setHistoryCanvas(canvas: OffscreenCanvas): void {
    this.historyCanvas = canvas;
  }

  startErase(x: number, y: number, pressure: number = 1): void {
    this.isErasing = true;
    this.currentStroke = {
      points: [{ x, y, pressure }],
      settings: { ...this.settings },
    };
  }

  continueErase(x: number, y: number, pressure: number = 1): void {
    if (!this.isErasing || !this.currentStroke) return;
    this.currentStroke.points.push({ x, y, pressure });
  }

  endErase(): EraserStroke | null {
    this.isErasing = false;
    const stroke = this.currentStroke;
    this.currentStroke = null;
    return stroke;
  }

  applyErase(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: EraserStroke
  ): void {
    const { points, settings } = stroke;
    if (points.length < 1) return;

    ctx.save();

    if (settings.eraseToHistory && this.historyCanvas) {
      this.eraseToHistoryState(ctx, stroke);
    } else {
      ctx.globalCompositeOperation = 'destination-out';

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
            const x = prev.x + dx * t;
            const y = prev.y + dy * t;
            const pressure = prev.pressure + (point.pressure - prev.pressure) * t;

            this.drawEraserDab(ctx, x, y, settings, pressure);
          }
        }

        this.drawEraserDab(ctx, point.x, point.y, settings, point.pressure);
      }
    }

    ctx.restore();
  }

  private drawEraserDab(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    settings: EraserSettings,
    pressure: number
  ): void {
    const size = settings.size * (settings.sizeDynamics.control === 'pen-pressure'
      ? settings.sizeDynamics.minValue + (1 - settings.sizeDynamics.minValue) * pressure
      : 1);
    const opacity = settings.opacity * settings.flow * (settings.opacityDynamics.control === 'pen-pressure'
      ? settings.opacityDynamics.minValue + (1 - settings.opacityDynamics.minValue) * pressure
      : 1);

    ctx.save();
    ctx.globalAlpha = opacity;

    const halfSize = size / 2;

    switch (settings.mode) {
      case 'block':
        ctx.fillStyle = 'white';
        ctx.fillRect(x - halfSize, y - halfSize, size, size);
        break;

      case 'pencil':
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(x, y, halfSize, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'brush':
      default:
        const hardness = settings.hardness / 100;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, halfSize);

        if (hardness >= 0.99) {
          gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
          gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');
        } else {
          const hardnessPoint = Math.max(0.01, hardness);
          gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
          gradient.addColorStop(hardnessPoint, 'rgba(255, 255, 255, 1)');
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, halfSize, 0, Math.PI * 2);
        ctx.fill();
        break;
    }

    ctx.restore();
  }

  private eraseToHistoryState(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: EraserStroke
  ): void {
    if (!this.historyCanvas) return;

    const { points, settings } = stroke;
    const historyCtx = this.historyCanvas.getContext('2d')!;

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
          const x = prev.x + dx * t;
          const y = prev.y + dy * t;
          const pressure = prev.pressure + (point.pressure - prev.pressure) * t;

          this.restoreFromHistory(ctx, historyCtx, x, y, settings, pressure);
        }
      }

      this.restoreFromHistory(ctx, historyCtx, point.x, point.y, settings, point.pressure);
    }
  }

  private restoreFromHistory(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    historyCtx: OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    settings: EraserSettings,
    pressure: number
  ): void {
    const size = Math.ceil(settings.size * (settings.sizeDynamics.control === 'pen-pressure'
      ? settings.sizeDynamics.minValue + (1 - settings.sizeDynamics.minValue) * pressure
      : 1));
    const halfSize = size / 2;
    const opacity = settings.opacity * settings.flow;

    const historyData = historyCtx.getImageData(
      Math.floor(x - halfSize),
      Math.floor(y - halfSize),
      size,
      size
    );

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(historyData, 0, 0);

    this.applyBrushMask(tempCtx, size, settings.hardness);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(tempCanvas, x - halfSize, y - halfSize);
    ctx.restore();
  }

  private applyBrushMask(ctx: OffscreenCanvasRenderingContext2D, size: number, hardness: number): void {
    const imageData = ctx.getImageData(0, 0, size, size);
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

    ctx.putImageData(imageData, 0, 0);
  }

  getSettings(): EraserSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<EraserSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  isActive(): boolean {
    return this.isErasing;
  }
}
