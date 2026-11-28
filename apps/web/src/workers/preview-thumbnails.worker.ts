import {
  sampleSeekAnchors,
  type SampleSeekAnchorsOptions,
  type SampleSeekAnchorsResult,
  type SeekAnchor,
} from "@openreel/core/media/seek-anchor-sampler";
import { decodeVideoBackdrop } from "../components/editor/playhead-video-frame";

export type ThumbnailRequest =
  | { type: "backdrop"; blob: Blob; time: number; max: number }
  | { type: "anchors"; blob: Blob; options: Pick<SampleSeekAnchorsOptions, "maxAnchors" | "minSpacing" | "maxWidth"> };
export type ThumbnailResult =
  | { type: "backdrop"; bitmap: ImageBitmap | null }
  | { type: "done"; result: SampleSeekAnchorsResult }
  | { type: "unsupported" };
export type ThumbnailReply = ThumbnailResult
  | { type: "idle-request" }
  | { type: "anchor"; anchor: SeekAnchor }
  | { type: "error"; message: string };

// Each request owns its port, decoder and cancellation signal. The worker stays
// available for the next seek without stopping Chrome's renderer to tear it down.
self.onmessage = async ({ data, ports }: MessageEvent<ThumbnailRequest>) => {
  const [port] = ports;
  const controller = new AbortController();
  let resume: (() => void) | undefined;
  port.onmessage = ({ data: command }) => {
    if (command === "cancel") controller.abort();
    resume?.();
    resume = undefined;
  };
  const post = (reply: ThumbnailReply, transfer: ImageBitmap[] = []) => port.postMessage(reply, transfer);
  try {
    if (typeof VideoDecoder === "undefined" || typeof OffscreenCanvas === "undefined") {
      post({ type: "unsupported" });
    } else if (data.type === "backdrop") {
      const bitmap = await decodeVideoBackdrop(data.blob, data.time, data.max, controller.signal);
      if (controller.signal.aborted) bitmap?.close();
      else post({ type: "backdrop", bitmap }, bitmap ? [bitmap] : []);
    } else {
      const result = await sampleSeekAnchors(data.blob, {
        ...data.options,
        signal: controller.signal,
        waitUntilIdle: () => controller.signal.aborted ? Promise.resolve() : new Promise<void>((resolve) => {
          resume = resolve;
          post({ type: "idle-request" });
        }),
        onAnchor: (anchor) => post({ type: "anchor", anchor }, [anchor.bitmap]),
      });
      post({ type: "done", result });
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    port.close();
  }
};
