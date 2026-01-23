import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from '../brush/brush-engine';

export type SampleMode = 'current' | 'current-below' | 'all';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export interface CloneStampSettings extends BrushSettings {
  sourcePoint: { x: number; y: number } | null;
  sourceLayerId: string | null;
  aligned: boolean;
  sampleMode: SampleMode;
  blendMode: BlendMode;
}

export const DEFAULT_CLONE_STAMP_SETTINGS: CloneStampSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  sourcePoint: null,
  sourceLayerId: null,
  aligned: true,
  sampleMode: 'current',
  blendMode: 'normal',
};

export interface CloneStampState {
  isCloning: boolean;
  sourceSet: boolean;
  initialSourcePoint: { x: number; y: number } | null;
  initialTargetPoint: { x: number; y: number } | null;
  offset: { x: number; y: number };
}

export class CloneStampTool {
  private settings: CloneStampSettings;
  private state: CloneStampState;
  private sourceCanvas: OffscreenCanvas | null = null;
  private sourceCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(settings: Partial<CloneStampSettings> = {}) {
    this.settings = { ...DEFAULT_CLONE_STAMP_SETTINGS, ...settings };
    this.state = {
      isCloning: false,
      sourceSet: false,
      initialSourcePoint: null,
      initialTargetPoint: null,
      offset: { x: 0, y: 0 },
    };
  }

  setSource(x: number, y: number, layerId: string | null = null): void {
    this.settings.sourcePoint = { x, y };
    this.settings.sourceLayerId = layerId;
    this.state.sourceSet = true;
    this.state.initialSourcePoint = { x, y };
    this.state.initialTargetPoint = null;
    this.state.offset = { x: 0, y: 0 };
  }

  clearSource(): void {
    this.settings.sourcePoint = null;
    this.settings.sourceLayerId = null;
    this.state.sourceSet = false;
    this.state.initialSourcePoint = null;
    this.state.initialTargetPoint = null;
    this.state.offset = { x: 0, y: 0 };
  }

  hasSource(): boolean {
    return this.state.sourceSet && this.settings.sourcePoint !== null;
  }

  setSourceCanvas(canvas: OffscreenCanvas): void {
    this.sourceCanvas = canvas;
    this.sourceCtx = canvas.getContext('2d', { willReadFrequently: true });
  }

  startClone(targetX: number, targetY: number): void {
    if (!this.hasSource()) return;

    this.state.isCloning = true;

    if (this.settings.aligned) {
      if (!this.state.initialTargetPoint) {
        this.state.initialTargetPoint = { x: targetX, y: targetY };
        this.state.offset = {
          x: this.settings.sourcePoint!.x - targetX,
          y: this.settings.sourcePoint!.y - targetY,
        };
      }
    } else {
      this.state.offset = {
        x: this.settings.sourcePoint!.x - targetX,
        y: this.settings.sourcePoint!.y - targetY,
      };
    }
  }

  clone(
    targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    targetX: number,
    targetY: number
  ): void {
    if (!this.state.isCloning || !this.sourceCanvas || !this.sourceCtx) return;

    const sourceX = targetX + this.state.offset.x;
    const sourceY = targetY + this.state.offset.y;

    const size = Math.ceil(this.settings.size);
    const halfSize = size / 2;

    if (
      sourceX - halfSize < 0 ||
      sourceY - halfSize < 0 ||
      sourceX + halfSize > this.sourceCanvas.width ||
      sourceY + halfSize > this.sourceCanvas.height
    ) {
      return;
    }

    const sourceData = this.sourceCtx.getImageData(
      Math.floor(sourceX - halfSize),
      Math.floor(sourceY - halfSize),
      size,
      size
    );

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(sourceData, 0, 0);

    this.applyBrushMask(tempCtx, size, this.settings.hardness);

    targetCtx.save();
    targetCtx.globalAlpha = this.settings.opacity * this.settings.flow;
    targetCtx.globalCompositeOperation = this.getCompositeOperation(this.settings.blendMode);
    targetCtx.drawImage(tempCanvas, targetX - halfSize, targetY - halfSize);
    targetCtx.restore();
  }

  endClone(): void {
    this.state.isCloning = false;
  }

  private applyBrushMask(
    ctx: OffscreenCanvasRenderingContext2D,
    size: number,
    hardness: number
  ): void {
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

  private getCompositeOperation(blendMode: BlendMode): GlobalCompositeOperation {
    const modeMap: Record<BlendMode, GlobalCompositeOperation> = {
      normal: 'source-over',
      multiply: 'multiply',
      screen: 'screen',
      overlay: 'overlay',
      darken: 'darken',
      lighten: 'lighten',
    };
    return modeMap[blendMode] || 'source-over';
  }

  getSettings(): CloneStampSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<CloneStampSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSourcePoint(): { x: number; y: number } | null {
    return this.settings.sourcePoint;
  }

  getOffset(): { x: number; y: number } {
    return { ...this.state.offset };
  }

  getCurrentSourcePosition(targetX: number, targetY: number): { x: number; y: number } | null {
    if (!this.hasSource()) return null;
    return {
      x: targetX + this.state.offset.x,
      y: targetY + this.state.offset.y,
    };
  }
}
