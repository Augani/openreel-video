import { DFN3_SAMPLE_RATE, EnhanceCancelledError, enhanceMono48k, type Dfn3Inference } from "./dfn3-dsp";
import { resample } from "./resample";

export interface EnhanceChannelsOptions {
  readonly infer: Dfn3Inference;
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: { readonly aborted: boolean };
}

const sameSamples = (a: Float32Array, b: Float32Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

const peakOf = (channels: readonly Float32Array[]): number => {
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
};

/** RMS the network sees (about -20 dBFS, the level it is trained on); the output is scaled back afterwards. */
export const ENHANCE_TARGET_RMS = 0.1;
const MIN_LEVEL_SCALE = 1e-3;
const MAX_LEVEL_SCALE = 1e3;

/**
 * The gain that brings the clip to the network's working level. It is a pure function of the samples' level, so a clip
 * decoded at a different level (mono versus a -3 dB stereo upmix, say) is enhanced to the same result, scaled: the preview
 * and the export of the same file agree even when their decoders differ in level. Silence keeps gain 1.
 */
export function enhanceLevelScale(channels: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) sum += channel[i] * channel[i];
    count += channel.length;
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  if (!(rms > 1e-7)) return 1;
  return Math.min(MAX_LEVEL_SCALE, Math.max(MIN_LEVEL_SCALE, ENHANCE_TARGET_RMS / rms));
}

/**
 * Enhances every channel of a clip's source. Channels run through the 48 kHz mono network one at a time
 * (resampled in and back out, so the result has the source's rate and length); identical channels (dual-mono dialogue)
 * are processed once. The network works at a fixed level (see {@link enhanceLevelScale}). The result never peaks above max(source peak, 0.999): a uniform trim is applied if it would.
 */
export async function enhanceChannels(channels: readonly Float32Array[], sampleRate: number, options: EnhanceChannelsOptions): Promise<Float32Array[]> {
  if (channels.length === 0) return [];
  const unique: Float32Array[] = [];
  const indexOf: number[] = channels.map((channel) => {
    const found = unique.findIndex((other) => sameSamples(other, channel));
    if (found >= 0) return found;
    unique.push(channel);
    return unique.length - 1;
  });
  const results: Float32Array[] = [];
  const scale = enhanceLevelScale(unique);
  for (let u = 0; u < unique.length; u += 1) {
    if (options.signal?.aborted) throw new EnhanceCancelledError();
    const source = unique[u];
    const scaled = scale === 1 ? source : Float32Array.from(source, (v) => v * scale);
    const at48 = resample(scaled, sampleRate, DFN3_SAMPLE_RATE);
    const enhanced = await enhanceMono48k(at48, {
      infer: options.infer,
      signal: options.signal,
      onProgress: (fraction) => options.onProgress?.((u + fraction) / unique.length),
    });
    const restored = resample(enhanced, DFN3_SAMPLE_RATE, sampleRate, source.length);
    if (scale !== 1) for (let i = 0; i < restored.length; i += 1) restored[i] /= scale;
    results.push(restored);
  }
  const out = indexOf.map((u) => results[u]);
  const limit = Math.max(0.999, peakOf(channels));
  const peak = peakOf(results);
  if (peak > limit) {
    const scale = limit / peak;
    for (const channel of results) for (let i = 0; i < channel.length; i += 1) channel[i] *= scale;
  }
  options.onProgress?.(1);
  return out;
}
