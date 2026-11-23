/**
 * Peak headroom for Reduce Reverb. The spectral stages can ring a little above the input on loud or clipped material (a peak
 * ratio of 1.4 was measured), and anything above the source's own peak is a new overload. This limits by GAIN, not by clipping:
 * a look-ahead limiter takes the gain down smoothly around each overshoot (the same gain on every channel, so the stereo image
 * holds) and back up afterwards. Samples that are already within the limit are not touched, so a clean result is bit-identical.
 */

/** Look-ahead / release span of the limiter, in seconds each side of an overshoot. */
const LIMITER_SPAN_SECONDS = 0.004;

export function peakOfChannels(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  return peak;
}

/**
 * Limits `channels` in place so no sample exceeds `limit`. Returns the strongest gain reduction applied (1 when untouched).
 * The gain at every sample is at most limit / |sample|, and changes over about 4 ms either side so there are no steps.
 */
export function limitPeaks(channels: readonly Float32Array[], limit: number, sampleRate: number): number {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || !(limit > 0)) return 1;
  let over = false;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      if (Math.abs(channel[i]) > limit) {
        over = true;
        break;
      }
    }
    if (over) break;
  }
  if (!over) return 1;
  const need = new Float32Array(length).fill(1);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) {
      const magnitude = Math.abs(channel[i]);
      if (magnitude > limit) need[i] = Math.min(need[i], limit / magnitude);
    }
  }
  const half = Math.max(1, Math.round(LIMITER_SPAN_SECONDS * sampleRate));
  // Sliding minimum over +-2*half (monotonic deque), then a box average over +-half: every sample is within 2*half of the
  // minimum that covers it, so the average can never be above the gain that sample needs.
  const reach = 2 * half;
  const floor = new Float32Array(length);
  const deque = new Int32Array(length);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < length; i += 1) {
    const upto = Math.min(length - 1, i + reach);
    for (; next <= upto; next += 1) {
      while (tail > head && need[deque[tail - 1]] >= need[next]) tail -= 1;
      deque[tail++] = next;
    }
    while (deque[head] < i - reach) head += 1;
    floor[i] = need[deque[head]];
  }
  const prefix = new Float64Array(length + 1);
  for (let i = 0; i < length; i += 1) prefix[i + 1] = prefix[i] + floor[i];
  let strongest = 1;
  for (let i = 0; i < length; i += 1) {
    const from = Math.max(0, i - half);
    const to = Math.min(length - 1, i + half);
    // Edges are padded with the edge value so the average does not drift towards 1 at the ends.
    const missing = 2 * half + 1 - (to - from + 1);
    const edge = i - half < 0 ? floor[0] : floor[length - 1];
    const gain = Math.min(need[i], 1, (prefix[to + 1] - prefix[from] + missing * edge) / (2 * half + 1));
    if (gain >= 1) continue;
    strongest = Math.min(strongest, gain);
    for (const channel of channels) channel[i] *= gain;
  }
  return strongest;
}
