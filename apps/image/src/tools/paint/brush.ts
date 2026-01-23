import { BrushEngine, BrushSettings, DEFAULT_BRUSH_SETTINGS, BrushStroke } from '../brush/brush-engine';

export interface SimpleBrushSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  color: string;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
}

export const DEFAULT_SIMPLE_BRUSH_SETTINGS: SimpleBrushSettings = {
  size: 20,
  hardness: 100,
  opacity: 1,
  flow: 1,
  color: '#000000',
  blendMode: 'normal',
};

export class BrushTool {
  private settings: SimpleBrushSettings;
  private engine: BrushEngine;
  private isPainting: boolean = false;
  private currentStroke: BrushStroke | null = null;

  constructor(settings: Partial<SimpleBrushSettings> = {}) {
    this.settings = { ...DEFAULT_SIMPLE_BRUSH_SETTINGS, ...settings };
    this.engine = new BrushEngine(1920, 1080);
  }

  setCanvas(canvas: OffscreenCanvas): void {
    this.engine.resize(canvas.width, canvas.height);
  }

  startStroke(x: number, y: number, pressure: number = 1): void {
    this.isPainting = true;
    this.currentStroke = {
      points: [{ x, y, pressure, tilt: { x: 0, y: 0 }, timestamp: Date.now() }],
      color: this.settings.color,
      settings: this.convertToFullSettings(),
    };
  }

  continueStroke(x: number, y: number, pressure: number = 1): void {
    if (!this.isPainting || !this.currentStroke) return;
    this.currentStroke.points.push({ x, y, pressure, tilt: { x: 0, y: 0 }, timestamp: Date.now() });
  }

  endStroke(): BrushStroke | null {
    this.isPainting = false;
    const stroke = this.currentStroke;
    this.currentStroke = null;
    return stroke;
  }

  apply(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1
  ): void {
    if (!this.currentStroke) return;

    const startIndex = Math.max(0, this.currentStroke.points.length - 2);
    this.currentStroke.points.push({ x, y, pressure, tilt: { x: 0, y: 0 }, timestamp: Date.now() });

    ctx.save();

    const blendModeMap: Record<string, GlobalCompositeOperation> = {
      'normal': 'source-over',
      'multiply': 'multiply',
      'screen': 'screen',
      'overlay': 'overlay',
    };
    ctx.globalCompositeOperation = blendModeMap[this.settings.blendMode] ?? 'source-over';

    this.engine.drawStroke(ctx, this.currentStroke, startIndex);
    ctx.restore();
  }

  applyFullStroke(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: BrushStroke
  ): void {
    ctx.save();

    const blendModeMap: Record<string, GlobalCompositeOperation> = {
      'normal': 'source-over',
      'multiply': 'multiply',
      'screen': 'screen',
      'overlay': 'overlay',
    };
    ctx.globalCompositeOperation = blendModeMap[this.settings.blendMode] ?? 'source-over';

    this.engine.drawStroke(ctx, stroke);
    ctx.restore();
  }

  private convertToFullSettings(): BrushSettings {
    return {
      ...DEFAULT_BRUSH_SETTINGS,
      size: this.settings.size,
      hardness: this.settings.hardness,
      opacity: this.settings.opacity,
      flow: this.settings.flow,
    };
  }

  getSettings(): SimpleBrushSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<SimpleBrushSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (this.currentStroke) {
      this.currentStroke.color = this.settings.color;
      this.currentStroke.settings = this.convertToFullSettings();
    }
  }

  isActive(): boolean {
    return this.isPainting;
  }
}
