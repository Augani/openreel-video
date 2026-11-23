/**
 * Objective dereverberation metrics for tests and the measurement table. Test-only; nothing here ships in the app bundle.
 *
 * Every metric works on a (dry reference, processed output) pair, because the processing is time-varying and has no impulse
 * response of its own. Where an impulse response is needed (C50) it is the least-squares "effective" response of the dry-to-output
 * system, estimated by regularised deconvolution over the whole signal: a proxy, close to the room's own response for the
 * reverberant input (it reads a little low: spectral holes of the speech are filled by the regularisation), indicative for a
 * time-varying system.
 */
import { FFT } from "../fft";

const nextPow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/** Linear convolution by FFT (the naive one in the enhance test signals is O(N x taps), too slow for 1.5 s rooms). Output has the length of `x`. */
export function fftConvolve(x: Float32Array, h: Float32Array): Float32Array {
  const n = nextPow2(x.length + h.length);
  const fft = new FFT(n);
  const pad = (v: Float32Array): Float32Array => {
    const p = new Float32Array(n);
    p.set(v);
    return p;
  };
  const a = fft.forward(pad(x));
  const b = fft.forward(pad(h));
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 0; k < n; k += 1) {
    re[k] = a.real[k] * b.real[k] - a.imag[k] * b.imag[k];
    im[k] = a.real[k] * b.imag[k] + a.imag[k] * b.real[k];
  }
  return fft.inverse(re, im).slice(0, x.length);
}

/** The impulse response with everything after the early window (50 ms after the direct arrival) removed: the target of late-reverb suppression. */
export function earlyPart(h: Float32Array, rate: number, seconds = 0.05): Float32Array {
  const out = new Float32Array(h.length);
  let peakAt = 0;
  for (let i = 1; i < h.length; i += 1) if (Math.abs(h[i]) > Math.abs(h[peakAt])) peakAt = i;
  const end = Math.min(h.length, peakAt + Math.round(seconds * rate));
  out.set(h.subarray(0, end));
  return out;
}

/** Effective impulse response (first `seconds`) of the system that turned `dry` into `out`. */
export function effectiveImpulseResponse(dry: Float32Array, out: Float32Array, rate: number, seconds = 3): Float32Array {
  const n = nextPow2(Math.min(dry.length, out.length) + Math.round(seconds * rate) + 1);
  const fft = new FFT(n);
  const pad = (x: Float32Array): Float32Array => {
    const p = new Float32Array(n);
    p.set(x.subarray(0, Math.min(x.length, n)));
    return p;
  };
  const s = fft.forward(pad(dry));
  const y = fft.forward(pad(out));
  let mean = 0;
  for (let k = 0; k < n; k += 1) mean += s.real[k] * s.real[k] + s.imag[k] * s.imag[k];
  mean /= n;
  const lambda = mean * 1e-4;
  const hr = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let k = 0; k < n; k += 1) {
    const den = s.real[k] * s.real[k] + s.imag[k] * s.imag[k] + lambda;
    // Y * conj(S) / (|S|^2 + lambda)
    hr[k] = (y.real[k] * s.real[k] + y.imag[k] * s.imag[k]) / den;
    hi[k] = (y.imag[k] * s.real[k] - y.real[k] * s.imag[k]) / den;
  }
  const h = fft.inverse(hr, hi);
  return h.slice(0, Math.round(seconds * rate));
}

/** Clarity C50 in dB: early (first 50 ms from the direct arrival) over late energy of an impulse response. */
export function clarityC50(h: Float32Array, rate: number): number {
  let peakAt = 0;
  for (let i = 1; i < h.length; i += 1) if (Math.abs(h[i]) > Math.abs(h[peakAt])) peakAt = i;
  const split = peakAt + Math.round(0.05 * rate);
  let early = 0;
  let late = 0;
  for (let i = Math.max(0, peakAt - 8); i < h.length; i += 1) {
    if (i < split) early += h[i] * h[i];
    else late += h[i] * h[i];
  }
  return 10 * Math.log10((early + 1e-30) / (late + 1e-30));
}

/** Frames (10 ms) of `dry` that are silent (more than `rangeDb` under the loudest frame) as [start, end) sample ranges at least `minSeconds` long. */
export function dryGaps(dry: Float32Array, rate: number, minSeconds = 0.18, rangeDb = 40): Array<[number, number]> {
  const frame = Math.round(rate * 0.01);
  const count = Math.floor(dry.length / frame);
  const level = new Float64Array(count);
  let peak = -Infinity;
  for (let f = 0; f < count; f += 1) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i += 1) s += dry[i] * dry[i];
    level[f] = 10 * Math.log10(s / frame + 1e-20);
    peak = Math.max(peak, level[f]);
  }
  const gaps: Array<[number, number]> = [];
  let startFrame = -1;
  for (let f = 0; f <= count; f += 1) {
    const silent = f < count && level[f] < peak - rangeDb;
    if (silent && startFrame < 0) startFrame = f;
    if (!silent && startFrame >= 0) {
      if ((f - startFrame) * frame >= minSeconds * rate) gaps.push([startFrame * frame, f * frame]);
      startFrame = -1;
    }
  }
  return gaps;
}

