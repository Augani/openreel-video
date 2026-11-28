import type { SampleSeekAnchorsOptions } from "@openreel/core/media/seek-anchor-sampler";
import type { ThumbnailReply, ThumbnailRequest, ThumbnailResult } from "../workers/preview-thumbnails.worker";

let shared: Worker | undefined;
const pending = new Set<(reason: Error) => void>();
function disposeWorker(reason: Error) {
  shared?.terminate();
  shared = undefined;
  for (const reject of pending) reject(reason);
}

function onPageHide() {
  disposeWorker(new Error("The page has closed"));
}

export async function requestThumbnail(
  request: ThumbnailRequest,
  options: Partial<Pick<SampleSeekAnchorsOptions, "signal" | "waitUntilIdle" | "onAnchor">> = {},
): Promise<ThumbnailResult | null> {
  if (options.signal?.aborted || typeof Worker === "undefined" || typeof MessageChannel === "undefined") return null;
  if (!shared) {
    try {
      shared = new Worker(new URL("../workers/preview-thumbnails.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return null;
    }
    shared.onerror = (event) => disposeWorker(new Error(event.message));
    window.addEventListener("pagehide", onPageHide, { once: true });
  }
  const worker = shared;
  const { port1, port2 } = new MessageChannel();
  let abort: (() => void) | undefined;
  let fail: ((reason: Error) => void) | undefined;
  try {
    return await new Promise<ThumbnailResult | null>((resolve, reject) => {
      fail = reject;
      pending.add(reject);
      abort = () => {
        port1.postMessage("cancel");
        resolve(null);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      port1.onmessage = async ({ data }: MessageEvent<ThumbnailReply>) => {
        try {
          if (data.type === "idle-request") {
            await options.waitUntilIdle?.();
            if (!options.signal?.aborted) port1.postMessage("idle");
          } else if (data.type === "anchor") {
            if (options.onAnchor && !options.signal?.aborted) options.onAnchor(data.anchor);
            else data.anchor.bitmap.close();
          } else if (data.type === "error") {
            reject(new Error(data.message));
          } else {
            resolve(data);
          }
        } catch (error) { reject(error); }
      };
      port1.onmessageerror = () => reject(new Error("Could not read the thumbnail worker response"));
      worker.postMessage(request, [port2]);
    });
  } finally {
    // A consumer callback can also fail (for example while waiting for idle).
    // Release any decoder still waiting on this port before dropping it.
    port1.postMessage("cancel");
    if (fail) pending.delete(fail);
    if (abort) options.signal?.removeEventListener("abort", abort);
    port1.close();
    port2.close();
  }
}
