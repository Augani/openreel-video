/// <reference lib="webworker" />

import { FillSession, type FillReport, type FillSessionOptions } from "@openreel/core/video/content-aware-fill/session";
import type { RGBAFrame } from "@openreel/core/video/object-mask/index";

/** Content-Aware Fill analysis off the main thread: the page decodes frames and feeds them in, the worker fills. */
export type ContentFillRequest =
  | { type: "begin"; id: number; options: FillSessionOptions }
  | { type: "push"; id: number; index: number; image: RGBAFrame; mask: Uint8Array }
  | { type: "fill"; id: number; index: number }
  | { type: "release"; id: number; index: number };
export type ContentFillReply =
  | { type: "ok"; id: number }
  | { type: "fill"; id: number; report: FillReport }
  | { type: "error"; id: number; message: string };

let session: FillSession | null = null;

self.onmessage = (event: MessageEvent<ContentFillRequest>) => {
  const request = event.data;
  try {
    if (request.type === "begin") {
      session = new FillSession(request.options);
      self.postMessage({ type: "ok", id: request.id } satisfies ContentFillReply);
    } else if (!session) {
      throw new Error("Remove Object was not started");
    } else if (request.type === "push") {
      session.push(request.index, request.image, request.mask);
      self.postMessage({ type: "ok", id: request.id } satisfies ContentFillReply);
    } else if (request.type === "release") {
      session.release(request.index);
      self.postMessage({ type: "ok", id: request.id } satisfies ContentFillReply);
    } else {
      const report = session.fill(request.index);
      self.postMessage({ type: "fill", id: request.id, report } satisfies ContentFillReply, report.patch ? [report.patch.data.buffer] : []);
    }
  } catch (error) {
    self.postMessage({ type: "error", id: request.id, message: error instanceof Error ? error.message : "Remove Object failed" } satisfies ContentFillReply);
  }
};

export {};
