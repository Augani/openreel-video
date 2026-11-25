/// <reference lib="webworker" />

import {
  GrabCutSegmenter,
  ObjectMaskTracker,
  type ObjectTrackFrame,
  type RGBAFrame,
  type SegmentPrompt,
  type SegmentResult,
} from "@openreel/core/video/object-mask/index";
import type { BezierPath } from "@openreel/core";

export type ObjectMaskWorkerRequest =
  | { type: "segment"; id: number; image: RGBAFrame; prompt: SegmentPrompt }
  | { type: "begin"; id: number; anchorImage: RGBAFrame; anchorPath: BezierPath }
  | { type: "step"; id: number; frame: number; image: RGBAFrame }
  | { type: "end"; id: number };
export type ObjectMaskWorkerReply =
  | { type: "segment"; id: number; result: SegmentResult }
  | { type: "begin"; id: number }
  | { type: "step"; id: number; result: ObjectTrackFrame }
  | { type: "end"; id: number }
  | { type: "error"; id: number; message: string };

const segmenter = new GrabCutSegmenter();
let tracker: ObjectMaskTracker | null = null;
// Steps are strictly sequential; chaining keeps them ordered even if the host posts ahead.
let chain: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<ObjectMaskWorkerRequest>) => {
  const request = event.data;
  chain = chain.then(async () => {
    try {
      if (request.type === "segment") {
        const result = await segmenter.segment(request.image, request.prompt);
        self.postMessage({ type: "segment", id: request.id, result } satisfies ObjectMaskWorkerReply, [result.mask.buffer]);
      } else if (request.type === "begin") {
        tracker = new ObjectMaskTracker({ segmenter, anchorImage: request.anchorImage, anchorPath: request.anchorPath });
        self.postMessage({ type: "begin", id: request.id } satisfies ObjectMaskWorkerReply);
      } else if (request.type === "step") {
        if (!tracker) throw new Error("Tracking was not started");
        self.postMessage({ type: "step", id: request.id, result: await tracker.step(request.frame, request.image) } satisfies ObjectMaskWorkerReply);
      } else {
        tracker = null;
        self.postMessage({ type: "end", id: request.id } satisfies ObjectMaskWorkerReply);
      }
    } catch (error) {
      self.postMessage({ type: "error", id: request.id, message: error instanceof Error ? error.message : "Object mask failed" } satisfies ObjectMaskWorkerReply);
    }
  });
};

export {};
