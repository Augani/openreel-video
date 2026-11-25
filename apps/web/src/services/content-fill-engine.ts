import type { FillReport, FillSessionOptions } from "@openreel/core/video/content-aware-fill/session";
import type { RGBAFrame } from "@openreel/core/video/object-mask/index";
import type { ContentFillReply, ContentFillRequest } from "../workers/content-fill-worker";

/**
 * Runs the Content-Aware Fill analysis (temporal propagation + PatchMatch) off the main thread. Without Worker
 * support it runs the same code in-thread.
 */
export interface ContentFillEngine {
  begin(options: FillSessionOptions): Promise<void>;
  push(index: number, image: RGBAFrame, mask: Uint8Array): Promise<void>;
  fill(index: number): Promise<FillReport>;
  release(index: number): Promise<void>;
  dispose(): void;
}

function createInThreadEngine(): ContentFillEngine {
  const module = import("@openreel/core/video/content-aware-fill/session");
  let session: InstanceType<Awaited<typeof module>["FillSession"]> | null = null;
  const need = () => {
    if (!session) throw new Error("Remove Object was not started");
    return session;
  };
  return {
    begin: async (options) => { session = new (await module).FillSession(options); },
    push: async (index, image, mask) => { need().push(index, image, mask); },
    fill: async (index) => need().fill(index),
    release: async (index) => { need().release(index); },
    dispose: () => { session = null; },
  };
}

export function createContentFillEngine(): ContentFillEngine {
  if (typeof Worker === "undefined") return createInThreadEngine();
  const worker = new Worker(new URL("../workers/content-fill-worker.ts", import.meta.url), { type: "module" });
  let next = 1;
  const pending = new Map<number, { resolve: (reply: ContentFillReply) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<ContentFillReply>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.type === "error") entry.reject(new Error(event.data.message));
    else entry.resolve(event.data);
  };
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || "The Remove Object worker failed"));
    pending.clear();
  };
  const call = (request: ContentFillRequest, transfer: ArrayBuffer[] = []): Promise<ContentFillReply> =>
    new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      worker.postMessage(request, transfer);
    });
  return {
    begin: async (options) => { await call({ type: "begin", id: next++, options }); },
    push: async (index, image, mask) => {
      const pixels = new Uint8ClampedArray(image.data);
      const copy = new Uint8Array(mask);
      await call({ type: "push", id: next++, index, image: { width: image.width, height: image.height, data: pixels }, mask: copy }, [pixels.buffer, copy.buffer]);
    },
    fill: async (index) => {
      const reply = await call({ type: "fill", id: next++, index });
      if (reply.type !== "fill") throw new Error("Unexpected worker reply");
      return reply.report;
    },
    release: async (index) => { await call({ type: "release", id: next++, index }); },
    dispose: () => {
      for (const entry of pending.values()) entry.reject(new Error("Remove Object was cancelled"));
      pending.clear();
      worker.terminate();
    },
  };
}
