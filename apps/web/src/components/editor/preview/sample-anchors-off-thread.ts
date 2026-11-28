import {
  sampleSeekAnchors,
  type SampleSeekAnchorsOptions,
  type SampleSeekAnchorsResult,
} from "@openreel/core/media/seek-anchor-sampler";
import { requestThumbnail } from "../../../services/preview-thumbnail-worker";

export async function sampleAnchorsOffThread(blob: Blob, options: SampleSeekAnchorsOptions): Promise<SampleSeekAnchorsResult> {
  const { maxAnchors, minSpacing, maxWidth } = options;
  const reply = await requestThumbnail({ type: "anchors", blob, options: { maxAnchors, minSpacing, maxWidth } }, options);
  return reply?.type === "done" ? reply.result : sampleSeekAnchors(blob, options);
}
