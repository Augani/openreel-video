/**
 * The request handler behind the Reduce Reverb worker. The same code runs in the module worker (reverb.worker.ts) and inline
 * (node tests, browsers without workers), so a result never depends on where it was computed.
 */
import { reduceReverbChannels } from "./reverb-engine";
import { ReverbCancelledError, type ReduceReverbParams } from "./reverb-params";

export type ReverbRequest =
  | { readonly id: number; readonly kind: "reduce"; readonly channels: Float32Array[]; readonly sampleRate: number; readonly params: ReduceReverbParams }
  | { readonly id: number; readonly kind: "cancel" };

export type ReverbResponse =
  | { readonly id: number; readonly kind: "progress"; readonly fraction: number }
  | { readonly id: number; readonly kind: "done"; readonly channels: Float32Array[]; readonly rt60: number; readonly confidence: number }
  | { readonly id: number; readonly kind: "error"; readonly message: string; readonly cancelled?: boolean };

/** What to transfer with a response: each distinct ArrayBuffer once (dual-mono channels are one array that appears twice). */
export function reverbTransferListOf(response: ReverbResponse): ArrayBuffer[] {
  return response.kind === "done" ? [...new Set(response.channels.map((channel) => channel.buffer as ArrayBuffer))] : [];
}

export interface ReverbHandler {
  handle(request: ReverbRequest, post: (response: ReverbResponse) => void): Promise<void>;
}

export function createReverbHandler(): ReverbHandler {
  const aborts = new Map<number, { aborted: boolean }>();
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
        const result = await reduceReverbChannels(request.channels, request.sampleRate, request.params, {
          signal: abort,
          // Yield between batches so a cancel message is seen promptly (matters inline and in the worker alike).
          yieldNow: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
          onProgress: (fraction) => post({ id: request.id, kind: "progress", fraction }),
        });
        post({ id: request.id, kind: "done", channels: result.channels, rt60: result.rt60.rt60, confidence: result.rt60.confidence });
      } catch (error) {
        const cancelled = error instanceof ReverbCancelledError || abort.aborted;
        post({ id: request.id, kind: "error", message: error instanceof Error ? error.message : String(error), ...(cancelled ? { cancelled: true } : {}) });
      } finally {
        aborts.delete(request.id);
      }
    },
  };
}
