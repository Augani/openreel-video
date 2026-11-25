/**
 * Message protocol that runs scene transition analysis in a Web Worker.
 *
 * Decoding stays on the main thread (the media engine's decoders live there), the analysis does not:
 * the worker asks for frames by time, reduces each one to thumbnails / histograms and classifies the
 * series. The worker entry is one line, `serveSceneDetection(self)`, so the same code runs against a
 * plain MessageChannel in tests.
 */
import {
  detectSceneTransitions,
  type TransitionDetectionOptions,
  type TransitionDetectionResult,
} from "./transition-detection";
import type { FrameLike, FrameSampler, SceneDetectionProgress } from "./scene-detection";

/** The part of a MessagePort / DedicatedWorkerGlobalScope the protocol needs. */
export interface MessagePortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export type SceneWorkerOptions = Omit<TransitionDetectionOptions, "sampler" | "signal" | "onProgress">;

type ToWorker =
  | { type: "start"; options: SceneWorkerOptions }
  | { type: "frame"; id: number; frame: { data: Uint8ClampedArray; width: number; height: number } | null }
  | { type: "abort" };

type FromWorker =
  | { type: "request"; id: number; time: number }
  | { type: "progress"; progress: SceneDetectionProgress }
  | { type: "result"; result: TransitionDetectionResult }
  | { type: "error"; name: string; message: string };

/** Worker side: serve one analysis per `start` message. */
export function serveSceneDetection(port: MessagePortLike): void {
  const pending = new Map<number, (frame: FrameLike | null) => void>();
  let controller: AbortController | null = null;
  let nextId = 1;

  const sampler: FrameSampler = (time) =>
    new Promise<FrameLike | null>((resolve, reject) => {
      if (controller?.signal.aborted) {
        reject(Object.assign(new Error("Scene detection aborted"), { name: "AbortError" }));
        return;
      }
      const id = nextId++;
      pending.set(id, resolve);
      port.postMessage({ type: "request", id, time } satisfies FromWorker);
    });

  port.onmessage = (event: MessageEvent): void => {
    const message = event.data as ToWorker;
    if (message.type === "frame") {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.frame);
    } else if (message.type === "abort") {
      controller?.abort();
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
    } else if (message.type === "start") {
      controller?.abort();
      const run = new AbortController();
      controller = run;
      detectSceneTransitions({
        ...message.options,
        sampler,
        signal: run.signal,
        onProgress: (progress) => port.postMessage({ type: "progress", progress } satisfies FromWorker),
      })
        .then((result) => port.postMessage({ type: "result", result } satisfies FromWorker))
        .catch((error: unknown) => {
          const e = error instanceof Error ? error : new Error(String(error));
          port.postMessage({ type: "error", name: e.name, message: e.message } satisfies FromWorker);
        });
    }
  };
}

export interface WorkerDetectionRun {
  /** The worker's end of the channel (a Worker, or a MessagePort in tests). */
  readonly port: MessagePortLike;
  readonly sampler: FrameSampler;
  readonly options: SceneWorkerOptions;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SceneDetectionProgress) => void;
}

/** Main-thread side: answers the worker's frame requests from `sampler` and resolves with its result. */
export function detectSceneTransitionsInWorker(run: WorkerDetectionRun): Promise<TransitionDetectionResult> {
  const { port, sampler, options, signal, onProgress } = run;
  return new Promise<TransitionDetectionResult>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      port.onmessage = null;
      action();
    };
    const abortError = (): Error => Object.assign(new Error("Scene detection aborted"), { name: "AbortError" });
    const onAbort = (): void => {
      port.postMessage({ type: "abort" } satisfies ToWorker);
      finish(() => reject(abortError()));
    };
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    port.onmessage = (event: MessageEvent): void => {
      const message = event.data as FromWorker;
      if (message.type === "request") {
        void sampler(message.time).then(
          (frame) => {
            if (settled) return;
            const payload = frame ? { data: new Uint8ClampedArray(frame.data as ArrayLike<number>), width: frame.width, height: frame.height } : null;
            port.postMessage({ type: "frame", id: message.id, frame: payload } satisfies ToWorker, payload ? [payload.data.buffer] : []);
          },
          (error: unknown) => {
            port.postMessage({ type: "abort" } satisfies ToWorker);
            finish(() => reject(error instanceof Error ? error : new Error(String(error))));
          },
        );
      } else if (message.type === "progress") {
        onProgress?.(message.progress);
      } else if (message.type === "result") {
        finish(() => resolve(message.result));
      } else {
        finish(() => reject(Object.assign(new Error(message.message), { name: message.name })));
      }
    };
    port.postMessage({ type: "start", options } satisfies ToWorker);
  });
}
