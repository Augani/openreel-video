import type {
  DecodeRequest,
  DecodeResponse,
  WorkerResponse,
} from "./decode-worker";
import { createDecodeWorkerUrl } from "./decode-worker";
import { getRecommendedWorkerCount } from "../device/device-capabilities";

interface FrameDecodeRequest {
  clipId: string;
  blob: Blob;
  time: number;
  width: number;
  height: number;
}

interface FrameDecodeResult {
  clipId: string;
  bitmap: ImageBitmap | null;
  time: number;
  error?: string;
}

interface PendingRequest {
  resolve: (result: FrameDecodeResult) => void;
  reject: (error: Error) => void;
  clipId: string;
  startTime: number;
}

interface WorkerState {
  worker: Worker;
  workerId: number;
  busy: boolean;
  pendingRequests: Map<string, PendingRequest>;
  totalDecodes: number;
  totalDecodeTime: number;
  mediabunnyAvailable: boolean;
}

interface ParallelDecoderStats {
  workerCount: number;
  totalDecodes: number;
  averageDecodeTime: number;
  pendingRequests: number;
  cacheHits: number;
  cacheMisses: number;
}

export class ParallelFrameDecoder {
  private workers: WorkerState[] = [];
  private workerUrls: string[] = [];
  private requestQueue: Array<{
    request: FrameDecodeRequest;
    resolve: (result: FrameDecodeResult) => void;
    reject: (error: Error) => void;
  }> = [];
  private frameCache: Map<string, { bitmap: ImageBitmap; timestamp: number }> =
    new Map();
  private maxCacheSize = 100;
  private cacheHits = 0;
  private cacheMisses = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private requestIdCounter = 0;
  private mediabunnyAvailable = false;

  constructor(private workerCount: number = 4) {
    this.workerCount = Math.max(
      1,
      Math.min(workerCount, navigator.hardwareConcurrency || 4),
    );
  }

  isAvailable(): boolean {
    return this.initialized && this.mediabunnyAvailable;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const workerPromises: Promise<WorkerState>[] = [];

    for (let i = 0; i < this.workerCount; i++) {
      workerPromises.push(this.createWorker(i));
    }

    // Hardware decoder sessions are limited, so tolerate some workers failing.
    const results = await Promise.allSettled(workerPromises);
    this.workers = results
      .filter((r): r is PromiseFulfilledResult<WorkerState> => r.status === "fulfilled")
      .map((r) => r.value);
    if (this.workers.length === 0) {
      const failed = results.find((r) => r.status === "rejected");
      throw failed && failed.status === "rejected"
        ? failed.reason
        : new Error("No decode workers could be created");
    }
    this.mediabunnyAvailable = this.workers.some((w) => w.mediabunnyAvailable);
    this.initialized = true;
  }

