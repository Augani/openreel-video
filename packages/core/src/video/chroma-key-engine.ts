export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ChromaKeySettings {
  enabled: boolean;
  keyColor: RGB;
  tolerance: number;
  edgeSoftness: number;
  spillSuppression: number;
}

export interface ChromaKeyResult {
  image: ImageBitmap;
  processingTime: number;
  gpuAccelerated: boolean;
}

export interface ChromaKeyMatte {
  matte: ImageData;
  transparentPixels: number;
  totalPixels: number;
}

export interface ChromaKeyEngineConfig {
  width: number;
  height: number;
  useGPU?: boolean;
}

export const DEFAULT_CHROMA_KEY_SETTINGS: ChromaKeySettings = {
  enabled: false,
  keyColor: { r: 0, g: 1, b: 0 }, // Pure green
  tolerance: 0.3,
  edgeSoftness: 0.1,
  spillSuppression: 0.5,
};

export function createDefaultChromaKeySettings(): ChromaKeySettings {
  return { ...DEFAULT_CHROMA_KEY_SETTINGS };
}

export class ChromaKeyEngine {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private width: number;
  private height: number;
  private clipSettings: Map<string, ChromaKeySettings> = new Map();

  constructor(config: ChromaKeyEngineConfig) {
    this.width = config.width;
    this.height = config.height;
    this.canvas = new OffscreenCanvas(config.width, config.height);
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  // Match the working canvas to the incoming frame so the source is processed
  // at its native resolution/aspect (the subsequent drawImage(...,this.width,
  // this.height) calls become 1:1) instead of being stretched to the fixed
  // engine size. Output is then aspect-correct and fit downstream.
  private resizeTo(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  enableChromaKey(clipId: string): void {
    const existing = this.clipSettings.get(clipId);
    if (existing) {
      this.clipSettings.set(clipId, { ...existing, enabled: true });
    } else {
      this.clipSettings.set(clipId, {
        ...createDefaultChromaKeySettings(),
        enabled: true,
      });
    }
  }

  disableChromaKey(clipId: string): void {
    const existing = this.clipSettings.get(clipId);
    if (existing) {
      this.clipSettings.set(clipId, { ...existing, enabled: false });
    }
  }

  isEnabled(clipId: string): boolean {
    return this.clipSettings.get(clipId)?.enabled ?? false;
  }

  setKeyColor(clipId: string, color: RGB): void {
    const existing =
      this.clipSettings.get(clipId) || createDefaultChromaKeySettings();
    this.clipSettings.set(clipId, {
      ...existing,
      keyColor: {
        r: Math.max(0, Math.min(1, color.r)),
        g: Math.max(0, Math.min(1, color.g)),
        b: Math.max(0, Math.min(1, color.b)),
      },
    });
  }

  sampleKeyColor(image: ImageBitmap, x: number, y: number): RGB {
    this.resizeTo(image.width, image.height);
    // Draw image to canvas
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(image, 0, 0, this.width, this.height);
    const px = Math.floor(x * this.width);
    const py = Math.floor(y * this.height);
    const imageData = this.ctx.getImageData(px, py, 1, 1);

    return {
      r: imageData.data[0] / 255,
      g: imageData.data[1] / 255,
      b: imageData.data[2] / 255,
    };
  }

  setTolerance(clipId: string, tolerance: number): void {
    const existing =
      this.clipSettings.get(clipId) || createDefaultChromaKeySettings();
    this.clipSettings.set(clipId, {
      ...existing,
      tolerance: Math.max(0, Math.min(1, tolerance)),
    });
  }

  setEdgeSoftness(clipId: string, softness: number): void {
    const existing =
      this.clipSettings.get(clipId) || createDefaultChromaKeySettings();
    this.clipSettings.set(clipId, {
      ...existing,
      edgeSoftness: Math.max(0, Math.min(1, softness)),
    });
  }

  setSpillSuppression(clipId: string, amount: number): void {
    const existing =
      this.clipSettings.get(clipId) || createDefaultChromaKeySettings();
    this.clipSettings.set(clipId, {
      ...existing,
      spillSuppression: Math.max(0, Math.min(1, amount)),
    });
  }

  getSettings(clipId: string): ChromaKeySettings | undefined {
    return this.clipSettings.get(clipId);
  }

  setSettings(clipId: string, settings: ChromaKeySettings): void {
    this.clipSettings.set(clipId, { ...settings });
  }

  async applyChromaKey(
    image: ImageBitmap,
    clipId: string,
  ): Promise<ChromaKeyResult> {
    const startTime = performance.now();
    const settings = this.clipSettings.get(clipId);
    if (!settings || !settings.enabled) {
      return {
        image: await createImageBitmap(image),
        processingTime: performance.now() - startTime,
        gpuAccelerated: false,
      };
    }

    return this.applyChromaKeyWithSettings(image, settings, startTime);
  }

  async applyChromaKeyWithSettings(
    image: ImageBitmap,
    settings: ChromaKeySettings,
    startTime: number = performance.now(),
  ): Promise<ChromaKeyResult> {
    this.resizeTo(image.width, image.height);
    // Draw source image
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(image, 0, 0, this.width, this.height);
    const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;

    const { keyColor, tolerance, edgeSoftness, spillSuppression } = settings;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const distance = this.colorDistance(r, g, b, keyColor);
      let alpha = this.calculateAlpha(distance, tolerance, edgeSoftness);
      if (spillSuppression > 0 && alpha > 0) {
        const spillResult = this.suppressSpill(
          r,
          g,
          b,
          keyColor,
          spillSuppression,
          alpha,
        );
        data[i] = Math.round(spillResult.r * 255);
        data[i + 1] = Math.round(spillResult.g * 255);
        data[i + 2] = Math.round(spillResult.b * 255);
      }
      data[i + 3] = Math.round(alpha * 255);
    }

    // Put processed data back
    this.ctx.putImageData(imageData, 0, 0);

    const result = await createImageBitmap(this.canvas);

    return {
      image: result,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false,
    };
  }

  getMatte(image: ImageBitmap, clipId: string): ChromaKeyMatte {
    this.resizeTo(image.width, image.height);
    const settings = this.clipSettings.get(clipId);

    if (!settings || !settings.enabled) {
      const matte = this.ctx.createImageData(this.width, this.height);
      for (let i = 0; i < matte.data.length; i += 4) {
        matte.data[i] = 255;
        matte.data[i + 1] = 255;
        matte.data[i + 2] = 255;
        matte.data[i + 3] = 255;
      }
      return {
        matte,
        transparentPixels: 0,
        totalPixels: this.width * this.height,
      };
    }

    // Draw source image
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(image, 0, 0, this.width, this.height);

    const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;
    const matte = this.ctx.createImageData(this.width, this.height);
    const matteData = matte.data;

    const { keyColor, tolerance, edgeSoftness } = settings;
    let transparentPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const distance = this.colorDistance(r, g, b, keyColor);
      const alpha = this.calculateAlpha(distance, tolerance, edgeSoftness);
      const alphaValue = Math.round(alpha * 255);
      matteData[i] = alphaValue;
      matteData[i + 1] = alphaValue;
      matteData[i + 2] = alphaValue;
      matteData[i + 3] = 255;

      if (alpha === 0) {
        transparentPixels++;
      }
    }

    return {
      matte,
      transparentPixels,
      totalPixels: this.width * this.height,
    };
  }

