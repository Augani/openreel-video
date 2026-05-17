import { getPersonSegmentationEngine } from "./person-segmentation-engine";

export type BackgroundMode =
  | "blur"
  | "color"
  | "image"
  | "video"
  | "transparent";

export interface BackgroundRemovalSettings {
  enabled: boolean;
  mode: BackgroundMode;
  blurAmount: number;
  backgroundColor: string;
  backgroundImageUrl?: string;
  backgroundVideoUrl?: string;
  edgeBlur: number;
  threshold: number;
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundRemovalSettings = {
  enabled: false,
  mode: "blur",
  blurAmount: 15,
  backgroundColor: "#00ff00",
  edgeBlur: 3,
  threshold: 0.7,
};

type ProgressCallback = (progress: number, message: string) => void;

export class BackgroundRemovalEngine {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private maskCanvas: OffscreenCanvas | null = null;
  private maskCtx: OffscreenCanvasRenderingContext2D | null = null;
  private outputCanvas: OffscreenCanvas | null = null;
  private outputCtx: OffscreenCanvasRenderingContext2D | null = null;
  private backgroundImage: ImageBitmap | null = null;
  private settings: Map<string, BackgroundRemovalSettings> = new Map();
  private initialized = false;
  private useAI = false;

  async initialize(onProgress?: ProgressCallback): Promise<void> {
    if (this.initialized) return;

    onProgress?.(10, "Initializing background removal...");

    this.canvas = new OffscreenCanvas(1920, 1080);
    this.ctx = this.canvas.getContext("2d");

    this.maskCanvas = new OffscreenCanvas(1920, 1080);
    this.maskCtx = this.maskCanvas.getContext("2d");

    this.outputCanvas = new OffscreenCanvas(1920, 1080);
    this.outputCtx = this.outputCanvas.getContext("2d");

    onProgress?.(50, "Loading AI segmentation model...");
    const segEngine = getPersonSegmentationEngine();
    try {
      await segEngine.initialize();
      this.useAI = true;
    } catch {
      this.useAI = false;
    }

    onProgress?.(100, "Background removal ready");
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setSettings(
    clipId: string,
    settings: Partial<BackgroundRemovalSettings>,
  ): void {
    const current = this.settings.get(clipId) || {
      ...DEFAULT_BACKGROUND_SETTINGS,
    };
    this.settings.set(clipId, { ...current, ...settings });
  }

  getSettings(clipId: string): BackgroundRemovalSettings {
    return this.settings.get(clipId) || { ...DEFAULT_BACKGROUND_SETTINGS };
  }

  async setBackgroundImage(url: string): Promise<void> {
    const response = await fetch(url);
    const blob = await response.blob();
    this.backgroundImage = await createImageBitmap(blob);
  }

  async processFrame(
    clipId: string,
    frame: ImageBitmap,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    const settings = this.getSettings(clipId);

    if (!settings.enabled || !this.ctx || !this.maskCtx || !this.outputCtx) {
      return frame;
    }

    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width;
      this.canvas!.height = height;
      this.maskCanvas!.width = width;
      this.maskCanvas!.height = height;
      this.outputCanvas!.width = width;
      this.outputCanvas!.height = height;
    }

    if (this.useAI) {
      return this.processFrameFast(clipId, frame, width, height, settings);
    }

    this.ctx.drawImage(frame, 0, 0, width, height);
    const imageData = this.ctx.getImageData(0, 0, width, height);
    const mask = this.generateSimpleMask(imageData, settings.threshold);

    if (settings.edgeBlur > 0) {
      this.applyEdgeBlur(mask, settings.edgeBlur);
    }

    this.maskCtx.putImageData(mask, 0, 0);
    this.outputCtx.clearRect(0, 0, width, height);

    switch (settings.mode) {
      case "blur":
        await this.renderBlurBackground(
          frame,
          mask,
          width,
          height,
          settings.blurAmount,
        );
        break;
      case "color":
        this.renderColorBackground(
          frame,
          mask,
          width,
          height,
          settings.backgroundColor,
        );
        break;
      case "image":
        this.renderImageBackground(frame, mask, width, height);
        break;
      case "transparent":
        this.renderTransparentBackground(frame, mask, width, height);
        break;
      default:
        this.outputCtx.drawImage(frame, 0, 0, width, height);
    }

    return createImageBitmap(this.outputCanvas!);
  }