  private async createWorker(index: number): Promise<WorkerState> {
    return new Promise((resolve, reject) => {
      const workerUrl = createDecodeWorkerUrl();
      this.workerUrls.push(workerUrl);

      const worker = new Worker(workerUrl, { type: "module" });

      const state: WorkerState = {
        worker,
        workerId: index,
        busy: false,
        pendingRequests: new Map(),
        totalDecodes: 0,
        totalDecodeTime: 0,
        mediabunnyAvailable: false,
      };

      let ready = false;
      // A worker that never became ready is unusable: terminate it and free its blob URL.
      const abandon = () => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        const at = this.workerUrls.indexOf(workerUrl);
        if (at !== -1) this.workerUrls.splice(at, 1);
      };

      const initTimeout = setTimeout(() => {
        abandon();
        reject(new Error(`Worker ${index} initialization timed out`));
      }, 10000);

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;

        if (response.type === "ready") {
          clearTimeout(initTimeout);
          ready = true;
          state.workerId = response.workerId;
          state.mediabunnyAvailable = response.mediabunnyAvailable ?? false;
          if (state.mediabunnyAvailable) {
          } else {
          }
          resolve(state);
          return;
        }

        if (response.type === "decoded") {
          this.handleDecodeResponse(state, response);
        }
      };

      worker.onerror = (error) => {
        console.error(`[ParallelFrameDecoder] Worker ${index} error:`, error);
        clearTimeout(initTimeout);
        if (!ready) abandon();
        reject(error);
      };

      worker.postMessage({ type: "init" });
    });
  }

  private async handleDecodeResponse(
    state: WorkerState,
    response: DecodeResponse,
  ): Promise<void> {
    const pending = state.pendingRequests.get(response.requestId);
    if (!pending) {
      console.warn(
        `[ParallelFrameDecoder] No pending request for ${response.requestId}`,
      );
      return;
    }

    state.pendingRequests.delete(response.requestId);
    state.busy = state.pendingRequests.size > 0;

    const decodeTime = performance.now() - pending.startTime;
    state.totalDecodes++;
    state.totalDecodeTime += decodeTime;

    let bitmapForCaller: ImageBitmap | null = null;

    if (response.bitmap) {
      const cacheKey = `${response.clipId}:${response.time.toFixed(3)}`;
      this.addToCache(cacheKey, response.bitmap);
      try {
        bitmapForCaller = await createImageBitmap(response.bitmap);
      } catch {
        bitmapForCaller = null;
      }
    }

    pending.resolve({
      clipId: response.clipId,
      bitmap: bitmapForCaller,
      time: response.time,
      error: response.error,
    });

    this.processQueue();
  }

  private addToCache(key: string, bitmap: ImageBitmap): void {
    if (this.frameCache.size >= this.maxCacheSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.frameCache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        const old = this.frameCache.get(oldestKey);
        old?.bitmap.close();
        this.frameCache.delete(oldestKey);
      }
    }

    this.frameCache.set(key, { bitmap, timestamp: performance.now() });
  }

  private async getFromCache(
    clipId: string,
    time: number,
  ): Promise<ImageBitmap | null> {
    const cacheKey = `${clipId}:${time.toFixed(3)}`;
    const cached = this.frameCache.get(cacheKey);

    if (cached) {
      cached.timestamp = performance.now();
      this.cacheHits++;
      try {
        return await createImageBitmap(cached.bitmap);
      } catch {
        this.frameCache.delete(cacheKey);
        return null;
      }
    }

    this.cacheMisses++;
    return null;
  }

  private getLeastBusyWorker(): WorkerState | null {
    let leastBusy: WorkerState | null = null;
    let minPending = Infinity;

    for (const worker of this.workers) {
      if (worker.pendingRequests.size < minPending) {
        minPending = worker.pendingRequests.size;
        leastBusy = worker;
      }
    }

    return leastBusy;
  }

  private processQueue(): void {
    while (this.requestQueue.length > 0) {
      const worker = this.getLeastBusyWorker();
      if (!worker || worker.pendingRequests.size >= 2) {
        break;
      }

      const item = this.requestQueue.shift();
      if (item) {
        this.sendDecodeRequest(worker, item.request, item.resolve, item.reject);
      }
    }
  }

  private sendDecodeRequest(
    worker: WorkerState,
    request: FrameDecodeRequest,
    resolve: (result: FrameDecodeResult) => void,
    reject: (error: Error) => void,
  ): void {
    const requestId = `req_${this.requestIdCounter++}`;

    const pending: PendingRequest = {
      resolve,
      reject,
      clipId: request.clipId,
      startTime: performance.now(),
    };

    worker.pendingRequests.set(requestId, pending);
    worker.busy = true;

    const decodeRequest: DecodeRequest = {
      type: "decode",
      requestId,
      clipId: request.clipId,
      blob: request.blob,
      time: request.time,
      width: request.width,
      height: request.height,
    };

    worker.worker.postMessage(decodeRequest);
  }

  async decodeFrame(request: FrameDecodeRequest): Promise<FrameDecodeResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const cached = await this.getFromCache(request.clipId, request.time);
    if (cached) {
      return {
        clipId: request.clipId,
        bitmap: cached,
        time: request.time,
      };
    }

    return new Promise((resolve, reject) => {
      const worker = this.getLeastBusyWorker();

      if (worker && worker.pendingRequests.size < 2) {
        this.sendDecodeRequest(worker, request, resolve, reject);
      } else {
        this.requestQueue.push({ request, resolve, reject });
      }
    });
  }

  async decodeFrames(
    requests: FrameDecodeRequest[],
  ): Promise<Map<string, FrameDecodeResult>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const results = new Map<string, FrameDecodeResult>();
    const pending: Promise<FrameDecodeResult>[] = [];

    for (const request of requests) {
      pending.push(this.decodeFrame(request));
    }

    const resolved = await Promise.all(pending);
    for (const result of resolved) {
      results.set(result.clipId, result);
    }

    return results;
  }

  async decodeClipsAtTime(
    clips: Array<{ clipId: string; blob: Blob; time: number }>,
    width: number,
    height: number,
  ): Promise<Map<string, ImageBitmap>> {
    const requests: FrameDecodeRequest[] = clips.map((clip) => ({
      clipId: clip.clipId,
      blob: clip.blob,
      time: clip.time,
      width,
      height,
    }));

    const results = await this.decodeFrames(requests);
    const bitmaps = new Map<string, ImageBitmap>();

    for (const [clipId, result] of results) {
      if (result.bitmap) {
        bitmaps.set(clipId, result.bitmap);
      }
    }

    return bitmaps;
  }

  getStats(): ParallelDecoderStats {
    let totalDecodes = 0;
    let totalTime = 0;
    let pendingCount = 0;

    for (const worker of this.workers) {
      totalDecodes += worker.totalDecodes;
      totalTime += worker.totalDecodeTime;
      pendingCount += worker.pendingRequests.size;
    }

    return {
      workerCount: this.workers.length,
      totalDecodes,
      averageDecodeTime: totalDecodes > 0 ? totalTime / totalDecodes : 0,
      pendingRequests: pendingCount + this.requestQueue.length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  clearCache(): void {
    for (const [, cached] of this.frameCache) {
      cached.bitmap.close();
    }
    this.frameCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  dispose(): void {
    for (const worker of this.workers) {
      for (const [, pending] of worker.pendingRequests) {
        pending.reject(new Error("Decoder disposed"));
      }
      worker.worker.terminate();
    }
    this.workers = [];

    for (const url of this.workerUrls) {
      URL.revokeObjectURL(url);
    }
    this.workerUrls = [];

    this.clearCache();

    for (const item of this.requestQueue) {
      item.reject(new Error("Decoder disposed"));
    }
    this.requestQueue = [];

    this.initialized = false;
    this.initPromise = null;
  }
}

let parallelDecoderInstance: ParallelFrameDecoder | null = null;

export function getParallelFrameDecoder(): ParallelFrameDecoder {
  if (!parallelDecoderInstance) {
    const workerCount = getRecommendedWorkerCount("decode");
    parallelDecoderInstance = new ParallelFrameDecoder(workerCount);
  }
  return parallelDecoderInstance;
}