  private colorDistance(
    r: number,
    g: number,
    b: number,
    keyColor: RGB,
  ): number {
    const dr = r - keyColor.r;
    const dg = g - keyColor.g;
    const db = b - keyColor.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  private calculateAlpha(
    distance: number,
    tolerance: number,
    softness: number,
  ): number {
    // Maximum possible distance in RGB space is sqrt(3) ≈ 1.732
    // Scale tolerance to this range
    const scaledTolerance = tolerance * 1.732;
    const scaledSoftness = softness * 0.5; // Softness range

    if (distance <= scaledTolerance - scaledSoftness) {
      // Fully transparent (within tolerance)
      return 0;
    } else if (distance >= scaledTolerance + scaledSoftness) {
      // Fully opaque (outside tolerance + softness)
      return 1;
    } else {
      // Smooth transition (edge softness)
      const range = scaledSoftness * 2;
      const position = distance - (scaledTolerance - scaledSoftness);
      return position / range;
    }
  }

  private suppressSpill(
    r: number,
    g: number,
    b: number,
    keyColor: RGB,
    amount: number,
    alpha: number,
  ): RGB {
    if (alpha >= 1 || alpha <= 0) {
      return { r, g, b };
    }
    const spillFactor = 1 - alpha;

    // Determine which channel is the key color's dominant channel
    const maxKey = Math.max(keyColor.r, keyColor.g, keyColor.b);

    let newR = r;
    let newG = g;
    let newB = b;
    if (keyColor.g === maxKey) {
      // Green screen - reduce green spill
      const avgRB = (r + b) / 2;
      const greenExcess = Math.max(0, g - avgRB);
      newG = g - greenExcess * amount * spillFactor;
    } else if (keyColor.b === maxKey) {
      // Blue screen - reduce blue spill
      const avgRG = (r + g) / 2;
      const blueExcess = Math.max(0, b - avgRG);
      newB = b - blueExcess * amount * spillFactor;
    } else {
      // Red screen - reduce red spill
      const avgGB = (g + b) / 2;
      const redExcess = Math.max(0, r - avgGB);
      newR = r - redExcess * amount * spillFactor;
    }

    return {
      r: Math.max(0, Math.min(1, newR)),
      g: Math.max(0, Math.min(1, newG)),
      b: Math.max(0, Math.min(1, newB)),
    };
  }

  async composite(
    foreground: ImageBitmap,
    background: ImageBitmap,
  ): Promise<ImageBitmap> {
    this.resizeTo(foreground.width, foreground.height);
    // Draw background first
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(background, 0, 0, this.width, this.height);

    // Draw foreground on top (alpha channel handles transparency)
    this.ctx.drawImage(foreground, 0, 0, this.width, this.height);

    return createImageBitmap(this.canvas);
  }

  async applyAndComposite(
    foreground: ImageBitmap,
    background: ImageBitmap,
    clipId: string,
  ): Promise<ChromaKeyResult> {
    const startTime = performance.now();
    const keyedResult = await this.applyChromaKey(foreground, clipId);

    // Composite over background
    const composited = await this.composite(keyedResult.image, background);

    // Clean up intermediate result
    keyedResult.image.close();

    return {
      image: composited,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false,
    };
  }

  countTransparentPixels(image: ImageBitmap): number {
    this.resizeTo(image.width, image.height);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(image, 0, 0, this.width, this.height);

    const imageData = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = imageData.data;

    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) {
        count++;
      }
    }

    return count;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  clearSettings(clipId: string): void {
    this.clipSettings.delete(clipId);
  }

  clearAllSettings(): void {
    this.clipSettings.clear();
  }
}
