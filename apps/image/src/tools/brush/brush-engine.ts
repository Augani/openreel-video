export type DynamicsControl = 'off' | 'fade' | 'pen-pressure' | 'pen-tilt' | 'rotation';

export interface BrushDynamics {
  control: DynamicsControl;
  minValue: number;
  jitter: number;
}

export interface BrushSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  angle: number;
  roundness: number;

  sizeDynamics: BrushDynamics;
  opacityDynamics: BrushDynamics;
  flowDynamics: BrushDynamics;

  tip: 'round' | 'square' | 'custom';
  customTip: ImageData | null;

  buildUp: boolean;
  smoothing: number;
}

export const DEFAULT_BRUSH_DYNAMICS: BrushDynamics = {
  control: 'off',
  minValue: 0,
  jitter: 0,
};

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  size: 20,
  hardness: 100,
  opacity: 1,
  flow: 1,
  spacing: 25,
  angle: 0,
  roundness: 100,

  sizeDynamics: { ...DEFAULT_BRUSH_DYNAMICS },
  opacityDynamics: { ...DEFAULT_BRUSH_DYNAMICS },
  flowDynamics: { ...DEFAULT_BRUSH_DYNAMICS },

  tip: 'round',
  customTip: null,

  buildUp: false,
  smoothing: 50,
};

export interface BrushStroke {
  points: Array<{
    x: number;
    y: number;
    pressure: number;
    tilt: { x: number; y: number };
    timestamp: number;
  }>;
  color: string;
  settings: BrushSettings;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tilt?: { x: number; y: number };
}

