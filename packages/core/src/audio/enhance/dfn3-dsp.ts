/**
 * DeepFilterNet3 signal path (feature extraction, mask and deep-filter application, STFT framing), in plain TypeScript.
 *
 * DeepFilterNet3 (Schroeter et al., MIT / Apache-2.0) is a 48 kHz speech enhancement network. Its ONNX export is a
 * pure causal sequence model: it takes the per-frame features below and returns an ERB-band gain mask plus
 * deep-filter coefficients; everything around it (STFT, ERB features, running normalisation, applying the outputs)
 * lives here, so the same code runs in a worker, inline and in tests, and the network itself is injected as
 * {@link Dfn3Inference}.
 *
 * Framing: 960-sample frames at hop 480 with a Vorbis window, analysis scaled by 1/960. Frame t covers input
 * samples [(t-1)*480, (t+1)*480), so the first frame is half zero padding; the overlap-add output of frame t is the
 * time span [(t-1)*480, t*480). The network sees 2 frames of look-ahead: its output at feature index j belongs to
 * frame j-2, and the deep filter for frame t combines noisy frames t-2..t+2.
 */
import { DFN3_SAMPLE_RATE, EnhanceCancelledError } from "./enhance-constants";
import { MixedRadixFFT } from "./mixed-radix-fft";

export { DFN3_SAMPLE_RATE, EnhanceCancelledError };

export const DFN3_FFT_SIZE = 960;
export const DFN3_HOP = 480;
export const DFN3_BINS = DFN3_FFT_SIZE / 2 + 1;
export const DFN3_ERB_BANDS = 32;
export const DFN3_DF_BINS = 96;
export const DFN3_DF_ORDER = 5;
export const DFN3_LOOKAHEAD = 2;
/** Running-normalisation smoothing (tau 1 s at hop 10 ms, rounded to three decimals as the reference does). */
export const DFN3_NORM_ALPHA = 0.99;
/** Output frames computed per network call, and frames of earlier context fed (and discarded) to warm up the GRUs. */
export const DFN3_SEGMENT_FRAMES = 1000;
export const DFN3_PREROLL_FRAMES = 150;

/** ERB band widths in bins (sum = 481), exactly as the reference `erb_fb` builds them for 48 kHz / 960 / 32 bands / min 2 bins. */
export function dfn3ErbWidths(): number[] {
  const sr = DFN3_SAMPLE_RATE;
  const freqToErb = (f: number) => 9.265 * Math.log(1 + f / (24.7 * 9.265));
  const erbToFreq = (e: number) => 24.7 * 9.265 * (Math.exp(e / 9.265) - 1);
  const freqWidth = sr / DFN3_FFT_SIZE;
  const erbLow = freqToErb(0);
  const erbHigh = freqToErb(sr / 2);
  const step = (erbHigh - erbLow) / DFN3_ERB_BANDS;
  const minFreqs = 2;
  const widths: number[] = new Array(DFN3_ERB_BANDS).fill(0);
  let prevFreq = 0;
  let freqOver = 0;
  for (let i = 1; i <= DFN3_ERB_BANDS; i += 1) {
    const f = erbToFreq(erbLow + i * step);
    const fb = Math.round(f / freqWidth);
    let nb = fb - prevFreq - freqOver;
    if (nb < minFreqs) {
      freqOver = minFreqs - nb;
      nb = minFreqs;
    } else {
      freqOver = 0;
    }
    widths[i - 1] = nb;
    prevFreq = fb;
  }
  widths[DFN3_ERB_BANDS - 1] += 1;
  const tooLarge = widths.reduce((a, b) => a + b, 0) - DFN3_BINS;
  if (tooLarge > 0) widths[DFN3_ERB_BANDS - 1] -= tooLarge;
  return widths;
}

/** Vorbis power-complementary window of the STFT. */
export function dfn3Window(): Float64Array {
  const w = new Float64Array(DFN3_FFT_SIZE);
  for (let i = 0; i < DFN3_FFT_SIZE; i += 1) {
    const s = Math.sin((Math.PI * (i + 0.5)) / DFN3_FFT_SIZE);
    w[i] = Math.sin(0.5 * Math.PI * s * s);
  }
  return w;
}

/** What the network returns for `frames` consecutive feature frames. */
export interface Dfn3Outputs {
  /** [frames][32] ERB gains in 0..1. */
  readonly mask: Float32Array;
  /** [frames][96 bins][5 taps][re, im]; tap 0 weights the oldest noisy frame (t-2), tap 4 the newest (t+2). */
  readonly coefs: Float32Array;
}

/**
 * Runs the network over `frames` consecutive frames. `erb` is [frames][32]; `spec` is two planes, [re][frames][96] then
 * [im][frames][96]. Must be causal in time (the exported model is) and deterministic.
 */
