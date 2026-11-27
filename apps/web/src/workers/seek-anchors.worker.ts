import {
  sampleSeekAnchors,
  type SampleSeekAnchorsOptions,
  type SampleSeekAnchorsResult,
  type SeekAnchor,
} from "@openreel/core/media/seek-anchor-sampler";

export type AnchorWorkerRequest =
  | { type: "sample"; blob: Blob; options: Pick<SampleSeekAnchorsOptions, "maxAnchors" | "minSpacing" | "maxWidth"> }
  | { type: "idle" };

export type AnchorWorkerReply =
  | { type: "idle-request" }
  | { type: "anchor"; anchor: SeekAnchor }
  | { type: "done"; result: SampleSeekAnchorsResult }
  | { type: "unsupported" }
  | { type: "error"; message: string };

let resume: (() => void) | undefined;
function reply(message: AnchorWorkerReply, transfer: ImageBitmap[] = []) {
  self.postMessage(message, { transfer });
}

self.onmessage = async ({ data }: MessageEvent<AnchorWorkerRequest>) => {
  if (data.type === "idle") {
    resume?.();
    resume = undefined;
    return;
  }
  if (typeof VideoDecoder === "undefined" || typeof OffscreenCanvas === "undefined") {
    reply({ type: "unsupported" });
    return;
  }
  try {
    const result = await sampleSeekAnchors(data.blob, {
      ...data.options,
      waitUntilIdle: () => new Promise<void>((resolve) => {
        resume = resolve;
        reply({ type: "idle-request" });
      }),
      onAnchor: (anchor) => reply({ type: "anchor", anchor }, [anchor.bitmap]),
    });
    reply({ type: "done", result });
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
