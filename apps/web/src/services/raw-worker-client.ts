import { RawDecodeError, setRawDeveloper, type DevelopedFrame, type RawDeveloper, type RawInspection } from "@openreel/core";
import type { RawWorkerReply, RawWorkerRequest } from "../workers/raw-develop.worker";

/**
 * Runs the RAW developer in a Web Worker so scrubbing, importing and dragging
 * RAW Source Settings never block the interface. Without Worker support the
 * core's in-thread developer stays installed.
 */

interface Pending {
  resolve(reply: RawWorkerReply): void;
  reject(error: Error): void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

let installed = false;

export function installRawWorker(): void {
  if (installed || typeof Worker === "undefined") return;
  installed = true;
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const ensure = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL("../workers/raw-develop.worker.ts", import.meta.url), { type: "module", name: "openreel-raw" });
    w.onmessage = (event: MessageEvent<RawWorkerReply>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.resolve(event.data);
    };
    w.onerror = (event) => {
      const error = new Error(event.message || "The RAW worker failed.");
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      w.terminate();
      worker = null;
    };
    worker = w;
    return w;
  };

  const call = (request: WithoutId<RawWorkerRequest>): Promise<RawWorkerReply> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ensure().postMessage({ ...request, id } as RawWorkerRequest);
    });

  const developer: RawDeveloper = {
    async develop({ sourceKey, blob, settings, maxLongEdge }): Promise<DevelopedFrame> {
      const reply = await call({ type: "develop", sourceKey, blob, settings, maxLongEdge });
      if (!reply.ok) throw new RawDecodeError(reply.message);
      if (reply.type !== "develop") throw new RawDecodeError("Unexpected RAW worker reply.");
      return { width: reply.width, height: reply.height, rgba: reply.rgba };
    },
    async inspect({ sourceKey, blob }): Promise<RawInspection> {
      const reply = await call({ type: "inspect", sourceKey, blob });
      if (!reply.ok) throw new RawDecodeError(reply.message);
      if (reply.type !== "inspect") throw new RawDecodeError("Unexpected RAW worker reply.");
      return reply.inspection;
    },
  };
  setRawDeveloper(developer);
}
