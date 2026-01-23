import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from '../brush/brush-engine';

export type DodgeBurnType = 'dodge' | 'burn';
export type ToneRange = 'shadows' | 'midtones' | 'highlights';

export interface DodgeBurnSettings extends BrushSettings {
  type: DodgeBurnType;
  range: ToneRange;
  exposure: number;
  protectTones: boolean;
}

export const DEFAULT_DODGE_BURN_SETTINGS: DodgeBurnSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  type: 'dodge',
  range: 'midtones',
  exposure: 50,
  protectTones: true,
};

export interface DodgeBurnStroke {
  points: Array<{
    x: number;
    y: number;
    pressure: number;
  }>;
  settings: DodgeBurnSettings;
}

export class DodgeBurnTool {
  private settings: DodgeBurnSettings;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private isActive: boolean = false;
  private currentStroke: DodgeBurnStroke | null = null;

  constructor(settings: Partial<DodgeBurnSettings> = {}) {
    this.settings = { ...DEFAULT_DODGE_BURN_SETTINGS, ...settings };
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

  endStroke(): DodgeBurnStroke | null {
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
    const adjustedData = this.adjustTones(imageData, pressure);

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(adjustedData, 0, 0);

    this.applyBrushMask(tempCtx, size, this.settings.hardness);

    outputCtx.save();
    outputCtx.globalAlpha = this.settings.opacity * this.settings.flow;
    outputCtx.drawImage(tempCanvas, targetX, targetY);
    outputCtx.restore();
  }

  applyStroke(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: DodgeBurnStroke
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

  private adjustTones(imageData: ImageData, pressure: number): ImageData {
    const data = imageData.data;
    const exposure = (this.settings.exposure / 100) * pressure;
    const isDodge = this.settings.type === 'dodge';

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const luminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const rangeWeight = this.getRangeWeight(luminance);

      if (rangeWeight <= 0) continue;

      const effectStrength = exposure * rangeWeight;

      let newR: number, newG: number, newB: number;

      if (isDodge) {
        if (this.settings.protectTones) {
          newR = this.dodgeWithProtection(r, effectStrength);
          newG = this.dodgeWithProtection(g, effectStrength);
          newB = this.dodgeWithProtection(b, effectStrength);
        } else {
          newR = Math.min(255, r + (255 - r) * effectStrength);
          newG = Math.min(255, g + (255 - g) * effectStrength);
          newB = Math.min(255, b + (255 - b) * effectStrength);
        }
      } else {
        if (this.settings.protectTones) {
          newR = this.burnWithProtection(r, effectStrength);
          newG = this.burnWithProtection(g, effectStrength);
          newB = this.burnWithProtection(b, effectStrength);
        } else {
          newR = Math.max(0, r * (1 - effectStrength));
          newG = Math.max(0, g * (1 - effectStrength));
          newB = Math.max(0, b * (1 - effectStrength));
        }
      }

      data[i] = Math.round(newR);
      data[i + 1] = Math.round(newG);
      data[i + 2] = Math.round(newB);
    }

    return imageData;
  }

  private getRangeWeight(luminance: number): number {
    switch (this.settings.range) {
      case 'shadows':
        if (luminance <= 0.25) return 1;
        if (luminance <= 0.5) return 1 - (luminance - 0.25) / 0.25;
        return 0;

      case 'highlights':
        if (luminance >= 0.75) return 1;
        if (luminance >= 0.5) return (luminance - 0.5) / 0.25;
        return 0;

      case 'midtones':
      default:
        if (luminance >= 0.25 && luminance <= 0.75) {
          const distFromCenter = Math.abs(luminance - 0.5);
          return 1 - distFromCenter / 0.25;
        }
        return 0;
    }
  }

  private dodgeWithProtection(value: number, strength: number): number {
    const normalized = value / 255;
    const dodged = normalized + (1 - normalized) * strength * 0.5;
    const saturationPreserve = 1 - strength * 0.3;
    const protected_ = normalized + (dodged - normalized) * saturationPreserve;
    return Math.min(255, protected_ * 255);
  }

  private burnWithProtection(value: number, strength: number): number {
    const normalized = value / 255;
    const burned = normalized * (1 - strength * 0.5);
    const saturationPreserve = 1 - strength * 0.3;
    const protected_ = normalized + (burned - normalized) * saturationPreserve;
    return Math.max(0, protected_ * 255);
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

  getSettings(): DodgeBurnSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<DodgeBurnSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  isActiveStroke(): boolean {
    return this.isActive;
  }
}
