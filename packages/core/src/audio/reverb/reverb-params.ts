/** Tiny shared definitions, kept apart from the DSP so the cache and the worker client stay cheap to import. */

/** Identifies the algorithm in cache keys; bump when a change to the DSP changes what comes out. */
export const REDUCE_REVERB_MODEL_ID = "reduce-reverb-2";

export const DEFAULT_REDUCE_REVERB_AMOUNT = 60;
export const DEFAULT_REDUCE_REVERB_SENSITIVITY = 50;

export interface ReduceReverbParams {
  /** 0..100: how hard the late reverb is removed. 0 means off. */
  readonly amount: number;
  /** 0..100: how aggressively the late-reverb model starts and how much of the signal it assumes to be reverberant. */
  readonly sensitivity: number;
}

export function sanitizeReverbPercent(raw: unknown, fallback: number): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

export class ReverbCancelledError extends Error {
  constructor() {
    super("Reduce Reverb was cancelled");
    this.name = "ReverbCancelledError";
  }
}