export type Dfn3Inference = (erb: Float32Array, spec: Float32Array, frames: number) => Promise<Dfn3Outputs>;

interface StoredFrame {
  re: Float32Array;
  im: Float32Array;
  erb: Float32Array;
  cspec: Float32Array;
}

/** Sequential STFT + feature generator over one 48 kHz mono signal; frame `t` is computed once and in order. */
class FrameSource {
  private readonly fft = new MixedRadixFFT(DFN3_FFT_SIZE);
  private readonly window = dfn3Window();
  private readonly widths = dfn3ErbWidths();
  private readonly erbState = new Float64Array(DFN3_ERB_BANDS);
  private readonly unitState = new Float64Array(DFN3_DF_BINS);
  private readonly inRe = new Float64Array(DFN3_FFT_SIZE);
  private readonly inIm = new Float64Array(DFN3_FFT_SIZE);
  private readonly outRe = new Float64Array(DFN3_FFT_SIZE);
  private readonly outIm = new Float64Array(DFN3_FFT_SIZE);
  private readonly frames = new Map<number, StoredFrame>();
  private next = 0;

  constructor(private readonly signal: Float32Array) {
    for (let b = 0; b < DFN3_ERB_BANDS; b += 1) this.erbState[b] = -60 + (-30 * b) / (DFN3_ERB_BANDS - 1);
    for (let f = 0; f < DFN3_DF_BINS; f += 1) this.unitState[f] = 0.001 + ((0.0001 - 0.001) * f) / (DFN3_DF_BINS - 1);
  }

  /** The frame, or null when it has been trimmed or lies before the signal. Frames past the last computed one are computed now. */
  get(t: number): StoredFrame | null {
    if (t < 0) return null;
    while (this.next <= t) this.compute(this.next++);
    return this.frames.get(t) ?? null;
  }

  trimBelow(t: number): void {
    for (const key of this.frames.keys()) if (key < t) this.frames.delete(key);
  }

  private compute(t: number): void {
    const { signal, window, inRe, inIm, outRe, outIm } = this;
    const start = (t - 1) * DFN3_HOP;
    for (let n = 0; n < DFN3_FFT_SIZE; n += 1) {
      const i = start + n;
      inRe[n] = i >= 0 && i < signal.length ? signal[i] * window[n] : 0;
      inIm[n] = 0;
    }
    this.fft.forward(inRe, inIm, outRe, outIm);
    const norm = 1 / DFN3_FFT_SIZE;
    const re = new Float32Array(DFN3_BINS);
    const im = new Float32Array(DFN3_BINS);
    for (let k = 0; k < DFN3_BINS; k += 1) {
      re[k] = outRe[k] * norm;
      im[k] = outIm[k] * norm;
    }
    const erb = new Float32Array(DFN3_ERB_BANDS);
    let bin = 0;
    for (let b = 0; b < DFN3_ERB_BANDS; b += 1) {
      const width = this.widths[b];
      let sum = 0;
      for (let j = 0; j < width; j += 1, bin += 1) sum += re[bin] * re[bin] + im[bin] * im[bin];
      const db = 10 * Math.log10(sum / width + 1e-10);
      const s = db * (1 - DFN3_NORM_ALPHA) + this.erbState[b] * DFN3_NORM_ALPHA;
      this.erbState[b] = s;
      erb[b] = (db - s) / 40;
    }
    const cspec = new Float32Array(2 * DFN3_DF_BINS);
    for (let f = 0; f < DFN3_DF_BINS; f += 1) {
      const mag = Math.hypot(re[f], im[f]);
      const s = mag * (1 - DFN3_NORM_ALPHA) + this.unitState[f] * DFN3_NORM_ALPHA;
      this.unitState[f] = s;
      const scale = 1 / Math.sqrt(s);
      cspec[f] = re[f] * scale;
      cspec[DFN3_DF_BINS + f] = im[f] * scale;
    }
    this.frames.set(t, { re, im, erb, cspec });
  }
}

export interface EnhanceMonoOptions {
  readonly infer: Dfn3Inference;
  /** 0..1 as frames are finished. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: { readonly aborted: boolean };
  /** Frames per network call (default {@link DFN3_SEGMENT_FRAMES}). */
  readonly segmentFrames?: number;
  readonly prerollFrames?: number;
}

/**
 * Enhances a 48 kHz mono signal. The output has the same length and is time-aligned with the input (the STFT's
 * 10 ms latency is compensated). Pure function of the samples and the network.
 */
