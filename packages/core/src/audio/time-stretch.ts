/**
 * Pitch-preserving time stretch (WSOLA: waveform-similarity overlap-add).
 *
 * `speed` is the playback speed: 2 = twice as fast (output is half as long),
 * 0.5 = half speed. Pitch is unchanged because every output frame is an
 * unmodified excerpt of the input; only the spacing of the excerpts changes,
 * and each excerpt is nudged to the position that continues the previous one
 * most smoothly (cross-correlation over a short search window).
 */

const FRAME_SECONDS = 0.04;
const SEARCH_SECONDS = 0.012;
const MIN_RATE = 0.05;
const MAX_RATE = 64;

const clampRate = (rate: number): number =>
  Number.isFinite(rate) && rate > 0 ? Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) : 1;

/** Output length in frames for a given input length and speed. */
export const stretchedLength = (inputLength: number, rate: number): number =>
  Math.max(0, Math.round(inputLength / clampRate(rate)));

/** True when a clip at this speed should be time-stretched instead of resampled. */
export const shouldPreservePitch = (
  speed: number | undefined,
  pitchCorrection: boolean | undefined,
): boolean =>
  pitchCorrection !== false &&
  typeof speed === "number" &&
  Number.isFinite(speed) &&
  speed > 0 &&
  Math.abs(speed - 1) > 1e-6;

export const timeStretchChannels = (
  input: readonly Float32Array[],
  sampleRate: number,
  speed: number,
): Float32Array[] => {
  const rate = clampRate(speed);
  const channelCount = input.length;
  if (channelCount === 0) return [];
  const inLength = input[0].length;
  const outLength = stretchedLength(inLength, rate);
  const output = input.map(() => new Float32Array(outLength));
  if (outLength === 0 || inLength === 0) return output;

  let frame = Math.max(64, Math.round(FRAME_SECONDS * sampleRate));
  frame += frame % 2;
  const half = frame / 2;
  const search = Math.max(8, Math.round(SEARCH_SECONDS * sampleRate));
  const analysisHop = half * rate;

  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  const mono = new Float32Array(inLength);
  for (const channel of input) for (let i = 0; i < inLength; i++) mono[i] += channel[i] / channelCount;

  const weight = new Float32Array(outLength);
  const sample = (data: Float32Array, index: number): number =>
    index >= 0 && index < inLength ? data[index] : 0;

  let previous = 0;
  for (let k = 0; k * half < outLength; k++) {
    const nominal = Math.round(k * analysisHop);
    let start = nominal;
    if (k > 0) {
      // The natural continuation of the previous excerpt is what followed it in the input.
      const templateStart = previous + half;
      let best = -Infinity;
      for (let delta = -search; delta <= search; delta += 2) {
        const candidate = nominal + delta;
        if (candidate < 0 || candidate >= inLength) continue;
        let score = 0;
        for (let i = 0; i < half; i += 4) score += sample(mono, templateStart + i) * sample(mono, candidate + i);
        if (score > best) {
          best = score;
          start = candidate;
        }
      }
    }
    previous = start;

    const outStart = k * half;
    for (let i = 0; i < frame; i++) {
      const outIndex = outStart + i;
      if (outIndex >= outLength) break;
      // The very first half-frame has nothing to cross-fade with, so it is kept flat.
      const w = k === 0 && i < half ? 1 : window[i];
      weight[outIndex] += w;
      for (let c = 0; c < channelCount; c++) output[c][outIndex] += w * sample(input[c], start + i);
    }
  }

  for (let i = 0; i < outLength; i++) {
    const w = weight[i];
    if (w > 1e-4) for (let c = 0; c < channelCount; c++) output[c][i] /= w;
  }
  return output;
};