  private async processFrameFast(
    _clipId: string,
    frame: ImageBitmap,
    width: number,
    height: number,
    settings: BackgroundRemovalSettings,
  ): Promise<ImageBitmap> {
    const segEngine = getPersonSegmentationEngine();
    const segResult = await segEngine.getPersonMask(frame);
    if (!segResult) return frame;

    if (settings.edgeBlur > 0 || settings.threshold !== 0.7) {
      const maskData = new ImageData(
        new Uint8ClampedArray(segResult.mask.data),
        segResult.mask.width,
        segResult.mask.height,
      );
      const thresholdByte = Math.round(settings.threshold * 255);
      const alphaData = maskData.data;
      for (let i = 3; i < alphaData.length; i += 4) {
        const raw = alphaData[i];
        alphaData[i] = raw >= thresholdByte ? 255 : Math.round(raw * (raw / thresholdByte));
      }
      this.maskCtx!.putImageData(maskData, 0, 0);
      if (settings.edgeBlur > 0) {
        this.maskCtx!.filter = `blur(${settings.edgeBlur}px)`;
        this.maskCtx!.drawImage(this.maskCanvas!, 0, 0);
        this.maskCtx!.filter = "none";
      }
    } else {
      this.maskCtx!.putImageData(segResult.mask, 0, 0);
    }

    this.outputCtx!.clearRect(0, 0, width, height);

    switch (settings.mode) {
      case "blur":
        this.outputCtx!.filter = `blur(${settings.blurAmount}px)`;
        this.outputCtx!.drawImage(frame, 0, 0, width, height);
        this.outputCtx!.filter = "none";
        break;
      case "color":
        this.outputCtx!.fillStyle = settings.backgroundColor;
        this.outputCtx!.fillRect(0, 0, width, height);
        break;
      case "image":
        if (this.backgroundImage) {
          this.outputCtx!.drawImage(this.backgroundImage, 0, 0, width, height);
        } else {
          this.outputCtx!.fillStyle = "#000000";
          this.outputCtx!.fillRect(0, 0, width, height);
        }
        break;
      case "transparent":
        break;
      default:
        this.outputCtx!.drawImage(frame, 0, 0, width, height);
        return createImageBitmap(this.outputCanvas!);
    }

    this.ctx!.clearRect(0, 0, width, height);
    this.ctx!.drawImage(frame, 0, 0, width, height);
    this.ctx!.globalCompositeOperation = "destination-in";
    this.ctx!.drawImage(this.maskCanvas!, 0, 0, width, height);
    this.ctx!.globalCompositeOperation = "source-over";

    this.outputCtx!.drawImage(this.canvas!, 0, 0);

    return createImageBitmap(this.outputCanvas!);
  }

  private generateSimpleMask(
    imageData: ImageData,
    _threshold: number,
  ): ImageData {
    const { data, width, height } = imageData;
    const mask = new ImageData(width, height);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const saturation = this.calculateSaturation(r, g, b);

      const isForeground =
        luminance > 0.1 && luminance < 0.95 && saturation > 0.05;

      const alpha = isForeground ? 255 : 0;
      mask.data[i] = alpha;
      mask.data[i + 1] = alpha;
      mask.data[i + 2] = alpha;
      mask.data[i + 3] = 255;
    }

    return this.refineMask(mask, 3);
  }

