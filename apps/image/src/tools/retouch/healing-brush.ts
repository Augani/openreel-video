import { CloneStampSettings, DEFAULT_CLONE_STAMP_SETTINGS } from './clone-stamp';

export type HealingMode = 'normal' | 'replace' | 'multiply' | 'screen' | 'darken' | 'lighten';

export interface HealingBrushSettings extends Omit<CloneStampSettings, 'blendMode'> {
  healingMode: HealingMode;
  diffusion: number;
}

export const DEFAULT_HEALING_BRUSH_SETTINGS: HealingBrushSettings = {
  ...DEFAULT_CLONE_STAMP_SETTINGS,
  healingMode: 'normal',
  diffusion: 50,
};

export class HealingBrushTool {
  private settings: HealingBrushSettings;
  private sourceCanvas: OffscreenCanvas | null = null;
  private sourceCtx: OffscreenCanvasRenderingContext2D | null = null;
  private targetCtx: OffscreenCanvasRenderingContext2D | null = null;
  private isHealing: boolean = false;
  private offset: { x: number; y: number } = { x: 0, y: 0 };
  private initialTargetPoint: { x: number; y: number } | null = null;

  constructor(settings: Partial<HealingBrushSettings> = {}) {
    this.settings = { ...DEFAULT_HEALING_BRUSH_SETTINGS, ...settings };
  }

  setSource(x: number, y: number, _layerId: string | null = null): void {
    this.settings.sourcePoint = { x, y };
    this.initialTargetPoint = null;
    this.offset = { x: 0, y: 0 };
  }

  clearSource(): void {
    this.settings.sourcePoint = null;
    this.initialTargetPoint = null;
    this.offset = { x: 0, y: 0 };
  }

  hasSource(): boolean {
    return this.settings.sourcePoint !== null;
  }

  setCanvases(source: OffscreenCanvas, target: OffscreenCanvas): void {
    this.sourceCanvas = source;
    this.sourceCtx = source.getContext('2d', { willReadFrequently: true });
    this.targetCtx = target.getContext('2d', { willReadFrequently: true });
  }

  startHeal(targetX: number, targetY: number): void {
    if (!this.hasSource()) return;

    this.isHealing = true;

    if (this.settings.aligned) {
      if (!this.initialTargetPoint) {
        this.initialTargetPoint = { x: targetX, y: targetY };
        this.offset = {
          x: this.settings.sourcePoint!.x - targetX,
          y: this.settings.sourcePoint!.y - targetY,
        };
      }
    } else {
      this.offset = {
        x: this.settings.sourcePoint!.x - targetX,
        y: this.settings.sourcePoint!.y - targetY,
      };
    }
  }

  heal(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    targetX: number,
    targetY: number
  ): void {
    if (!this.isHealing || !this.sourceCanvas || !this.sourceCtx || !this.targetCtx) return;

    const sourceX = targetX + this.offset.x;
    const sourceY = targetY + this.offset.y;

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

    const targetData = this.targetCtx.getImageData(
      Math.floor(targetX - halfSize),
      Math.floor(targetY - halfSize),
      size,
      size
    );

    const healedData = this.blendTextures(sourceData, targetData, size);

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(healedData, 0, 0);

    this.applyBrushMask(tempCtx, size, this.settings.hardness);

    outputCtx.save();
    outputCtx.globalAlpha = this.settings.opacity * this.settings.flow;
    outputCtx.drawImage(tempCanvas, targetX - halfSize, targetY - halfSize);
    outputCtx.restore();
  }

  endHeal(): void {
    this.isHealing = false;
  }

  private blendTextures(source: ImageData, target: ImageData, size: number): ImageData {
    const result = new ImageData(size, size);
    const srcData = source.data;
    const tgtData = target.data;
    const outData = result.data;

    const srcAvg = this.calculateRegionAverage(srcData, size);
    const tgtAvg = this.calculateRegionAverage(tgtData, size);

    const diffusion = this.settings.diffusion / 100;
    const center = size / 2;
    const radius = size / 2;
    const hardness = this.settings.hardness / 100;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        const dx = x - center;
        const dy = y - center;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const normalizedDist = distance / radius;

        let blendFactor = 1;
        if (normalizedDist > hardness) {
          blendFactor = 1 - (normalizedDist - hardness) / (1 - hardness);
          blendFactor = Math.max(0, Math.min(1, blendFactor));
        }
        if (normalizedDist > 1) {
          blendFactor = 0;
        }

        for (let c = 0; c < 3; c++) {
          const srcVal = srcData[idx + c];
          const tgtVal = tgtData[idx + c];

          const srcNormalized = srcVal - srcAvg[c];
          const tgtColor = tgtAvg[c];
          const healedVal = srcNormalized + tgtColor;

          const finalVal = tgtVal * (1 - blendFactor * diffusion) + healedVal * blendFactor * diffusion;

          outData[idx + c] = Math.max(0, Math.min(255, Math.round(finalVal)));
        }

        outData[idx + 3] = Math.round(
          tgtData[idx + 3] * (1 - blendFactor) + srcData[idx + 3] * blendFactor
        );
      }
    }

    return result;
  }

  private calculateRegionAverage(data: Uint8ClampedArray, _size: number): [number, number, number] {
    let r = 0, g = 0, b = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count++;
      }
    }

    if (count === 0) return [128, 128, 128];

    return [r / count, g / count, b / count];
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

  getSettings(): HealingBrushSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<HealingBrushSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getSourcePoint(): { x: number; y: number } | null {
    return this.settings.sourcePoint;
  }

  getCurrentSourcePosition(targetX: number, targetY: number): { x: number; y: number } | null {
    if (!this.hasSource()) return null;
    return {
      x: targetX + this.offset.x,
      y: targetY + this.offset.y,
    };
  }
}
