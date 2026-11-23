import { reduceReverbChannel, type Rt60Estimate } from "./reverb-dsp";
import { limitPeaks, peakOfChannels } from "./reverb-limiter";
import { ReverbCancelledError, type ReduceReverbParams } from "./reverb-params";

export interface ReduceReverbChannelsOptions {
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (fraction: number) => void;
  readonly yieldNow?: () => Promise<void>;
  readonly rt60?: number;
}

export interface ReduceReverbChannelsResult {
  readonly channels: Float32Array[];
  /** What the blind estimate found for the first (or only distinct) channel. */
  readonly rt60: Rt60Estimate;
}

const sameSamples = (a: Float32Array, b: Float32Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Reduce Reverb for every channel of a clip's source. Identical channels (dual-mono dialogue) are processed once; distinct
 * channels each get their own estimate. The result has the source's rate and length, and never peaks above the source's own peak: a
 * look-ahead gain limiter (not a clip) takes the gain down around any overshoot, the same on every channel.
 */
export async function reduceReverbChannels(channels: readonly Float32Array[], sampleRate: number, params: ReduceReverbParams, options: ReduceReverbChannelsOptions = {}): Promise<ReduceReverbChannelsResult> {
  const fallback: Rt60Estimate = { rt60: 0, confidence: 0, decays: 0 };
  if (channels.length === 0) return { channels: [], rt60: fallback };
  const unique: Float32Array[] = [];
  const indexOf = channels.map((channel) => {
    const found = unique.findIndex((other) => sameSamples(other, channel));
    if (found >= 0) return found;
    unique.push(channel);
    return unique.length - 1;
  });
  const results: Float32Array[] = [];
  let estimate: Rt60Estimate | undefined;
  for (let u = 0; u < unique.length; u += 1) {
    if (options.signal?.aborted) throw new ReverbCancelledError();
    const processed = await reduceReverbChannel(unique[u], sampleRate, params, {
      signal: options.signal,
      yieldNow: options.yieldNow,
      rt60: options.rt60,
      onProgress: (fraction) => options.onProgress?.((u + fraction) / unique.length),
    });
    estimate ??= processed.rt60;
    results.push(processed.output);
  }
  limitPeaks(results, peakOfChannels(channels), sampleRate);
  options.onProgress?.(1);
  return { channels: indexOf.map((u) => results[u]), rt60: estimate ?? fallback };
}
