/**
 * Band-limited resampler (Kaiser-windowed sinc, tabulated kernel). Used to bring a clip to the 48 kHz the speech
 * model runs at and back to the source rate, so the enhanced audio lines up sample for sample with the original.
 */

const ZERO_CROSSINGS = 20;
const TABLE_STEPS = 256;
const KAISER_BETA = 9;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k += 1) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-14 * sum) break;
  }
  return sum;
}

const kernelCache = new Map<number, Float64Array>();

/** Kernel samples h(u) for u in [0, ZERO_CROSSINGS] (zero crossings of the cutoff-scaled sinc), TABLE_STEPS per unit. */
function kernelTable(): Float64Array {
  const cached = kernelCache.get(0);
  if (cached) return cached;
  const size = ZERO_CROSSINGS * TABLE_STEPS + 2;
  const table = new Float64Array(size);
  const norm = besselI0(KAISER_BETA);
  for (let i = 0; i < size; i += 1) {
    const u = i / TABLE_STEPS;
    const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
    const r = u / ZERO_CROSSINGS;
    const win = r >= 1 ? 0 : besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / norm;
    table[i] = sinc * win;
  }
  kernelCache.set(0, table);
  return table;
}

/** Output length for converting `length` samples from one rate to another (rounded, never below 1 for non-empty input). */
export function resampledLength(length: number, from: number, to: number): number {
  if (length <= 0) return 0;
  if (from === to) return length;
  return Math.max(1, Math.round((length * to) / from));
}

/**
 * Resamples `input` from `from` Hz to `to` Hz. Content above the lower Nyquist is removed (with a small guard band
 * when downsampling). Same rate returns the input itself. `outLength` forces an exact output length.
 */
export function resample(input: Float32Array, from: number, to: number, outLength = resampledLength(input.length, from, to)): Float32Array {
  if (from === to && outLength === input.length) return input;
  const out = new Float32Array(outLength);
  if (input.length === 0 || outLength === 0) return out;
  const table = kernelTable();
  const ratio = from / to;
  // Cutoff relative to the INPUT rate: below 1 when downsampling (anti-alias), 1 when upsampling.
  const cutoff = Math.min(1, to / from) * 0.98;
  const support = ZERO_CROSSINGS / cutoff;
  const n = input.length;
  for (let j = 0; j < outLength; j += 1) {
    const centre = j * ratio;
    const first = Math.max(0, Math.ceil(centre - support));
    const last = Math.min(n - 1, Math.floor(centre + support));
    let acc = 0;
    for (let k = first; k <= last; k += 1) {
      const pos = Math.abs(k - centre) * cutoff * TABLE_STEPS;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      acc += input[k] * (table[i0] * (1 - frac) + table[i0 + 1] * frac);
    }
    out[j] = acc * cutoff;
  }
  return out;
}
