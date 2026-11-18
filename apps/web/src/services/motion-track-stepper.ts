import { MotionTrackSession, type TrackSessionConfig, type TrackStepper, type TrackStepperFactory, type TrackStep } from "@openreel/core";
import type { MotionTrackWorkerReply } from "../workers/motion-track-worker";

/**
 * Run the tracker in a dedicated worker so a long path never blocks the editor's main thread.
 * Frame pixels are transferred, not copied. Falls back to the main thread where workers are unavailable.
 */
export const createWorkerTrackStepper: TrackStepperFactory = (config: TrackSessionConfig): TrackStepper => {
  if (typeof Worker === "undefined") {
    const session = new MotionTrackSession(config);
    return { step: frame => session.step(frame), dispose: () => undefined };
  }
  const worker = new Worker(new URL("../workers/motion-track-worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve: (step: TrackStep) => void; reject: (error: Error) => void }>();
  let nextId = 1, closed = false, failure: string | null = null;
  const failAll = (message: string) => { for (const entry of waiting.values()) entry.reject(new Error(message)); waiting.clear(); };
  worker.onmessage = (event: MessageEvent<MotionTrackWorkerReply>) => {
    const reply = event.data, entry = waiting.get(reply.id);
    if (!entry) return;
    waiting.delete(reply.id);
    if (reply.type === "step") entry.resolve(reply.step); else entry.reject(new Error(reply.message));
  };
  worker.onerror = event => { failure = event.message || "Tracking worker failed"; failAll(failure); };
  worker.postMessage({ type: "init", config });
  return {
    step: frame => new Promise<TrackStep>((resolve, reject) => {
      if (closed) { reject(new DOMException("Tracking cancelled", "AbortError")); return; }
      if (failure) { reject(new Error(failure)); return; }
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ type: "step", id, frame }, [frame.data.buffer]);
    }),
    dispose: () => { closed = true; failAll("Tracking cancelled"); worker.terminate(); },
  };
};
