import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PersonSegmentationEngine,
  type SegmentationResult,
} from "./person-segmentation-engine";
import type {
  SegmentationWorkerFrameRequest,
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
} from "./person-segmentation-protocol";

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class FakeWorker {
  static latest: FakeWorker | null = null;

  onmessage: ((event: MessageEvent<SegmentationWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly frameRequests: SegmentationWorkerFrameRequest[] = [];

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(request: SegmentationWorkerRequest): void {
    if (request.type === "init") {
      queueMicrotask(() => this.emit({ type: "ready" }));
      return;
    }
    if (request.type === "segment") this.frameRequests.push(request);
  }

  terminate(): void {}

  emitResult(request: SegmentationWorkerFrameRequest): void {
    this.emit({
      type: "result",
      requestId: request.requestId,
      streamId: request.streamId,
      timestampMs: request.timestampMs,
      width: 1,
      height: 1,
      alpha: new Uint8ClampedArray([255]),
      referenceRgba: new Uint8ClampedArray([20, 30, 40, 255]),
      referenceWidth: 1,
      referenceHeight: 1,
    });
  }

  private emit(response: SegmentationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<SegmentationWorkerResponse>);
  }
}

const frame = (): ImageBitmap =>
  ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap;

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("PersonSegmentationEngine realtime matte alignment", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("ImageData", TestImageData);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => frame()));
  });

  afterEach(() => {
    FakeWorker.latest = null;
    vi.unstubAllGlobals();
  });

  const initialize = async (): Promise<{
    engine: PersonSegmentationEngine;
    worker: FakeWorker;
  }> => {
    const engine = new PersonSegmentationEngine();
    await engine.initialize();
    const worker = FakeWorker.latest;
    if (!worker) throw new Error("Fake worker was not created");
    return { engine, worker };
  };

  it("preserves the exact source timestamp on a segmentation result", async () => {
    const { engine, worker } = await initialize();
    const resultPromise = engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_250,
    });
    await flushMicrotasks();
    worker.emitResult(worker.frameRequests[0]);

    const result = (await resultPromise) as SegmentationResult;
    expect(result.timestampMs).toBe(1_250);
    engine.dispose();
  });

  it("keeps the latest matte visible while realtime inference catches up", async () => {
    const { engine, worker } = await initialize();
    expect(
      await engine.getPersonMask(frame(), {
        streamId: "clip:a",
        timestampMs: 1_000,
        realtime: true,
      }),
    ).toBeNull();
    await flushMicrotasks();
    worker.emitResult(worker.frameRequests[0]);

    const recent = await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_100,
      realtime: true,
    });
    expect(recent?.timestampMs).toBe(1_000);

    const delayed = await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_301,
      realtime: true,
    });
    expect(delayed?.timestampMs).toBe(1_000);

    const stillDelayed = await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_600,
      realtime: true,
    });
    expect(stillDelayed?.timestampMs).toBe(1_000);
    engine.dispose();
  });

  it("never posts an older bitmap copy after a newer realtime frame", async () => {
    const copies: Array<ReturnType<typeof deferred<ImageBitmap>>> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const copy = deferred<ImageBitmap>();
        copies.push(copy);
        return copy.promise;
      }),
    );
    const { engine, worker } = await initialize();

    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_000,
      realtime: true,
    });
    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_030,
      realtime: true,
    });
    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_060,
      realtime: true,
    });

    const newestCopy = frame();
    copies[2].resolve(newestCopy);
    await flushMicrotasks();
    expect(worker.frameRequests.map((request) => request.timestampMs)).toEqual([
      1_060,
    ]);

    const oldestCopy = frame();
    copies[0].resolve(oldestCopy);
    await flushMicrotasks();
    expect(oldestCopy.close).toHaveBeenCalledOnce();

    const middleCopy = frame();
    copies[1].resolve(middleCopy);
    await flushMicrotasks();
    expect(middleCopy.close).toHaveBeenCalledOnce();
    expect(worker.frameRequests.map((request) => request.timestampMs)).toEqual([
      1_060,
    ]);
    engine.dispose();
  });

  it("keeps the newest queued copy while another frame is in flight", async () => {
    const copies: Array<ReturnType<typeof deferred<ImageBitmap>>> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const copy = deferred<ImageBitmap>();
        copies.push(copy);
        return copy.promise;
      }),
    );
    const { engine, worker } = await initialize();

    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_000,
      realtime: true,
    });
    const firstCopy = frame();
    copies[0].resolve(firstCopy);
    await flushMicrotasks();

    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_030,
      realtime: true,
    });
    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_060,
      realtime: true,
    });
    const newestCopy = frame();
    copies[2].resolve(newestCopy);
    await flushMicrotasks();
    const middleCopy = frame();
    copies[1].resolve(middleCopy);
    await flushMicrotasks();
    expect(middleCopy.close).toHaveBeenCalledOnce();

    worker.emitResult(worker.frameRequests[0]);
    await flushMicrotasks();
    expect(worker.frameRequests.map((request) => request.timestampMs)).toEqual([
      1_000,
      1_060,
    ]);
    engine.dispose();
  });

  it("rejects an in-flight result from before a timeline discontinuity", async () => {
    const { engine, worker } = await initialize();
    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 1_000,
      realtime: true,
    });
    await flushMicrotasks();
    const oldRequest = worker.frameRequests[0];

    await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 2_000,
      realtime: true,
    });
    await flushMicrotasks();
    worker.emitResult(oldRequest);
    await flushMicrotasks();

    const currentRequest = worker.frameRequests[1];
    expect(currentRequest.timestampMs).toBe(2_000);
    expect(
      await engine.getPersonMask(frame(), {
        streamId: "clip:a",
        timestampMs: 2_001,
        realtime: true,
      }),
    ).toBeNull();

    worker.emitResult(currentRequest);
    const current = await engine.getPersonMask(frame(), {
      streamId: "clip:a",
      timestampMs: 2_030,
      realtime: true,
    });
    expect(current?.timestampMs).toBe(2_000);
    engine.dispose();
  });
});
