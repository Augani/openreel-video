import type { FlowField, InterpolationConfig, FrameInterpolationResult } from "./types";
import { INTERPOLATION_QUALITY_PRESETS } from "./types";
import { OpticalFlowGPU } from "./optical-flow-gpu";
import { OpticalFlowCPU } from "./optical-flow-cpu";
import { FlowFieldCache } from "./flow-field-cache";

export class FrameInterpolationEngine {
  private gpuFlow: OpticalFlowGPU | null = null;
  private cpuFlow: OpticalFlowCPU;
  private cache: FlowFieldCache;
  private config: InterpolationConfig;
  private gpuReady: boolean = false;
  private initPromise: Promise<void> | null = null;
  private budgetExceeded: boolean = false;
  private frameBudgetMs: number = 16;

  constructor(quality: "low" | "medium" | "high" = "medium") {
    this.config = INTERPOLATION_QUALITY_PRESETS[quality];
    this.cpuFlow = new OpticalFlowCPU(this.config);
    this.cache = new FlowFieldCache(10);
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.gpuFlow = new OpticalFlowGPU(this.config);
      this.gpuReady = await this.gpuFlow.initialize();
      if (!this.gpuReady) {
        this.gpuFlow = null;
      }
    })();

    return this.initPromise;
  }

  setQuality(quality: "low" | "medium" | "high"): void {
    if (this.config.quality === quality) return;
    this.config = INTERPOLATION_QUALITY_PRESETS[quality];
    this.cpuFlow = new OpticalFlowCPU(this.config);
    if (this.gpuFlow) {
      this.gpuFlow.dispose();
      this.gpuFlow = new OpticalFlowGPU(this.config);
      this.gpuFlow.initialize().then((ready) => {
        this.gpuReady = ready;
        if (!ready) this.gpuFlow = null;
      });
    }
    this.cache.clear();
  }

  setFrameBudget(ms: number): void {
    this.frameBudgetMs = ms;
  }

  resetBudget(): void {
    this.budgetExceeded = false;
  }

  async interpolate(
    frame1: ImageBitmap,
    frame2: ImageBitmap,
    t: number,
    mediaId: string,
    timeBefore: number,
    timeAfter: number,
  ): Promise<FrameInterpolationResult> {
    const startTime = performance.now();

    if (this.budgetExceeded) {
      return this.simpleBlend(frame1, frame2, t, startTime);
    }

    try {
      const cacheKey = FlowFieldCache.makeKey(mediaId, timeBefore, timeAfter);
      let flowField = this.cache.get(cacheKey);

      const width = frame1.width;
      const height = frame1.height;

      if (!flowField) {
        const { data1, data2 } = this.extractPixelData(frame1, frame2);

        if (this.gpuReady && this.gpuFlow) {
          const pixels1 = new Uint32Array(data1.buffer);
          const pixels2 = new Uint32Array(data2.buffer);
          flowField = await this.gpuFlow.computeFlowField(
            pixels1,
            pixels2,
            width,
            height,
          );
        } else {
          const imgData1 = new ImageData(data1.slice(0) as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
          const imgData2 = new ImageData(data2.slice(0) as unknown as Uint8ClampedArray<ArrayBuffer>, width, height);
          flowField = await this.cpuFlow.computeFlowField(imgData1, imgData2);
        }

        this.cache.set(cacheKey, flowField);
      }

      const result = await this.warpFrames(
        frame1,
        frame2,
        flowField,
        width,
        height,
        t,
      );

      const computeTimeMs = performance.now() - startTime;

      if (computeTimeMs > this.frameBudgetMs * 2) {
        this.budgetExceeded = true;
      }

      return { frame: result, computeTimeMs, method: "optical-flow" };
    } catch {
      return this.simpleBlend(frame1, frame2, t, startTime);
    }
  }

  private extractPixelData(
    frame1: ImageBitmap,
    frame2: ImageBitmap,
  ): { data1: Uint8ClampedArray; data2: Uint8ClampedArray } {
    const canvas = new OffscreenCanvas(frame1.width, frame1.height);
    const ctx = canvas.getContext("2d")!;

    ctx.drawImage(frame1, 0, 0);
    const data1 = ctx.getImageData(0, 0, frame1.width, frame1.height).data;

    ctx.drawImage(frame2, 0, 0);
    const data2 = ctx.getImageData(0, 0, frame2.width, frame2.height).data;

    return { data1, data2 };
  }

  private async warpFrames(
    frame1: ImageBitmap,
    frame2: ImageBitmap,
    flowField: FlowField,
    width: number,
    height: number,
    t: number,
  ): Promise<ImageBitmap> {
    if (this.gpuReady && this.gpuFlow) {
      const { data1, data2 } = this.extractPixelData(frame1, frame2);
      const pixels1 = new Uint32Array(data1.buffer);
      const pixels2 = new Uint32Array(data2.buffer);

      const resultPixels = await this.gpuFlow.warpAndBlend(
        pixels1,
        pixels2,
        flowField,
        width,
        height,
        t,
      );

      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      const imageData = ctx.createImageData(width, height);
      new Uint32Array(imageData.data.buffer).set(resultPixels);
      ctx.putImageData(imageData, 0, 0);
      return canvas.transferToImageBitmap();
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    ctx.drawImage(frame1, 0, 0);
    const imgData1 = ctx.getImageData(0, 0, width, height);
    ctx.drawImage(frame2, 0, 0);
    const imgData2 = ctx.getImageData(0, 0, width, height);

    const result = this.cpuFlow.warpAndBlend(imgData1, imgData2, flowField, t);
    ctx.putImageData(result, 0, 0);
    return canvas.transferToImageBitmap();
  }

  private async simpleBlend(
    frame1: ImageBitmap,
    frame2: ImageBitmap,
    t: number,
    startTime: number,
  ): Promise<FrameInterpolationResult> {
    const canvas = new OffscreenCanvas(frame1.width, frame1.height);
    const ctx = canvas.getContext("2d")!;

    ctx.globalAlpha = 1 - t;
    ctx.drawImage(frame1, 0, 0);
    ctx.globalAlpha = t;
    ctx.drawImage(frame2, 0, 0);
    ctx.globalAlpha = 1;

    const frame = canvas.transferToImageBitmap();
    return {
      frame,
      computeTimeMs: performance.now() - startTime,
      method: "blend",
    };
  }

  dispose(): void {
    this.gpuFlow?.dispose();
    this.gpuFlow = null;
    this.cache.clear();
  }
}

let interpolationEngineInstance: FrameInterpolationEngine | null = null;

export function getFrameInterpolationEngine(): FrameInterpolationEngine {
  if (!interpolationEngineInstance) {
    interpolationEngineInstance = new FrameInterpolationEngine();
    interpolationEngineInstance.initialize();
  }
  return interpolationEngineInstance;
}

export function disposeFrameInterpolationEngine(): void {
  interpolationEngineInstance?.dispose();
  interpolationEngineInstance = null;
}
