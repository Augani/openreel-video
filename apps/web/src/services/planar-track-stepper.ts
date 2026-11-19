import { PlanarTrackSession, type PlanarSessionConfig, type PlanarStep, type PlanarStepper, type PlanarStepperFactory } from "@openreel/core";
import type { PlanarTrackWorkerReply } from "../workers/planar-track-worker";

/** Run the planar tracker in a dedicated worker (frame pixels are transferred), or in-thread where workers are unavailable. */
export const createWorkerPlanarStepper: PlanarStepperFactory = (config: PlanarSessionConfig): PlanarStepper => {
  if (typeof Worker === "undefined") {
    const session = new PlanarTrackSession(config);
    return { step: frame => session.step(frame), dispose: () => undefined };
  }
  const worker = new Worker(new URL("../workers/planar-track-worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve: (step: PlanarStep) => void; reject: (error: Error) => void }>();
  let nextId = 1, closed = false, failure: string | null = null;
  const failAll = (message: string) => { for (const entry of waiting.values()) entry.reject(new Error(message)); waiting.clear(); };
  worker.onmessage = (event: MessageEvent<PlanarTrackWorkerReply>) => {
    const reply = event.data;
    if (reply.type === "error" && reply.id === 0) { failure = reply.message; failAll(reply.message); return; }
    const entry = waiting.get(reply.id);
    if (!entry) return;
    waiting.delete(reply.id);
    if (reply.type === "step") entry.resolve(reply.step); else entry.reject(new Error(reply.message));
  };
  worker.onerror = event => { failure = event.message || "Tracking worker failed"; failAll(failure); };
  worker.postMessage({ type: "init", config });
  return {
    step: frame => new Promise<PlanarStep>((resolve, reject) => {
      if (closed) { reject(new DOMException("Tracking cancelled", "AbortError")); return; }
      if (failure) { reject(new Error(failure)); return; }
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ type: "step", id, frame }, [frame.data.buffer]);
    }),
    dispose: () => { closed = true; failAll("Tracking cancelled"); worker.terminate(); },
  };
};
