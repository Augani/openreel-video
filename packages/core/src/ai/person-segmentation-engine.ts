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
      runningMode: "IMAGE",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });

    this.initialized = true;
    this.initializing = null;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async getPersonMask(frame: ImageBitmap): Promise<SegmentationResult | null> {
    if (!this.segmenter) return null;

    const width = frame.width;
    const height = frame.height;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(frame, 0, 0);

    let maskData: ImageData | null = null;

    this.segmenter.segment(canvas, (result) => {
      if (result.confidenceMasks && result.confidenceMasks.length > 0) {
        // Selfie segmentation models may return background first and person
        // second. Prefer the foreground/person mask when it is available.
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
        const mask = foregroundMask.getAsFloat32Array();
        maskData = new ImageData(width, height);

        for (let i = 0; i < mask.length; i++) {
          const confidence = mask[i];
          const alpha = Math.round(confidence * 255);
          maskData.data[i * 4] = 255;
          maskData.data[i * 4 + 1] = 255;
          maskData.data[i * 4 + 2] = 255;
          maskData.data[i * 4 + 3] = alpha;
        }

        for (const confidenceMask of result.confidenceMasks) {
          confidenceMask.close();
        }
      }
    });

    if (!maskData) return null;

    return { mask: maskData, width, height };
  }

  dispose(): void {
    if (this.segmenter) {
      this.segmenter.close();
      this.segmenter = null;
    }
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
