import {
  ImageSegmenter,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

export interface SegmentationResult {
  mask: ImageData;
  width: number;
  height: number;
}

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export class PersonSegmentationEngine {
  private segmenter: ImageSegmenter | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private cachedMask: SegmentationResult | null = null;
  private lastSegmentTime = 0;
  private segmentInterval = 66;
  private segCanvas: HTMLCanvasElement | null = null;
  private segCtx: CanvasRenderingContext2D | null = null;
  private upscaleCanvas: HTMLCanvasElement | null = null;
  private upscaleCtx: CanvasRenderingContext2D | null = null;
  private readonly SEG_WIDTH = 512;
  private readonly SEG_HEIGHT = 288;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.doInitialize();
    try {
      await this.initializing;
    } catch (error) {
      this.initializing = null;
      throw error;
    }
  }

  private async doInitialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
    );

    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });

    this.segCanvas = document.createElement("canvas");
    this.segCanvas.width = this.SEG_WIDTH;
    this.segCanvas.height = this.SEG_HEIGHT;
    this.segCtx = this.segCanvas.getContext("2d", { willReadFrequently: true });

    this.upscaleCanvas = document.createElement("canvas");
    this.upscaleCtx = this.upscaleCanvas.getContext("2d", { willReadFrequently: true });

    this.initialized = true;
    this.initializing = null;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setSegmentInterval(ms: number): void {
    this.segmentInterval = Math.max(16, ms);
  }

  async getPersonMask(frame: ImageBitmap): Promise<SegmentationResult | null> {
    if (!this.segmenter) return null;

    const now = performance.now();
    if (this.cachedMask && now - this.lastSegmentTime < this.segmentInterval) {
      return this.cachedMask;
    }

    const outputWidth = frame.width;
    const outputHeight = frame.height;

    if (!this.segCtx || !this.segCanvas) return null;

    this.segCtx.drawImage(frame, 0, 0, this.SEG_WIDTH, this.SEG_HEIGHT);

    let rawMask: Float32Array | null = null;

    this.segmenter.segmentForVideo(this.segCanvas, Math.round(now), (result) => {
      if (result.confidenceMasks && result.confidenceMasks.length > 0) {
        const labels = this.segmenter?.getLabels() ?? [];
        const personLabelIndex = labels.findIndex((label) =>
          /foreground|human|person|selfie/i.test(label),
        );
        const foregroundMaskIndex =
          personLabelIndex >= 0 && personLabelIndex < result.confidenceMasks.length
            ? personLabelIndex
            : result.confidenceMasks.length > 1
              ? result.confidenceMasks.length - 1
              : 0;
        const foregroundMask =
          result.confidenceMasks[foregroundMaskIndex] ?? result.confidenceMasks[0];
        rawMask = new Float32Array(foregroundMask.getAsFloat32Array());

        for (const confidenceMask of result.confidenceMasks) {
          confidenceMask.close();
        }
      }
    });

    if (!rawMask) return this.cachedMask;

    const segMaskData = new ImageData(this.SEG_WIDTH, this.SEG_HEIGHT);
    for (let i = 0; i < (rawMask as Float32Array).length; i++) {
      const alpha = Math.round((rawMask as Float32Array)[i] * 255);
      segMaskData.data[i * 4] = 255;
      segMaskData.data[i * 4 + 1] = 255;
      segMaskData.data[i * 4 + 2] = 255;
      segMaskData.data[i * 4 + 3] = alpha;
    }

    if (
      !this.upscaleCanvas || !this.upscaleCtx ||
      this.upscaleCanvas.width !== outputWidth ||
      this.upscaleCanvas.height !== outputHeight
    ) {
      this.upscaleCanvas!.width = outputWidth;
      this.upscaleCanvas!.height = outputHeight;
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = this.SEG_WIDTH;
    tempCanvas.height = this.SEG_HEIGHT;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(segMaskData, 0, 0);

    this.upscaleCtx!.imageSmoothingEnabled = true;
    this.upscaleCtx!.imageSmoothingQuality = "high";
    this.upscaleCtx!.clearRect(0, 0, outputWidth, outputHeight);
    this.upscaleCtx!.drawImage(tempCanvas, 0, 0, outputWidth, outputHeight);

    const maskData = this.upscaleCtx!.getImageData(0, 0, outputWidth, outputHeight);

    this.refineEdges(maskData);

    this.cachedMask = { mask: maskData, width: outputWidth, height: outputHeight };
    this.lastSegmentTime = now;
    return this.cachedMask;
  }

  private refineEdges(mask: ImageData): void {
    const { data, width, height } = mask;
    const radius = 2;
    const temp = new Uint8ClampedArray(width * height);

    for (let i = 0; i < data.length; i += 4) {
      temp[i >> 2] = data[i + 3];
    }

    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        const idx = y * width + x;
        const center = temp[idx];

        if (center === 0 || center === 255) continue;

        let sum = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            sum += temp[(y + dy) * width + (x + dx)];
            count++;
          }
        }
        const smoothed = sum / count;

        const contrast = smoothed < 128
          ? smoothed * smoothed / 128
          : 255 - (255 - smoothed) * (255 - smoothed) / 128;

        data[(idx) * 4 + 3] = Math.round(contrast);
      }
    }
  }

  dispose(): void {
    if (this.segmenter) {
      this.segmenter.close();
      this.segmenter = null;
    }
    this.segCanvas = null;
    this.segCtx = null;
    this.upscaleCanvas = null;
    this.upscaleCtx = null;
    this.cachedMask = null;
    this.initialized = false;
    this.initializing = null;
  }
}

let instance: PersonSegmentationEngine | null = null;

export function getPersonSegmentationEngine(): PersonSegmentationEngine {
  if (!instance) {
    instance = new PersonSegmentationEngine();
  }
  return instance;
}

export function disposePersonSegmentationEngine(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
