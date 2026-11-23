/**
 * Latency maths of a live insert. Everything is in frames; the graph turns it into seconds for delay compensation.
 *
 * A live insert streams the signal in blocks of B frames through a plugin chain that lives in another process. The wet block
 * that answers input block s has to be back before the output reaches its slot, which is J blocks later (the jitter
 * buffer, `prefillBlocks`). So the signal that leaves the insert is
 *
 *     out[n] = chain(in)[n - J * B]          (the plugin's own latency L is inside chain(in))
 *
 * and the insert as a whole delays the signal by  D = J * B + L  frames. The dry fallback (underrun, crash, bypass) is the
 * input delayed by the same D, so switching between wet and dry never moves the audio against the rest of the mix, and the
 * routing graph delays every other path by D (Premiere-style plugin delay compensation).
 */

export const LIVE_BLOCK_SIZES = [128, 256, 512] as const;
export type LiveBlockFrames = (typeof LIVE_BLOCK_SIZES)[number];
export const DEFAULT_LIVE_BLOCK_FRAMES: LiveBlockFrames = 256;
export const MIN_PREFILL_BLOCKS = 2;
/** Shortest jitter buffer in time: the margin against scheduling stalls in the main process and the helpers. */
export const MIN_TRANSPORT_MS = 20;
export const MAX_PREFILL_BLOCKS = 12;

export const isLiveBlockSize = (value: unknown): value is LiveBlockFrames => LIVE_BLOCK_SIZES.includes(value as LiveBlockFrames);

/** Frames of latency the plugin chain itself reports (sum over the chain). Garbage entries count as zero. */
export function chainPluginLatencyFrames(latencies: readonly number[]): number {
  let total = 0;
  for (const value of latencies) if (Number.isFinite(value) && value > 0) total += Math.round(value);
  return total;
}

/** D = J * B + L. */
export function liveInsertLatencyFrames(blockFrames: number, prefillBlocks: number, pluginLatencyFrames: number): number {
  return Math.max(0, Math.round(blockFrames) * Math.max(0, Math.round(prefillBlocks)) + Math.max(0, Math.round(pluginLatencyFrames)));
}

/**
 * Smallest jitter buffer (in blocks) that still covers a measured round trip. Wet block s must be back before output block
 * s + J starts, i.e. within (J - 1) blocks of the moment input block s was complete, so J = ceil(rtt / B) + 1, with
 * `headroomBlocks` of margin for scheduling jitter on a loaded machine.
 */
export function prefillBlocksForRoundTrip(roundTripMs: number, blockFrames: number, sampleRate: number, headroomBlocks = 1, minTransportMs = MIN_TRANSPORT_MS): number {
  const blockMs = (blockFrames / sampleRate) * 1000;
  const measured = Math.ceil(Math.max(0, roundTripMs) / blockMs) + 1 + Math.max(0, Math.round(headroomBlocks));
  // The round trip of a block through an idle pipe is a fraction of a millisecond; what actually misses deadlines is a scheduling
  // stall (a garbage collection or a busy event loop in the main process, a helper that was descheduled): a few milliseconds.
  // The jitter buffer therefore never gets shorter than MIN_TRANSPORT_MS, whatever the idle round trip was.
  const floor = Math.ceil(Math.max(0, minTransportMs) / blockMs);
  return Math.max(MIN_PREFILL_BLOCKS, Math.min(MAX_PREFILL_BLOCKS, Math.max(measured, floor)));
}

/** p-th percentile (0..1) of a list, nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export interface LiveLatencyReport {
  readonly blockFrames: number;
  readonly prefillBlocks: number;
  readonly pluginLatencyFrames: number;
  /** J * B: what the transport and the jitter buffer add. */
  readonly transportFrames: number;
  /** D: the whole insert. */
  readonly totalFrames: number;
  readonly totalMilliseconds: number;
}

export function liveLatencyReport(blockFrames: number, prefillBlocks: number, pluginLatencyFrames: number, sampleRate: number): LiveLatencyReport {
  const transportFrames = Math.round(blockFrames) * Math.round(prefillBlocks);
  const totalFrames = liveInsertLatencyFrames(blockFrames, prefillBlocks, pluginLatencyFrames);
  return { blockFrames, prefillBlocks, pluginLatencyFrames, transportFrames, totalFrames, totalMilliseconds: (totalFrames / sampleRate) * 1000 };
}

/**
 * Seconds of delay each OTHER path needs so that a path with `latencySeconds` of live insert latency stays aligned: the
 * longest path sets the pace, every shorter one is delayed by the difference (the routing graph's planDelayCompensation does
 * this for a whole timeline; this is the pairwise rule it applies).
 */
export function compensationSeconds(pathLatencySeconds: number, longestPathSeconds: number): number {
  return Math.max(0, longestPathSeconds - Math.max(0, pathLatencySeconds));
}

/** Residual misalignment after compensation: delays are whole frames, so a path can be off by up to half a frame. */
export const COMPENSATION_RESIDUAL_FRAMES = 0.5;
