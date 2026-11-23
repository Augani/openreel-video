/**
 * The request handler behind the enhance worker. The same code runs in the module worker (enhance.worker.ts),
 * inline (node tests, browsers without workers) and in the desktop main-process path, so an enhancement never depends
 * on where it was computed. The network is created once per model source and reused.
 */
import type { Dfn3Inference } from "./dfn3-dsp";
import { EnhanceCancelledError } from "./enhance-constants";
import { createDfn3Inference, type Dfn3ModelSource } from "./dfn3-model";
import { enhanceChannels } from "./enhance-engine";

export type EnhanceRequest =
  | {
      readonly id: number;
      readonly kind: "enhance";
      readonly channels: Float32Array[];
      readonly sampleRate: number;
      readonly model: Dfn3ModelSource;
    }
  | { readonly id: number; readonly kind: "cancel" };

export type EnhanceResponse =
  | { readonly id: number; readonly kind: "progress"; readonly fraction: number }
  | { readonly id: number; readonly kind: "done"; readonly channels: Float32Array[] }
  | { readonly id: number; readonly kind: "error"; readonly message: string; readonly cancelled?: boolean };

/**
 * What to transfer with a response: each distinct ArrayBuffer once. Identical (dual-mono) channels are one array that appears
 * twice in `channels`, and listing a buffer twice makes postMessage throw ("duplicate ArrayBuffer").
 */
export function transferListOf(response: EnhanceResponse): ArrayBuffer[] {
  return response.kind === "done" ? [...new Set(response.channels.map((channel) => channel.buffer as ArrayBuffer))] : [];
}

export interface EnhanceHandler {
  handle(request: EnhanceRequest, post: (response: EnhanceResponse) => void): Promise<void>;
}

export function createEnhanceHandler(createInference: (model: Dfn3ModelSource) => Promise<Dfn3Inference> = createDfn3Inference): EnhanceHandler {
  const sessions = new Map<string, Promise<Dfn3Inference>>();
  const aborts = new Map<number, { aborted: boolean }>();
  const sessionFor = (model: Dfn3ModelSource): Promise<Dfn3Inference> => {
    const key = `${model.baseUrl ?? ""}|${JSON.stringify(model.wasmPaths ?? "")}|${model.numThreads ?? 1}|${model.bytes ? "bytes" : ""}`;
    let session = sessions.get(key);
    if (!session) {
      session = createInference(model);
      session.catch(() => sessions.delete(key));
      sessions.set(key, session);
    }
    return session;
  };
  return {
    async handle(request, post) {
      if (request.kind === "cancel") {
        const abort = aborts.get(request.id);
        if (abort) abort.aborted = true;
        return;
      }
      const abort = { aborted: false };
      aborts.set(request.id, abort);
      try {
        const infer = await sessionFor(request.model);
        const channels = await enhanceChannels(request.channels, request.sampleRate, {
          infer: async (erb, spec, frames) => {
            // Yield between network calls so a cancel message is seen promptly (matters inline and in the worker alike).
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            return infer(erb, spec, frames);
          },
          signal: abort,
          onProgress: (fraction) => post({ id: request.id, kind: "progress", fraction }),
        });
        post({ id: request.id, kind: "done", channels });
      } catch (error) {
        const cancelled = error instanceof EnhanceCancelledError || abort.aborted;
        post({ id: request.id, kind: "error", message: error instanceof Error ? error.message : String(error), ...(cancelled ? { cancelled: true } : {}) });
      } finally {
        aborts.delete(request.id);
      }
    },
  };
}
