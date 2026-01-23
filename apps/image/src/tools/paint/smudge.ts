import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from '../brush/brush-engine';

export interface SmudgeSettings extends Omit<BrushSettings, 'color'> {
  strength: number;
  fingerPainting: boolean;
  sampleAllLayers: boolean;
  fingerColor: string;
}

export const DEFAULT_SMUDGE_SETTINGS: SmudgeSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  size: 30,
  hardness: 50,
  strength: 0.5,
  fingerPainting: false,
  sampleAllLayers: false,
  fingerColor: '#000000',
};

export interface SmudgeStroke {
  points: Array<{
    x: number;
    y: number;
    pressure: number;
  }>;
  settings: SmudgeSettings;
}

export class SmudgeTool {
  private settings: SmudgeSettings;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private isActive: boolean = false;
  private currentStroke: SmudgeStroke | null = null;
  private sampleBuffer: ImageData | null = null;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor(settings: Partial<SmudgeSettings> = {}) {
    this.settings = { ...DEFAULT_SMUDGE_SETTINGS, ...settings };
  }

  setCanvas(canvas: OffscreenCanvas): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  startStroke(x: number, y: number, pressure: number = 1): void {
    if (!this.canvas || !this.ctx) return;

    this.isActive = true;
    this.lastX = x;
    this.lastY = y;
    this.currentStroke = {
      points: [{ x, y, pressure }],
      settings: { ...this.settings },
    };

    this.sampleAtPoint(x, y);
  }

  private sampleAtPoint(x: number, y: number): void {
    if (!this.ctx || !this.canvas) return;

    const size = Math.ceil(this.settings.size);
    const halfSize = Math.floor(size / 2);

    const sampleX = Math.max(0, Math.floor(x - halfSize));
    const sampleY = Math.max(0, Math.floor(y - halfSize));
    const sampleW = Math.min(size, this.canvas.width - sampleX);
    const sampleH = Math.min(size, this.canvas.height - sampleY);

    if (sampleW <= 0 || sampleH <= 0) return;

    if (this.settings.fingerPainting && this.sampleBuffer === null) {
      const tempCanvas = new OffscreenCanvas(size, size);
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.fillStyle = this.settings.fingerColor;
      tempCtx.beginPath();
      tempCtx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      tempCtx.fill();
      this.sampleBuffer = tempCtx.getImageData(0, 0, size, size);
    } else {
      this.sampleBuffer = this.ctx.getImageData(sampleX, sampleY, sampleW, sampleH);
    }
  }

  continueStroke(x: number, y: number, pressure: number = 1): void {
    if (!this.isActive || !this.currentStroke || !this.ctx || !this.sampleBuffer) return;

    this.currentStroke.points.push({ x, y, pressure });

    const dx = x - this.lastX;
    const dy = y - this.lastY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1) return;

    const steps = Math.ceil(distance);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const interpX = this.lastX + dx * t;
      const interpY = this.lastY + dy * t;
      this.applySmudge(interpX, interpY, pressure);
    }

    this.lastX = x;
    this.lastY = y;
  }

  private applySmudge(x: number, y: number, pressure: number): void {
    if (!this.ctx || !this.canvas || !this.sampleBuffer) return;

    const size = this.sampleBuffer.width;
    const halfSize = Math.floor(size / 2);

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

    const targetData = this.ctx.getImageData(targetX, targetY, size, size);
    const strength = this.settings.strength * pressure;

    const center = size / 2;
    const radius = size / 2;
    const hardnessNorm = this.settings.hardness / 100;

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const pxDist = Math.sqrt((px - center) ** 2 + (py - center) ** 2);
        const normalizedDist = pxDist / radius;

        if (normalizedDist > 1) continue;

        let brushAlpha = 1;
        if (normalizedDist > hardnessNorm) {
          brushAlpha = 1 - (normalizedDist - hardnessNorm) / (1 - hardnessNorm);
          brushAlpha = Math.max(0, Math.min(1, brushAlpha));
        }

        const idx = (py * size + px) * 4;
        const blendStrength = strength * brushAlpha;

        const sampleIdx = Math.min(idx, this.sampleBuffer.data.length - 4);

        targetData.data[idx] = Math.round(
          targetData.data[idx] * (1 - blendStrength) +
          this.sampleBuffer.data[sampleIdx] * blendStrength
        );
        targetData.data[idx + 1] = Math.round(
          targetData.data[idx + 1] * (1 - blendStrength) +
          this.sampleBuffer.data[sampleIdx + 1] * blendStrength
        );
        targetData.data[idx + 2] = Math.round(
          targetData.data[idx + 2] * (1 - blendStrength) +
          this.sampleBuffer.data[sampleIdx + 2] * blendStrength
        );
      }
    }

    this.ctx.putImageData(targetData, targetX, targetY);

    this.sampleBuffer = this.ctx.getImageData(targetX, targetY, size, size);
  }

  endStroke(): SmudgeStroke | null {
    this.isActive = false;
    const stroke = this.currentStroke;
    this.currentStroke = null;
    this.sampleBuffer = null;
    return stroke;
  }

  applyStroke(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: SmudgeStroke
  ): void {
    const { points, settings } = stroke;
    if (points.length < 2) return;

    const originalSettings = { ...this.settings };
    this.settings = { ...settings };

    const tempCanvas = new OffscreenCanvas(
      outputCtx.canvas.width,
      outputCtx.canvas.height
    );
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })!;
    tempCtx.drawImage(outputCtx.canvas, 0, 0);

    this.canvas = tempCanvas;
    this.ctx = tempCtx;

    this.lastX = points[0].x;
    this.lastY = points[0].y;
    this.sampleAtPoint(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      this.continueStroke(point.x, point.y, point.pressure);
    }

    outputCtx.drawImage(tempCanvas, 0, 0);
    this.settings = originalSettings;
  }

  getSettings(): SmudgeSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<SmudgeSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  isActiveStroke(): boolean {
    return this.isActive;
  }
}
