import type {
  SegmentationWorkerFrameRequest,
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
} from "./person-segmentation-protocol";

export { createMotionAwareOcclusionMask } from "./temporal-person-mask";

export interface SegmentationResult {
  mask: ImageData;
  width: number;
  height: number;
  /** Timeline timestamp of the exact source frame used for this matte. */
  timestampMs: number;
  /** Low-resolution source frame that produced this mask. */
  referenceRgba: Uint8ClampedArray;
  referenceWidth: number;
  referenceHeight: number;
}

export interface PersonMaskOptions {
  /** Timeline/content time. Used for deterministic sampling and seek resets. */
  timestampMs?: number;
  /** Keeps unrelated clips and render pipelines from sharing temporal history. */
  streamId?: string;
  /** Returns the latest matte immediately while a new one runs off-thread. */
  realtime?: boolean;
}

interface QueuedFrame {
  bitmap: ImageBitmap;
  timestampMs: number;
  reset: boolean;
  generation: number;
}

interface ClientStreamState {
  cachedMask: SegmentationResult | null;
  inFlight: boolean;
  queuedFrame: QueuedFrame | null;
  lastRequestedTime: number;
  lastSeenTime: number;
  latestPostedTime: number;
  latestAcceptedTime: number;
  generation: number;
}

interface PendingRequest {
  streamId: string;
  timestampMs: number;
  generation: number;
  resolve?: (result: SegmentationResult | null) => void;
  reject?: (error: Error) => void;
}

const DEFAULT_STREAM_ID = "default";
const DISCONTINUITY_THRESHOLD_MS = 500;
const MAX_STREAM_STATES = 4;
// The high-quality multiclass model is substantially larger than the fast
// fallback. Allow its first uncached download to finish on slower connections.
const INITIALIZATION_TIMEOUT_MS = 45_000;

