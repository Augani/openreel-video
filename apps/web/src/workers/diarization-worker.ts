/// <reference lib="webworker" />
import { computeSpeakerEmbedding } from "@openreel/core";

export interface DiarizationWorkerRequest {
  requestId: string;
  segments: Array<{ id: string; samples: Float32Array }>;
}

export type DiarizationWorkerResponse =
  | { requestId: string; type: "progress"; progress: number }
  | { requestId: string; type: "result"; embeddings: Array<{ id: string; embedding: Float32Array | null }> };

/** Voice-prints for caption-cue audio, fully on device. */
self.onmessage = (event: MessageEvent<DiarizationWorkerRequest>) => {
  const { requestId, segments } = event.data;
  const post = (message: DiarizationWorkerResponse) => (self as unknown as Worker).postMessage(message);
  const embeddings = segments.map((segment, i) => {
    if (i % 8 === 0) post({ requestId, type: "progress", progress: i / Math.max(1, segments.length) });
    return { id: segment.id, embedding: computeSpeakerEmbedding(segment.samples) };
  });
  post({ requestId, type: "result", embeddings });
};