  private calculateSaturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0) return 0;
    return (max - min) / max;
  }

  private refineMask(mask: ImageData, iterations: number): ImageData {
    const { width, height } = mask;
    const result = new ImageData(
      new Uint8ClampedArray(mask.data),
      width,
      height,
    );

    for (let iter = 0; iter < iterations; iter++) {
      const temp = new Uint8ClampedArray(result.data);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;

          let sum = 0;
          let count = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nIdx = ((y + dy) * width + (x + dx)) * 4;
              sum += temp[nIdx];
              count++;
            }
          }

          const avg = sum / count;
          result.data[idx] = avg > 127 ? 255 : 0;
          result.data[idx + 1] = result.data[idx];
          result.data[idx + 2] = result.data[idx];
        }
      }
    }

    return result;
  }

  private applyEdgeBlur(mask: ImageData, radius: number): void {
    const { data, width, height } = mask;
    const temp = new Uint8ClampedArray(data);

    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        const idx = (y * width + x) * 4;

        let sum = 0;
        let count = 0;

        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            sum += temp[nIdx];
            count++;
          }
        }

        data[idx] = sum / count;
        data[idx + 1] = data[idx];
        data[idx + 2] = data[idx];
      }
    }
  }

  private async renderBlurBackground(
    frame: ImageBitmap,
    mask: ImageData,
    width: number,
    height: number,
    blurAmount: number,
  ): Promise<void> {
    if (!this.outputCtx) return;

    this.outputCtx.filter = `blur(${blurAmount}px)`;
    this.outputCtx.drawImage(frame, 0, 0, width, height);
    this.outputCtx.filter = "none";

    const blurredData = this.outputCtx.getImageData(0, 0, width, height);
    this.ctx!.drawImage(frame, 0, 0, width, height);
    const originalData = this.ctx!.getImageData(0, 0, width, height);

    for (let i = 0; i < mask.data.length; i += 4) {
      const alpha = mask.data[i] / 255;
      blurredData.data[i] =
        originalData.data[i] * alpha + blurredData.data[i] * (1 - alpha);
      blurredData.data[i + 1] =
        originalData.data[i + 1] * alpha +
        blurredData.data[i + 1] * (1 - alpha);
      blurredData.data[i + 2] =
        originalData.data[i + 2] * alpha +
        blurredData.data[i + 2] * (1 - alpha);
      blurredData.data[i + 3] = 255;
    }

    this.outputCtx.putImageData(blurredData, 0, 0);
  }

  private renderColorBackground(
    frame: ImageBitmap,
    mask: ImageData,
    width: number,
    height: number,
    color: string,
  ): void {
    if (!this.outputCtx) return;

    this.outputCtx.fillStyle = color;
    this.outputCtx.fillRect(0, 0, width, height);

    this.ctx!.drawImage(frame, 0, 0, width, height);
    const originalData = this.ctx!.getImageData(0, 0, width, height);
    const outputData = this.outputCtx.getImageData(0, 0, width, height);

    for (let i = 0; i < mask.data.length; i += 4) {
      const alpha = mask.data[i] / 255;
      outputData.data[i] =
        originalData.data[i] * alpha + outputData.data[i] * (1 - alpha);
      outputData.data[i + 1] =
        originalData.data[i + 1] * alpha + outputData.data[i + 1] * (1 - alpha);
      outputData.data[i + 2] =
        originalData.data[i + 2] * alpha + outputData.data[i + 2] * (1 - alpha);
      outputData.data[i + 3] = 255;
    }

    this.outputCtx.putImageData(outputData, 0, 0);
  }

  private renderImageBackground(
    frame: ImageBitmap,
    mask: ImageData,
    width: number,
    height: number,
  ): void {
    if (!this.outputCtx || !this.backgroundImage) {
      this.renderColorBackground(frame, mask, width, height, "#000000");
      return;
    }

    this.outputCtx.drawImage(this.backgroundImage, 0, 0, width, height);

    this.ctx!.drawImage(frame, 0, 0, width, height);
    const originalData = this.ctx!.getImageData(0, 0, width, height);
    const outputData = this.outputCtx.getImageData(0, 0, width, height);

    for (let i = 0; i < mask.data.length; i += 4) {
      const alpha = mask.data[i] / 255;
      outputData.data[i] =
        originalData.data[i] * alpha + outputData.data[i] * (1 - alpha);
      outputData.data[i + 1] =
        originalData.data[i + 1] * alpha + outputData.data[i + 1] * (1 - alpha);
      outputData.data[i + 2] =
        originalData.data[i + 2] * alpha + outputData.data[i + 2] * (1 - alpha);
      outputData.data[i + 3] = 255;
    }

    this.outputCtx.putImageData(outputData, 0, 0);
  }

  private renderTransparentBackground(
    frame: ImageBitmap,
    mask: ImageData,
    width: number,
    height: number,
  ): void {
    if (!this.outputCtx) return;

    this.ctx!.drawImage(frame, 0, 0, width, height);
    const originalData = this.ctx!.getImageData(0, 0, width, height);

    for (let i = 0; i < mask.data.length; i += 4) {
      originalData.data[i + 3] = mask.data[i];
    }

    this.outputCtx.putImageData(originalData, 0, 0);
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.outputCanvas = null;
    this.outputCtx = null;
    this.backgroundImage?.close();
    this.backgroundImage = null;
    this.settings.clear();
    this.initialized = false;
  }
}

let backgroundRemovalEngineInstance: BackgroundRemovalEngine | null = null;

export function getBackgroundRemovalEngine(): BackgroundRemovalEngine | null {
  return backgroundRemovalEngineInstance;
}

export function initializeBackgroundRemovalEngine(): BackgroundRemovalEngine {
  if (!backgroundRemovalEngineInstance) {
    backgroundRemovalEngineInstance = new BackgroundRemovalEngine();
  }
  return backgroundRemovalEngineInstance;
}

export function disposeBackgroundRemovalEngine(): void {
  if (backgroundRemovalEngineInstance) {
    backgroundRemovalEngineInstance.dispose();
    backgroundRemovalEngineInstance = null;
  }
}