export class PersonSegmentationEngine {
  private worker: Worker | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private requestCounter = 0;
  private segmentInterval = 16;
  private streamStates = new Map<string, ClientStreamState>();
  private pendingRequests = new Map<number, PendingRequest>();

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
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      throw new Error("Background person segmentation is not supported");
    }

    // MediaPipe's WASM loader uses importScripts when it runs in a worker.
    // Keep this a classic worker: module workers do not expose importScripts
    // and make the loader fall back to a document-based path that cannot run
    // off the main thread. The worker entry deliberately has no runtime module
    // imports and loads MediaPipe's classic bundle with importScripts.
    const worker = new Worker(
      new URL("./person-segmentation-worker.ts", import.meta.url),
    );
    this.worker = worker;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Person segmentation worker initialization timed out"));
        }, INITIALIZATION_TIMEOUT_MS);

        worker.onmessage = (event: MessageEvent<SegmentationWorkerResponse>) => {
          if (event.data.type === "ready") {
            clearTimeout(timeout);
            this.initialized = true;
            this.initializing = null;
            resolve();
            return;
          }
          if (event.data.type === "error" && event.data.requestId === undefined) {
            clearTimeout(timeout);
            reject(new Error(event.data.message));
            return;
          }
          this.handleWorkerMessage(event.data);
        };

        worker.onerror = (event) => {
          clearTimeout(timeout);
          reject(new Error(event.message || "Person segmentation worker failed"));
        };

        const request: SegmentationWorkerRequest = { type: "init" };
        worker.postMessage(request);
      });
    } catch (error) {
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      this.initialized = false;
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setSegmentInterval(ms: number): void {
    this.segmentInterval = Math.max(16, ms);
  }

  async getPersonMask(
    frame: ImageBitmap,
    options: PersonMaskOptions = {},
  ): Promise<SegmentationResult | null> {
    if (!this.worker || !this.initialized) return null;

    const streamId = options.streamId ?? DEFAULT_STREAM_ID;
    const timestampMs = Number.isFinite(options.timestampMs)
      ? options.timestampMs!
      : performance.now();
    const state = this.getStreamState(streamId);
    const timeDelta = timestampMs - state.lastSeenTime;
    const reset =
      state.lastSeenTime !== Number.NEGATIVE_INFINITY &&
      (timeDelta < -1 || timeDelta > DISCONTINUITY_THRESHOLD_MS);
    if (reset) {
      state.cachedMask = null;
      state.queuedFrame?.bitmap.close();
      state.queuedFrame = null;
      state.lastRequestedTime = Number.NEGATIVE_INFINITY;
      state.latestPostedTime = Number.NEGATIVE_INFINITY;
      state.latestAcceptedTime = Number.NEGATIVE_INFINITY;
      state.generation++;
    }
    state.lastSeenTime = timestampMs;

    if (options.realtime) {
      if (
        timestampMs >= state.lastRequestedTime &&
        timestampMs - state.lastRequestedTime < this.segmentInterval
      ) {
        return this.getUsableRealtimeMask(state.cachedMask, timestampMs);
      }
      state.lastRequestedTime = timestampMs;
      this.queueRealtimeFrame(
        frame,
        streamId,
        timestampMs,
        reset,
        state.generation,
      );
      return this.getUsableRealtimeMask(state.cachedMask, timestampMs);
    }

    const bitmap = await createImageBitmap(frame);
    return new Promise<SegmentationResult | null>((resolve, reject) => {
      this.postFrame(
        bitmap,
        streamId,
        timestampMs,
        reset,
        state.generation,
        { resolve, reject },
      );
    });
  }

  private getUsableRealtimeMask(
    cachedMask: SegmentationResult | null,
    timestampMs: number,
  ): SegmentationResult | null {
    if (!cachedMask) return null;
    const ageMs = timestampMs - cachedMask.timestampMs;
    // During continuous playback, inference can legitimately take longer than
    // a few frames. Expiring the last good matte made the entire behind-subject
    // text layer switch off until the worker caught up. Stream changes and
    // seeks already clear cachedMask above, so retain it here and motion-warp it
    // to the displayed frame until a newer result is accepted.
    return ageMs >= -1 ? cachedMask : null;
  }

  private queueRealtimeFrame(
    frame: ImageBitmap,
    streamId: string,
    timestampMs: number,
    reset: boolean,
    generation: number,
  ): void {
    const state = this.getStreamState(streamId);
    void createImageBitmap(frame)
      .then((bitmap) => {
        if (!this.worker || !this.initialized) {
          bitmap.close();
          return;
        }
        if (state.generation !== generation) {
          bitmap.close();
          return;
        }
        // createImageBitmap() resolves asynchronously and copies for newer
        // frames can finish first. Never let a late, older copy rewind the
        // worker's temporal state or replace the newest queued frame.
        if (
          timestampMs <= state.latestPostedTime ||
          (state.queuedFrame !== null &&
            timestampMs <= state.queuedFrame.timestampMs)
        ) {
          bitmap.close();
          return;
        }
        if (state.inFlight) {
          state.queuedFrame?.bitmap.close();
          state.queuedFrame = {
            bitmap,
            timestampMs,
            reset,
            generation,
          };
          return;
        }
        this.postFrame(
          bitmap,
          streamId,
          timestampMs,
          reset,
          generation,
        );
      })
      .catch(() => {
        // Keep the latest good matte when a frame cannot be copied.
      });
  }

  private postFrame(
    bitmap: ImageBitmap,
    streamId: string,
    timestampMs: number,
    reset: boolean,
    generation: number,
    pending: Omit<
      PendingRequest,
      "streamId" | "timestampMs" | "generation"
    > = {},
  ): void {
    if (!this.worker) {
      bitmap.close();
      pending.resolve?.(null);
      return;
    }

    const state = this.getStreamState(streamId);
    state.inFlight = true;
    state.latestPostedTime = Math.max(state.latestPostedTime, timestampMs);
    const requestId = ++this.requestCounter;
    this.pendingRequests.set(requestId, {
      streamId,
      timestampMs,
      generation,
      ...pending,
    });
    const request: SegmentationWorkerFrameRequest = {
      type: "segment",
      requestId,
      streamId,
      timestampMs,
      bitmap,
      reset,
    };
    this.worker.postMessage(request, [bitmap]);
  }

  private handleWorkerMessage(response: SegmentationWorkerResponse): void {
    if (response.type === "ready") return;

    if (response.type === "error") {
      if (response.requestId === undefined) return;
      const pending = this.pendingRequests.get(response.requestId);
      if (!pending) return;
      this.pendingRequests.delete(response.requestId);
      const state = this.streamStates.get(pending.streamId);
      if (state) {
        state.inFlight = false;
        this.sendQueuedFrame(pending.streamId, state);
      }
      pending.reject?.(new Error(response.message));
      return;
    }

    const pending = this.pendingRequests.get(response.requestId);
    if (!pending) return;
    this.pendingRequests.delete(response.requestId);

    const state = this.streamStates.get(pending.streamId);
    const belongsToCurrentGeneration =
      !state || pending.generation === state.generation;
    const result = this.createSegmentationResult(
      response.alpha,
      response.width,
      response.height,
      response.timestampMs,
      response.referenceRgba,
      response.referenceWidth,
      response.referenceHeight,
    );
    if (state) {
      state.inFlight = false;
      if (
        belongsToCurrentGeneration &&
        response.timestampMs >= state.latestAcceptedTime
      ) {
        state.cachedMask = result;
        state.latestAcceptedTime = response.timestampMs;
      }
      this.sendQueuedFrame(pending.streamId, state);
    }
    pending.resolve?.(belongsToCurrentGeneration ? result : null);
  }

  private sendQueuedFrame(streamId: string, state: ClientStreamState): void {
    const queued = state.queuedFrame;
    if (!queued) return;
    state.queuedFrame = null;
    this.postFrame(
      queued.bitmap,
      streamId,
      queued.timestampMs,
      queued.reset,
      queued.generation,
    );
  }

  private createSegmentationResult(
    alpha: Uint8ClampedArray,
    width: number,
    height: number,
    timestampMs: number,
    referenceRgba: Uint8ClampedArray,
    referenceWidth: number,
    referenceHeight: number,
  ): SegmentationResult {
    const mask = new ImageData(width, height);
    for (let index = 0; index < alpha.length; index++) {
      const dataIndex = index * 4;
      mask.data[dataIndex] = 255;
      mask.data[dataIndex + 1] = 255;
      mask.data[dataIndex + 2] = 255;
      mask.data[dataIndex + 3] = alpha[index];
    }
    return {
      mask,
      width,
      height,
      timestampMs,
      referenceRgba,
      referenceWidth,
      referenceHeight,
    };
  }

  private getStreamState(streamId: string): ClientStreamState {
    const existing = this.streamStates.get(streamId);
    if (existing) {
      this.streamStates.delete(streamId);
      this.streamStates.set(streamId, existing);
      return existing;
    }

    while (this.streamStates.size >= MAX_STREAM_STATES) {
      const oldestStreamId = this.streamStates.keys().next().value;
      if (oldestStreamId === undefined) break;
      const oldest = this.streamStates.get(oldestStreamId);
      oldest?.queuedFrame?.bitmap.close();
      this.streamStates.delete(oldestStreamId);
    }
    const created: ClientStreamState = {
      cachedMask: null,
      inFlight: false,
      queuedFrame: null,
      lastRequestedTime: Number.NEGATIVE_INFINITY,
      lastSeenTime: Number.NEGATIVE_INFINITY,
      latestPostedTime: Number.NEGATIVE_INFINITY,
      latestAcceptedTime: Number.NEGATIVE_INFINITY,
      generation: 0,
    };
    this.streamStates.set(streamId, created);
    return created;
  }

  dispose(): void {
    if (this.worker) {
      const request: SegmentationWorkerRequest = { type: "dispose" };
      this.worker.postMessage(request);
      this.worker.terminate();
      this.worker = null;
    }
    for (const state of this.streamStates.values()) {
      state.queuedFrame?.bitmap.close();
    }
    for (const pending of this.pendingRequests.values()) {
      pending.reject?.(new Error("Person segmentation engine disposed"));
    }
    this.streamStates.clear();
    this.pendingRequests.clear();
    this.initialized = false;
    this.initializing = null;
  }
}

let instance: PersonSegmentationEngine | null = null;

export function getPersonSegmentationEngine(): PersonSegmentationEngine {
  if (!instance) instance = new PersonSegmentationEngine();
  return instance;
}

export function disposePersonSegmentationEngine(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
