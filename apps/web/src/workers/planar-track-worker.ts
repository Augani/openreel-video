/// <reference lib="webworker" />

import { PlanarTrackSession, type PlanarSessionConfig, type PlanarSessionFrame, type PlanarStep } from "@openreel/core";

type Request =
  | { type: "init"; config: PlanarSessionConfig }
  | { type: "step"; id: number; frame: PlanarSessionFrame };
export type PlanarTrackWorkerReply =
  | { type: "step"; id: number; step: PlanarStep }
  | { type: "error"; id: number; message: string };

let session: PlanarTrackSession | null = null;
// Steps are strictly sequential; chaining keeps them ordered even if the host posts ahead.
let chain: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "init") {
    try { session = new PlanarTrackSession(request.config); } catch (error) { session = null; self.postMessage({ type: "error", id: 0, message: error instanceof Error ? error.message : "Tracking failed" } satisfies PlanarTrackWorkerReply); }
    return;
  }
  chain = chain.then(async () => {
    try {
      if (!session) throw new Error("Tracking worker was not initialised");
      self.postMessage({ type: "step", id: request.id, step: await session.step(request.frame) } satisfies PlanarTrackWorkerReply);
    } catch (error) {
      self.postMessage({ type: "error", id: request.id, message: error instanceof Error ? error.message : "Tracking failed" } satisfies PlanarTrackWorkerReply);
    }
  });
};

export {};