const meanPowerDb = (x: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i += 1) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, to - from) + 1e-20);
};

/**
 * Late tail level in the pauses of the dry speech (60 to 160 ms after each pause begins), as the mean dB of the output relative
 * to the same window of the reverberant input. Negative is better; it is how much of the smeared tail left the pauses.
 */
export function tailLevelChangeDb(dry: Float32Array, reverberant: Float32Array, out: Float32Array, rate: number): number {
  const gaps = dryGaps(dry, rate);
  const a = Math.round(0.06 * rate);
  const b = Math.round(0.16 * rate);
  let before = 0;
  let after = 0;
  let used = 0;
  for (const [start, end] of gaps) {
    if (end - start < b) continue;
    let e0 = 0;
    let e1 = 0;
    for (let i = start + a; i < start + b; i += 1) {
      e0 += reverberant[i] * reverberant[i];
      e1 += out[i] * out[i];
    }
    before += e0;
    after += e1;
    used += 1;
  }
  if (used === 0) return Number.NaN;
  return 10 * Math.log10((after + 1e-30) / (before + 1e-30));
}

/** Level change (dB) of the output against the input over the frames where the dry speech is active (loudest 50 % of 10 ms frames). */
export function speechLevelChangeDb(dry: Float32Array, input: Float32Array, out: Float32Array, rate: number): number {
  const frame = Math.round(rate * 0.01);
  const count = Math.floor(dry.length / frame);
  const levels = Array.from({ length: count }, (_, f) => meanPowerDb(dry, f * frame, (f + 1) * frame));
  const threshold = [...levels].sort((p, q) => p - q)[Math.floor(count / 2)];
  let before = 0;
  let after = 0;
  for (let f = 0; f < count; f += 1) {
    if (levels[f] < threshold) continue;
    for (let i = f * frame; i < (f + 1) * frame; i += 1) {
      before += input[i] * input[i];
      after += out[i] * out[i];
    }
  }
  return 10 * Math.log10((after + 1e-30) / (before + 1e-30));
}

/**
 * Isolated time-frequency blips per second in the pauses of the dry speech (from 80 ms after each pause begins): cells of a
 * 1024-point spectrogram that are a local maximum and stand 6 dB above the same frequency two frames earlier and two frames
 * later (so a steady harmonic line does not count). A smoothly decaying tail has almost none; spectral-subtraction "musical
 * noise" (tonal blips that come and go) has many.
 */
export function musicalNoisePerSecond(dry: Float32Array, out: Float32Array, rate: number): number {
  const size = 1024;
  const hop = 256;
  const fft = new FFT(size);
  const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const frames = Math.floor((out.length - size) / hop);
  const logMag: Float32Array[] = [];
  const scratch = new Float32Array(size);
  const bins = size / 2;
  const lo = Math.round((200 * size) / rate);
  const hi = Math.min(bins - 2, Math.round((7000 * size) / rate));
  for (let f = 0; f < frames; f += 1) {
    for (let i = 0; i < size; i += 1) scratch[i] = out[f * hop + i] * window[i];
    const { real, imag } = fft.forward(scratch);
    const row = new Float32Array(bins);
    for (let k = 0; k < bins; k += 1) row[k] = 10 * Math.log10(real[k] * real[k] + imag[k] * imag[k] + 1e-20);
    logMag.push(row);
  }
  const gaps = dryGaps(dry, rate, 0.25);
  let seconds = 0;
  let count = 0;
  for (const [start, end] of gaps) {
    const f0 = Math.ceil((start + 0.08 * rate) / hop) + 2;
    const f1 = Math.floor((end - size) / hop) - 2;
    if (f1 <= f0) continue;
    seconds += ((f1 - f0) * hop) / rate;
    for (let f = f0; f < f1; f += 1) {
      for (let k = lo; k <= hi; k += 1) {
        const v = logMag[f][k];
        let peak = true;
        for (let df = -1; df <= 1 && peak; df += 1) {
          for (let dk = -1; dk <= 1; dk += 1) {
            if (df === 0 && dk === 0) continue;
            if (logMag[f + df][k + dk] >= v) {
              peak = false;
              break;
            }
          }
        }
        if (!peak) continue;
        // A blip, not a harmonic line: it must stand well above the same frequency two frames before AND after.
        let before = -Infinity;
        let after = -Infinity;
        for (let dk = -1; dk <= 1; dk += 1) {
          before = Math.max(before, logMag[f - 2][k + dk]);
          after = Math.max(after, logMag[f + 2][k + dk]);
        }
        if (v - Math.max(before, after) > 6) count += 1;
      }
    }
  }
  return seconds > 0 ? count / seconds : Number.NaN;
}