export class BrushEngine {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private brushCache: Map<string, ImageData> = new Map();

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  resize(width: number, height: number): void {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  createBrushTip(settings: BrushSettings): ImageData {
    const cacheKey = `${settings.size}-${settings.hardness}-${settings.tip}-${settings.angle}-${settings.roundness}`;
    const cached = this.brushCache.get(cacheKey);
    if (cached) return cached;

    const size = Math.ceil(settings.size);
    const tipCanvas = new OffscreenCanvas(size, size);
    const tipCtx = tipCanvas.getContext('2d')!;

    const center = size / 2;
    const radius = size / 2;

    if (settings.tip === 'square') {
      tipCtx.fillStyle = 'white';
      tipCtx.save();
      tipCtx.translate(center, center);
      tipCtx.rotate((settings.angle * Math.PI) / 180);
      tipCtx.scale(1, settings.roundness / 100);
      tipCtx.fillRect(-radius, -radius, size, size);
      tipCtx.restore();
    } else if (settings.tip === 'custom' && settings.customTip) {
      tipCtx.putImageData(settings.customTip, 0, 0);
    } else {
      const hardness = settings.hardness / 100;

      tipCtx.save();
      tipCtx.translate(center, center);
      tipCtx.rotate((settings.angle * Math.PI) / 180);
      tipCtx.scale(1, settings.roundness / 100);

      if (hardness >= 0.99) {
        tipCtx.beginPath();
        tipCtx.arc(0, 0, radius, 0, Math.PI * 2);
        tipCtx.fillStyle = 'white';
        tipCtx.fill();
      } else {
        const gradient = tipCtx.createRadialGradient(0, 0, 0, 0, 0, radius);
        const hardnessPoint = Math.max(0.01, hardness);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(hardnessPoint, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        tipCtx.fillStyle = gradient;
        tipCtx.fillRect(-radius, -radius, size, size);
      }

      tipCtx.restore();
    }

    const imageData = tipCtx.getImageData(0, 0, size, size);

    if (this.brushCache.size > 50) {
      const firstKey = this.brushCache.keys().next().value;
      if (firstKey) this.brushCache.delete(firstKey);
    }
    this.brushCache.set(cacheKey, imageData);

    return imageData;
  }

  applyDynamics(
    baseValue: number,
    dynamics: BrushDynamics,
    pressure: number,
    _tilt: { x: number; y: number },
    fadeProgress: number
  ): number {
    let value = baseValue;

    switch (dynamics.control) {
      case 'pen-pressure':
        value = dynamics.minValue + (baseValue - dynamics.minValue) * pressure;
        break;
      case 'fade':
        value = dynamics.minValue + (baseValue - dynamics.minValue) * (1 - fadeProgress);
        break;
      case 'pen-tilt':
        value = dynamics.minValue + (baseValue - dynamics.minValue) * pressure;
        break;
      case 'rotation':
        break;
      case 'off':
      default:
        break;
    }

    if (dynamics.jitter > 0) {
      const jitterAmount = (Math.random() - 0.5) * 2 * dynamics.jitter * baseValue;
      value += jitterAmount;
    }

    return Math.max(0, value);
  }

  drawStroke(
    targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    stroke: BrushStroke,
    startIndex: number = 0
  ): void {
    const { points, color, settings } = stroke;
    if (points.length < 2) return;

    const totalLength = this.calculateStrokeLength(points);
    const spacingPx = (settings.size * settings.spacing) / 100;

    let accumulatedDistance = 0;
    let currentLength = 0;

    for (let i = Math.max(1, startIndex); i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const segmentLength = Math.sqrt(dx * dx + dy * dy);

      if (segmentLength < 0.1) continue;

      const steps = Math.ceil(segmentLength / spacingPx);
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        const x = prev.x + dx * t;
        const y = prev.y + dy * t;

        const pressure = prev.pressure + (curr.pressure - prev.pressure) * t;
        const tilt = {
          x: prev.tilt.x + (curr.tilt.x - prev.tilt.x) * t,
          y: prev.tilt.y + (curr.tilt.y - prev.tilt.y) * t,
        };
        const fadeProgress = currentLength / totalLength;

        const dynamicSize = this.applyDynamics(
          settings.size,
          settings.sizeDynamics,
          pressure,
          tilt,
          fadeProgress
        );
        const dynamicOpacity = this.applyDynamics(
          settings.opacity,
          settings.opacityDynamics,
          pressure,
          tilt,
          fadeProgress
        );
        const dynamicFlow = this.applyDynamics(
          settings.flow,
          settings.flowDynamics,
          pressure,
          tilt,
          fadeProgress
        );

        this.drawDab(targetCtx, x, y, color, {
          ...settings,
          size: dynamicSize,
          opacity: dynamicOpacity,
          flow: dynamicFlow,
        });

        accumulatedDistance += spacingPx;
        currentLength += spacingPx;
      }
    }
  }

  drawDab(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    settings: BrushSettings
  ): void {
    const size = Math.max(1, Math.round(settings.size));
    const halfSize = size / 2;

    ctx.save();
    ctx.globalAlpha = settings.opacity * settings.flow;

    if (settings.tip === 'square') {
      ctx.translate(x, y);
      ctx.rotate((settings.angle * Math.PI) / 180);
      ctx.scale(1, settings.roundness / 100);
      ctx.fillStyle = color;
      ctx.fillRect(-halfSize, -halfSize, size, size);
    } else {
      const hardness = settings.hardness / 100;

      ctx.translate(x, y);
      ctx.rotate((settings.angle * Math.PI) / 180);
      ctx.scale(1, settings.roundness / 100);

      if (hardness >= 0.99) {
        ctx.beginPath();
        ctx.arc(0, 0, halfSize, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, halfSize);
        const rgba = this.hexToRgba(color);
        const hardnessPoint = Math.max(0.01, hardness);

        gradient.addColorStop(0, `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, 1)`);
        gradient.addColorStop(hardnessPoint, `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, 1)`);
        gradient.addColorStop(1, `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(-halfSize, -halfSize, size, size);
      }
    }

    ctx.restore();
  }

  private calculateStrokeLength(points: BrushStroke['points']): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  private hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
        a: 1,
      };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  smoothPoints(points: StrokePoint[], smoothing: number): StrokePoint[] {
    if (points.length < 3 || smoothing <= 0) return points;

    const factor = smoothing / 100;
    const smoothed: StrokePoint[] = [points[0]];

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      smoothed.push({
        x: curr.x * (1 - factor) + ((prev.x + next.x) / 2) * factor,
        y: curr.y * (1 - factor) + ((prev.y + next.y) / 2) * factor,
        pressure: curr.pressure,
        tilt: curr.tilt,
      });
    }

    smoothed.push(points[points.length - 1]);
    return smoothed;
  }

  getCanvas(): OffscreenCanvas {
    return this.canvas;
  }

  getContext(): OffscreenCanvasRenderingContext2D {
    return this.ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export const brushEngine = new BrushEngine(1920, 1080);
