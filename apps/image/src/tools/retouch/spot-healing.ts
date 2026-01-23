import { BrushSettings, DEFAULT_BRUSH_SETTINGS } from '../brush/brush-engine';

export type SpotHealingType = 'proximity-match' | 'content-aware' | 'create-texture';

export interface SpotHealingSettings extends BrushSettings {
  type: SpotHealingType;
  sampleAllLayers: boolean;
}

export const DEFAULT_SPOT_HEALING_SETTINGS: SpotHealingSettings = {
  ...DEFAULT_BRUSH_SETTINGS,
  type: 'content-aware',
  sampleAllLayers: false,
};

interface PatchCandidate {
  x: number;
  y: number;
  score: number;
}

export class SpotHealingTool {
  private settings: SpotHealingSettings;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(settings: Partial<SpotHealingSettings> = {}) {
    this.settings = { ...DEFAULT_SPOT_HEALING_SETTINGS, ...settings };
  }

  setCanvas(canvas: OffscreenCanvas): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  heal(
    outputCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number
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

    const targetData = this.ctx.getImageData(targetX, targetY, size, size);
    let healedData: ImageData;

    switch (this.settings.type) {
      case 'proximity-match':
        healedData = this.proximityMatch(targetX, targetY, size, targetData);
        break;
      case 'create-texture':
        healedData = this.createTexture(targetX, targetY, size, targetData);
        break;
      case 'content-aware':
      default:
        healedData = this.contentAwareHeal(targetX, targetY, size, targetData);
        break;
    }

    const tempCanvas = new OffscreenCanvas(size, size);
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(healedData, 0, 0);

    this.applyBrushMask(tempCtx, size, this.settings.hardness);

    outputCtx.save();
    outputCtx.globalAlpha = this.settings.opacity;
    outputCtx.drawImage(tempCanvas, targetX, targetY);
    outputCtx.restore();
  }

  private proximityMatch(
    targetX: number,
    targetY: number,
    size: number,
    _targetData: ImageData
  ): ImageData {
    if (!this.canvas || !this.ctx) {
      return new ImageData(size, size);
    }

    const searchRadius = size * 2;
    const candidates: PatchCandidate[] = [];

    for (let dy = -searchRadius; dy <= searchRadius; dy += size / 2) {
      for (let dx = -searchRadius; dx <= searchRadius; dx += size / 2) {
        if (Math.abs(dx) < size && Math.abs(dy) < size) continue;

        const sx = targetX + dx;
        const sy = targetY + dy;

        if (
          sx < 0 ||
          sy < 0 ||
          sx + size > this.canvas.width ||
          sy + size > this.canvas.height
        ) {
          continue;
        }

        const distance = Math.sqrt(dx * dx + dy * dy);
        candidates.push({ x: sx, y: sy, score: 1 / distance });
      }
    }

    if (candidates.length === 0) {
      return this.ctx.getImageData(targetX, targetY, size, size);
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    const sourceData = this.ctx.getImageData(best.x, best.y, size, size);
    const targetSample = this.ctx.getImageData(targetX, targetY, size, size);

    return this.blendWithColorMatch(sourceData, targetSample, size);
  }

  private contentAwareHeal(
    _targetX: number,
    _targetY: number,
    size: number,
    targetData: ImageData
  ): ImageData {
    if (!this.canvas || !this.ctx) {
      return new ImageData(size, size);
    }

    const result = new ImageData(size, size);
    const outData = result.data;
    const tgtData = targetData.data;

    const borderPixels: Array<{ x: number; y: number; r: number; g: number; b: number }> = [];

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - size / 2;
        const dy = y - size / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > size / 2 - 2 && dist <= size / 2) {
          const idx = (y * size + x) * 4;
          borderPixels.push({
            x,
            y,
            r: tgtData[idx],
            g: tgtData[idx + 1],
            b: tgtData[idx + 2],
          });
        }
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > size / 2) {
          outData[idx] = tgtData[idx];
          outData[idx + 1] = tgtData[idx + 1];
          outData[idx + 2] = tgtData[idx + 2];
          outData[idx + 3] = tgtData[idx + 3];
          continue;
        }

        let totalWeight = 0;
        let r = 0, g = 0, b = 0;

        for (const border of borderPixels) {
          const bdx = x - border.x;
          const bdy = y - border.y;
          const distance = Math.sqrt(bdx * bdx + bdy * bdy);
          const weight = 1 / (distance * distance + 1);

          r += border.r * weight;
          g += border.g * weight;
          b += border.b * weight;
          totalWeight += weight;
        }

        if (totalWeight > 0) {
          outData[idx] = Math.round(r / totalWeight);
          outData[idx + 1] = Math.round(g / totalWeight);
          outData[idx + 2] = Math.round(b / totalWeight);
        } else {
          outData[idx] = tgtData[idx];
          outData[idx + 1] = tgtData[idx + 1];
          outData[idx + 2] = tgtData[idx + 2];
        }
        outData[idx + 3] = 255;
      }
    }

    return result;
  }

  private createTexture(
    targetX: number,
    targetY: number,
    size: number,
    _targetData: ImageData
  ): ImageData {
    if (!this.canvas || !this.ctx) {
      return new ImageData(size, size);
    }

    const sampleSize = size;
    const samples: ImageData[] = [];

    const offsets = [
      { x: -sampleSize, y: -sampleSize },
      { x: sampleSize, y: -sampleSize },
      { x: -sampleSize, y: sampleSize },
      { x: sampleSize, y: sampleSize },
    ];

    for (const offset of offsets) {
      const sx = targetX + offset.x;
      const sy = targetY + offset.y;

      if (
        sx >= 0 &&
        sy >= 0 &&
        sx + size <= this.canvas.width &&
        sy + size <= this.canvas.height
      ) {
        samples.push(this.ctx.getImageData(sx, sy, size, size));
      }
    }

    if (samples.length === 0) {
      return this.ctx.getImageData(targetX, targetY, size, size);
    }

    const result = new ImageData(size, size);
    const outData = result.data;

    for (let i = 0; i < outData.length; i += 4) {
      let r = 0, g = 0, b = 0, a = 0;

      for (const sample of samples) {
        r += sample.data[i];
        g += sample.data[i + 1];
        b += sample.data[i + 2];
        a += sample.data[i + 3];
      }

      outData[i] = Math.round(r / samples.length);
      outData[i + 1] = Math.round(g / samples.length);
      outData[i + 2] = Math.round(b / samples.length);
      outData[i + 3] = Math.round(a / samples.length);
    }

    return result;
  }

  private blendWithColorMatch(source: ImageData, target: ImageData, size: number): ImageData {
    const result = new ImageData(size, size);
    const srcData = source.data;
    const tgtData = target.data;
    const outData = result.data;

    const srcAvg = this.calculateAverage(srcData);
    const tgtAvg = this.calculateAverage(tgtData);

    for (let i = 0; i < srcData.length; i += 4) {
      outData[i] = Math.max(0, Math.min(255, srcData[i] - srcAvg[0] + tgtAvg[0]));
      outData[i + 1] = Math.max(0, Math.min(255, srcData[i + 1] - srcAvg[1] + tgtAvg[1]));
      outData[i + 2] = Math.max(0, Math.min(255, srcData[i + 2] - srcAvg[2] + tgtAvg[2]));
      outData[i + 3] = srcData[i + 3];
    }

    return result;
  }

  private calculateAverage(data: Uint8ClampedArray): [number, number, number] {
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

  getSettings(): SpotHealingSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<SpotHealingSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }
}
