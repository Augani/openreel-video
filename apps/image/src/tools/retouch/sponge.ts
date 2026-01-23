import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from '../brush/brush-engine';

export type SpongeMode = 'saturate' | 'desaturate';

export interface SpongeSettings extends BrushSettings {
  mode: SpongeMode;
  flow: number;
  vibrance: boolean;
}

export const DEFAULT_SPONGE_SETTINGS: SpongeSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  mode: 'desaturate',
  flow: 0.5,
  vibrance: true,
};

export interface SpongeStroke {
  points: Array<{
    x: number;
    y: number;
    pressure: number;
  }>;
  settings: SpongeSettings;
}

export class SpongeTool {
  private settings: SpongeSettings;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private isActive: boolean = false;
  private currentStroke: SpongeStroke | null = null;

  constructor(settings: Partial<SpongeSettings> = {}) {
    this.settings = { ...DEFAULT_SPONGE_SETTINGS, ...settings };
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

  endStroke(): SpongeStroke | null {
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
    const adjustedData = this.adjustSaturation(imageData, pressure);

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(adjustedData, 0, 0);

    this.applyBrushMask(tempCtx, size, this.settings.hardness);

    outputCtx.save();
    outputCtx.globalAlpha = this.settings.opacity;
    outputCtx.drawImage(tempCanvas, targetX, targetY);
    outputCtx.restore();
  }

  applyStroke(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: SpongeStroke
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

  private adjustSaturation(imageData: ImageData, pressure: number): ImageData {
    const data = imageData.data;
    const flow = this.settings.flow * pressure;
    const isSaturate = this.settings.mode === 'saturate';

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const { h, s, l } = this.rgbToHsl(r, g, b);

      let newS: number;
      if (isSaturate) {
        if (this.settings.vibrance) {
          const saturationWeight = 1 - s;
          newS = s + (1 - s) * flow * saturationWeight;
        } else {
          newS = Math.min(1, s + (1 - s) * flow);
        }
      } else {
        if (this.settings.vibrance) {
          const saturationWeight = s;
          newS = s - s * flow * saturationWeight;
        } else {
          newS = Math.max(0, s - s * flow);
        }
      }

      const { r: newR, g: newG, b: newB } = this.hslToRgb(h, newS, l);

      data[i] = newR;
      data[i + 1] = newG;
      data[i + 2] = newB;
    }

    return imageData;
  }

  private rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
      return { h: 0, s: 0, l };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h: number;
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }

    return { h, s, l };
  }

  private hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    if (s === 0) {
      const gray = Math.round(l * 255);
      return { r: gray, g: gray, b: gray };
    }

    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
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

  getSettings(): SpongeSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<SpongeSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  isActiveStroke(): boolean {
    return this.isActive;
  }
}
