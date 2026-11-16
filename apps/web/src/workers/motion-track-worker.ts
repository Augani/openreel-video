/// <reference lib="webworker" />

import { MotionTrackSession, type TrackSessionConfig, type TrackSessionFrame, type TrackStep } from "@openreel/core";

type Request =
  | { type: "init"; config: TrackSessionConfig }
  | { type: "step"; id: number; frame: TrackSessionFrame };
export type MotionTrackWorkerReply =
  | { type: "step"; id: number; step: TrackStep }
  | { type: "error"; id: number; message: string };

let session: MotionTrackSession | null = null;
// Steps are strictly sequential; a queue keeps them ordered even if the host posts ahead.
let chain: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (request.type === "init") { session = new MotionTrackSession(request.config); return; }
  chain = chain.then(async () => {
    try {
      if (!session) throw new Error("Tracking worker was not initialised");
      const step = await session.step(request.frame);
      self.postMessage({ type: "step", id: request.id, step } satisfies MotionTrackWorkerReply);
    } catch (error) {
      self.postMessage({ type: "error", id: request.id, message: error instanceof Error ? error.message : "Tracking failed" } satisfies MotionTrackWorkerReply);
    }
  });
};

export {};