export async function enhanceMono48k(input: Float32Array, options: EnhanceMonoOptions): Promise<Float32Array> {
  const length = input.length;
  const out = new Float32Array(length);
  if (length === 0) return out;
  const segment = Math.max(1, options.segmentFrames ?? DFN3_SEGMENT_FRAMES);
  const preroll = Math.max(0, options.prerollFrames ?? DFN3_PREROLL_FRAMES);
  const totalFrames = Math.ceil(length / DFN3_HOP) + 1;
  const source = new FrameSource(input);
  const synth = new MixedRadixFFT(DFN3_FFT_SIZE);
  const window = dfn3Window();
  const widths = dfn3ErbWidths();
  const bandOfBin = new Uint8Array(DFN3_BINS);
  for (let b = 0, bin = 0; b < DFN3_ERB_BANDS; b += 1) for (let j = 0; j < widths[b]; j += 1) bandOfBin[bin++] = b;
  const inRe = new Float64Array(DFN3_FFT_SIZE);
  const inIm = new Float64Array(DFN3_FFT_SIZE);
  const outRe = new Float64Array(DFN3_FFT_SIZE);
  const outIm = new Float64Array(DFN3_FFT_SIZE);
  const specRe = new Float64Array(DFN3_BINS);
  const specIm = new Float64Array(DFN3_BINS);

  for (let a = 0; a < totalFrames; a += segment) {
    if (options.signal?.aborted) throw new EnhanceCancelledError();
    const b = Math.min(totalFrames, a + segment);
    // Feature indices j in [first, b + LOOKAHEAD - 1]; the output at j belongs to frame j - LOOKAHEAD.
    const first = Math.max(0, a + DFN3_LOOKAHEAD - preroll);
    const last = b + DFN3_LOOKAHEAD - 1;
    const frames = last - first + 1;
    const erb = new Float32Array(frames * DFN3_ERB_BANDS);
    const spec = new Float32Array(2 * frames * DFN3_DF_BINS);
    for (let j = first; j <= last; j += 1) {
      // Features of frames past the end continue as the STFT of silence, like the streaming reference's flush.
      const frame = source.get(j);
      if (!frame) continue;
      const row = j - first;
      erb.set(frame.erb, row * DFN3_ERB_BANDS);
      spec.set(frame.cspec.subarray(0, DFN3_DF_BINS), row * DFN3_DF_BINS);
      spec.set(frame.cspec.subarray(DFN3_DF_BINS), (frames + row) * DFN3_DF_BINS);
    }
    const result = await options.infer(erb, spec, frames);
    if (options.signal?.aborted) throw new EnhanceCancelledError();
    for (let t = a; t < b; t += 1) {
      const row = t + DFN3_LOOKAHEAD - first;
      const mask = result.mask.subarray(row * DFN3_ERB_BANDS, (row + 1) * DFN3_ERB_BANDS);
      const self = source.get(t);
      if (!self) continue;
      for (let k = DFN3_DF_BINS; k < DFN3_BINS; k += 1) {
        const g = mask[bandOfBin[k]];
        specRe[k] = self.re[k] * g;
        specIm[k] = self.im[k] * g;
      }
      const coefBase = row * DFN3_DF_BINS * DFN3_DF_ORDER * 2;
      for (let f = 0; f < DFN3_DF_BINS; f += 1) {
        let accRe = 0;
        let accIm = 0;
        for (let i = 0; i < DFN3_DF_ORDER; i += 1) {
          const x = source.get(t - DFN3_LOOKAHEAD + i);
          if (!x) continue;
          const c = coefBase + (f * DFN3_DF_ORDER + i) * 2;
          const cr = result.coefs[c];
          const ci = result.coefs[c + 1];
          accRe += cr * x.re[f] - ci * x.im[f];
          accIm += cr * x.im[f] + ci * x.re[f];
        }
        specRe[f] = accRe;
        specIm[f] = accIm;
      }
      for (let k = 0; k < DFN3_BINS; k += 1) {
        inRe[k] = specRe[k];
        inIm[k] = specIm[k];
      }
      for (let k = DFN3_BINS; k < DFN3_FFT_SIZE; k += 1) {
        inRe[k] = specRe[DFN3_FFT_SIZE - k];
        inIm[k] = -specIm[DFN3_FFT_SIZE - k];
      }
      inIm[0] = 0;
      inIm[DFN3_FFT_SIZE / 2] = 0;
      synth.inverse(inRe, inIm, outRe, outIm);
      const start = (t - 1) * DFN3_HOP;
      for (let n = 0; n < DFN3_FFT_SIZE; n += 1) {
        const i = start + n;
        if (i >= 0 && i < length) out[i] += outRe[n] * window[n];
      }
    }
    source.trimBelow(Math.max(0, Math.min(b + DFN3_LOOKAHEAD - preroll, b - DFN3_LOOKAHEAD)));
    options.onProgress?.(b / totalFrames);
  }
  return out;
}
