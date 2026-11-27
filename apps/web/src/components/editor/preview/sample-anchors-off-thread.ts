import {
  sampleSeekAnchors,
  type SampleSeekAnchorsOptions,
  type SampleSeekAnchorsResult,
} from "@openreel/core/media/seek-anchor-sampler";
import type { AnchorWorkerReply, AnchorWorkerRequest } from "../../../workers/seek-anchors.worker";

/** Long GOPs require many full-size decoded frames for just one small seek thumbnail. */
export async function sampleAnchorsOffThread(blob: Blob, options: SampleSeekAnchorsOptions): Promise<SampleSeekAnchorsResult> {
  if (typeof Worker === "undefined" || options.signal?.aborted) return sampleSeekAnchors(blob, options);
  let worker: Worker;
  try {
    worker = new Worker(new URL("../../../workers/seek-anchors.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return sampleSeekAnchors(blob, options);
  }
  let abort: (() => void) | undefined;
  let result: SampleSeekAnchorsResult | null;
  try {
    result = await new Promise<SampleSeekAnchorsResult | null>((resolve, reject) => {
      abort = () => resolve({ completed: false, anchors: 0, durationSeconds: 0, width: 0, height: 0 });
      options.signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = (event) => reject(new Error(event.message));
      worker.onmessage = async ({ data }: MessageEvent<AnchorWorkerReply>) => {
        try {
          switch (data.type) {
            case "idle-request":
              await options.waitUntilIdle?.();
              if (!options.signal?.aborted) worker.postMessage({ type: "idle" } satisfies AnchorWorkerRequest);
              break;
            case "anchor":
              if (options.signal?.aborted) data.anchor.bitmap.close();
              else options.onAnchor(data.anchor);
              break;
            case "unsupported": resolve(null); break;
            case "done": resolve(data.result); break;
            case "error": reject(new Error(data.message)); break;
          }
        } catch (error) { reject(error); }
      };
      const { maxAnchors, minSpacing, maxWidth } = options;
      worker.postMessage({ type: "sample", blob, options: { maxAnchors, minSpacing, maxWidth } } satisfies AnchorWorkerRequest);
    });
  } finally {
    if (abort) options.signal?.removeEventListener("abort", abort);
    worker.terminate();
  }
  return result ?? sampleSeekAnchors(blob, options);
}
