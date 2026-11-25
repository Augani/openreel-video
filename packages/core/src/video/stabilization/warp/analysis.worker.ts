import { runAnalysisJob, type AnalysisRequest } from "./analysis-job";
import type { WarpAnalysis } from "./types";

/** Off-main-thread Warp Stabilizer analysis: decoding and motion estimation run here; the page posts a blob and listens. */
export type AnalysisWorkerRequest =
  | ({ kind: "analyze"; id: number } & AnalysisRequest)
  | { kind: "cancel"; id: number };
export type AnalysisWorkerResponse =
  | { kind: "progress"; id: number; fraction: number }
  | { kind: "done"; id: number; analysis: WarpAnalysis }
  | { kind: "error"; id: number; message: string; cancelled: boolean };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisWorkerRequest>) => void) | null;
  postMessage(message: AnalysisWorkerResponse): void;
};
const running = new Map<number, AbortController>();

scope.onmessage = (event) => {
  const message = event.data;
  if (message.kind === "cancel") {
    running.get(message.id)?.abort();
    return;
  }
  const controller = new AbortController();
  running.set(message.id, controller);
  let lastPosted = -1;
  runAnalysisJob(message, {
    signal: controller.signal,
    onProgress: (fraction) => {
      if (fraction - lastPosted < 0.01 && fraction < 1) return;
      lastPosted = fraction;
      scope.postMessage({ kind: "progress", id: message.id, fraction });
    },
  })
    .then((analysis) => scope.postMessage({ kind: "done", id: message.id, analysis }))
    .catch((error: unknown) =>
      scope.postMessage({
        kind: "error",
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
        cancelled: controller.signal.aborted,
      }),
    )
    .finally(() => running.delete(message.id));
};
