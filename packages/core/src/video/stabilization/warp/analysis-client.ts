import { WarpAnalysisCancelled } from "./analysis";
import { runAnalysisJob, type AnalysisRequest } from "./analysis-job";
import type { AnalysisWorkerResponse } from "./analysis.worker";
import type { WarpAnalysis } from "./types";

export interface AnalysisOptions {
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

let nextId = 1;

/**
 * Analyse a clip's footage off the main thread. One worker per job (it is torn down when the job ends or is
 * cancelled, which also frees its decoder). Falls back to running inline where Worker does not exist.
 */
export function analyseWarpFootage(request: AnalysisRequest, options: AnalysisOptions = {}): Promise<WarpAnalysis> {
  if (typeof Worker === "undefined") return runAnalysisJob(request, options);
  return new Promise<WarpAnalysis>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new WarpAnalysisCancelled());
      return;
    }
    const id = nextId++;
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module", name: "openreel-warp-stabilizer" });
    const finish = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = (): void => {
      worker.postMessage({ kind: "cancel", id });
      finish();
      reject(new WarpAnalysisCancelled());
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.kind === "progress") options.onProgress?.(message.fraction);
      else if (message.kind === "done") {
        finish();
        resolve(message.analysis);
      } else {
        finish();
        reject(message.cancelled ? new WarpAnalysisCancelled() : new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The stabilizer worker failed"));
    };
    worker.postMessage({ kind: "analyze", id, ...request });
  });
}
