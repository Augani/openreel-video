/** Tiny shared definitions, kept apart from the DSP so the cache and the worker client stay cheap to import. */

/** Identifies the network in cache keys; bump when the weights or the signal path change what comes out. */
export const DFN3_MODEL_ID = "dfn3-onnx-1";
export const DFN3_SAMPLE_RATE = 48_000;

export class EnhanceCancelledError extends Error {
  constructor() {
    super("Enhance Speech was cancelled");
    this.name = "EnhanceCancelledError";
  }
}
