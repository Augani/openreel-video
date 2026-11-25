import type { BezierPath } from "@openreel/core";
import type { ObjectTrackFrame, RGBAFrame, SegmentPrompt, SegmentResult } from "@openreel/core/video/object-mask/index";
import type { ObjectMaskWorkerReply, ObjectMaskWorkerRequest } from "../workers/object-mask-worker";

/**
 * Runs the (classical) segmenter and tracker off the main thread. The page decodes the footage and feeds frames
 * in; the worker holds the tracker state. Without Worker support it falls back to the same code in-thread, so a
 * machine learning segmenter can later replace the one in `object-mask-worker.ts` without touching callers.
 */
export interface ObjectMaskEngine {
  segment(image: RGBAFrame, prompt: SegmentPrompt): Promise<SegmentResult>;
  beginTrack(anchorImage: RGBAFrame, anchorPath: BezierPath): Promise<void>;
  step(frame: number, image: RGBAFrame): Promise<ObjectTrackFrame>;
  dispose(): void;
}

const copy = (image: RGBAFrame): RGBAFrame => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });

function createInThreadEngine(): ObjectMaskEngine {
  const core = import("@openreel/core/video/object-mask/index");
  let tracker: InstanceType<Awaited<typeof core>["ObjectMaskTracker"]> | null = null;
  return {
    segment: async (image, prompt) => new (await core).GrabCutSegmenter().segment(image, prompt),
    beginTrack: async (anchorImage, anchorPath) => {
      const module = await core;
      tracker = new module.ObjectMaskTracker({ segmenter: new module.GrabCutSegmenter(), anchorImage, anchorPath });
    },
    step: async (frame, image) => {
      if (!tracker) throw new Error("Tracking was not started");
      return tracker.step(frame, image);
    },
    dispose: () => { tracker = null; },
  };
}

export function createObjectMaskEngine(): ObjectMaskEngine {
  if (typeof Worker === "undefined") return createInThreadEngine();
  const worker = new Worker(new URL("../workers/object-mask-worker.ts", import.meta.url), { type: "module" });
  let next = 1;
  const pending = new Map<number, { resolve: (reply: ObjectMaskWorkerReply) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<ObjectMaskWorkerReply>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.type === "error") entry.reject(new Error(event.data.message));
    else entry.resolve(event.data);
  };
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || "The object mask worker failed"));
    pending.clear();
  };
  const call = (request: ObjectMaskWorkerRequest, transfer: ArrayBufferLike[] = []): Promise<ObjectMaskWorkerReply> =>
    new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      worker.postMessage(request, transfer as ArrayBuffer[]);
    });
  return {
    segment: async (image, prompt) => {
      const frame = copy(image);
      const reply = await call({ type: "segment", id: next++, image: frame, prompt }, [frame.data.buffer]);
      if (reply.type !== "segment") throw new Error("Unexpected worker reply");
      return reply.result;
    },
    beginTrack: async (anchorImage, anchorPath) => {
      const frame = copy(anchorImage);
      await call({ type: "begin", id: next++, anchorImage: frame, anchorPath }, [frame.data.buffer]);
    },
    step: async (frame, image) => {
      const pixels = copy(image);
      const reply = await call({ type: "step", id: next++, frame, image: pixels }, [pixels.data.buffer]);
      if (reply.type !== "step") throw new Error("Unexpected worker reply");
      return reply.result;
    },
    dispose: () => {
      for (const entry of pending.values()) entry.reject(new Error("Object mask engine closed"));
      pending.clear();
      worker.terminate();
    },
  };
}
