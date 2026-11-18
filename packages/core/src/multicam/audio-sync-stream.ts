import { FFT } from "../audio/fft";
import { correlateDecimated, nextPow2, type AudioOffsetResult } from "./audio-sync";

/**
 * Memory-bounded audio sync for long recordings.
 *
 * `findAudioOffset` needs both signals fully decoded (a 60 minute stereo 48 kHz
 * file is ~1.3 GB of float samples). This variant never holds more than one
 * chunk of raw samples:
 *
 *   1. COARSE: stream each source once, reducing it to a rectified-amplitude
 *      envelope at `envelopeRate` (default 100 Hz). Cross-correlate the two
 *      envelopes (FFT) and keep the few best lags. Cost: duration * 100 floats.
 *   2. FINE: for each candidate lag, stream only a window (default 60 s) of
 *      each source around the most active overlapping stretch, decimate it to
 *      `fineRate` (4 kHz) on the fly and refine with GCC-PHAT (the same
 *      correlator `findAudioOffset` uses), searching only +-`refineSeconds`
 *      around the candidate. The candidate with the sharpest peak wins.
 *
 * Accuracy is the fine stage's: 0.25 ms steps, sub-sample refined.
 */
export interface AudioChunkSource {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  /**
   * Mono samples of [startSeconds, endSeconds) as consecutive chunks. A chunk
   * is released by the consumer before the next one is requested; sources are
   * expected to keep chunks to a second or so.
   */
  read(startSeconds: number, endSeconds: number): AsyncIterable<Float32Array>;
}

export interface StreamingSyncOptions {
  envelopeRate?: number;
  fineRate?: number;
  /** Largest |offset| searched (default 3600 s). */
  maxOffsetSeconds?: number;
  /** Length of the fine analysis window (default 60 s). */
  fineWindowSeconds?: number;
  /** Half-width of the fine search around a coarse lag (default 0.5 s). */
  refineSeconds?: number;
  /** Coarse candidates refined (default 3). */
  candidates?: number;
  onProgress?: (message: string) => void;
}

/** Box-average decimator that accepts chunks; output is bit-identical to `decimateForSync`. */
export class StreamingDecimator {
  private readonly ratio: number;
  private out: Float32Array;
  private length = 0;
  private position = 0;
  private sum = 0;
  private count = 0;
  private nextBoundary: number;

  constructor(
    sampleRate: number,
    rate: number,
    expectedSeconds: number,
    private readonly rectify = false,
  ) {
    this.ratio = sampleRate / rate;
    this.out = new Float32Array(Math.max(16, Math.ceil(expectedSeconds * rate) + 2));
    this.nextBoundary = Math.max(1, Math.floor(this.ratio));
  }

  private emit(value: number): void {
    if (this.length === this.out.length) {
      const grown = new Float32Array(this.out.length * 2);
      grown.set(this.out);
      this.out = grown;
    }
    this.out[this.length++] = value;
  }

  push(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i] ?? 0;
      this.sum += this.rectify ? Math.abs(v) : v;
      this.count++;
      this.position++;
      while (this.position >= this.nextBoundary) {
        this.emit(this.count ? this.sum / this.count : 0);
        this.sum = 0;
        this.count = 0;
        this.nextBoundary = Math.max(this.nextBoundary + 1, Math.floor((this.length + 1) * this.ratio));
        if (this.position < this.nextBoundary) break;
      }
    }
  }

  /** The decimated signal with its mean removed (unless rectified, where the caller decides). */
  finish(removeMean = true): Float32Array {
    const result = this.out.slice(0, this.length);
    if (removeMean && result.length) {
      let mean = 0;
      for (let i = 0; i < result.length; i++) mean += result[i];
      mean /= result.length;
      for (let i = 0; i < result.length; i++) result[i] -= mean;
    }
    return result;
  }
}

async function reduce(
  source: AudioChunkSource,
  start: number,
  end: number,
  rate: number,
  rectify: boolean,
): Promise<Float32Array> {
  const decimator = new StreamingDecimator(source.sampleRate, rate, Math.max(0, end - start), rectify);
  for await (const chunk of source.read(start, end)) decimator.push(chunk);
  return decimator.finish(true);
}

/** Cross-correlation of two envelopes; returns the best `count` lags (in samples) with scores. */
function envelopeLags(
  r: Float32Array,
  t: Float32Array,
  maxLag: number,
  count: number,
  minSeparation: number,
): Array<{ lag: number; score: number }> {
  const size = nextPow2(r.length + t.length);
  const fft = new FFT(size);
  const pad = (x: Float32Array): Float32Array => {
    const out = new Float32Array(size);
    out.set(x);
    return out;
  };
  const rs = fft.forward(pad(r));
  const ts = fft.forward(pad(t));
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    real[i] = ts.real[i] * rs.real[i] + ts.imag[i] * rs.imag[i];
    imag[i] = ts.imag[i] * rs.real[i] - ts.real[i] * rs.imag[i];
  }
  const c = fft.inverse(real, imag);
  const at = (d: number): number => c[((d % size) + size) % size];
  const lo = -Math.min(maxLag, t.length - 1);
  const hi = Math.min(maxLag, r.length - 1);
  const found: Array<{ lag: number; score: number }> = [];
  const taken: number[] = [];
  for (let k = 0; k < count; k++) {
    let best = -Infinity;
    let bestD = 0;
    for (let d = lo; d <= hi; d++) {
      if (taken.some((x) => Math.abs(x - d) < minSeparation)) continue;
      const v = at(d);
      if (v > best) {
        best = v;
        bestD = d;
      }
    }
    if (best === -Infinity) break;
    taken.push(bestD);
    found.push({ lag: bestD, score: best });
  }
  return found;
}

/** Start (seconds) of the `windowSeconds` stretch of `envelope` with the most activity inside [from, to]. */
function mostActiveWindow(envelope: Float32Array, rate: number, from: number, to: number, windowSeconds: number): number {
  const first = Math.max(0, Math.floor(from * rate));
  const last = Math.min(envelope.length, Math.floor(to * rate));
  const width = Math.min(last - first, Math.floor(windowSeconds * rate));
  if (width <= 0) return from;
  let sum = 0;
  for (let i = first; i < first + width; i++) sum += Math.abs(envelope[i]);
  let best = sum;
  let bestAt = first;
  for (let i = first + width; i < last; i++) {
    sum += Math.abs(envelope[i]) - Math.abs(envelope[i - width]);
    if (sum > best) {
      best = sum;
      bestAt = i - width + 1;
    }
  }
  return bestAt / rate;
}

export async function findAudioOffsetStreaming(
  reference: AudioChunkSource,
  target: AudioChunkSource,
  options: StreamingSyncOptions = {},
): Promise<AudioOffsetResult> {
  const envRate = options.envelopeRate ?? 100;
  const fineRate = options.fineRate ?? 4000;
  const windowSeconds = options.fineWindowSeconds ?? 60;
  const refine = options.refineSeconds ?? 0.5;
  const maxOffset = options.maxOffsetSeconds ?? 3600;

  options.onProgress?.("Scanning the first angle");
  const refEnv = await reduce(reference, 0, reference.durationSeconds, envRate, true);
  options.onProgress?.("Scanning the second angle");
  const tgtEnv = await reduce(target, 0, target.durationSeconds, envRate, true);
  if (refEnv.length < envRate || tgtEnv.length < envRate) return { offsetSeconds: 0, confidence: 0 };

  // Coarse lag d (envelope samples): c[d] = sum t[n + d] r[n], so offset = -d / rate.
  const lags = envelopeLags(refEnv, tgtEnv, Math.round(maxOffset * envRate), options.candidates ?? 3, envRate);

  let best: AudioOffsetResult = { offsetSeconds: 0, confidence: 0 };
  for (const [index, candidate] of lags.entries()) {
    const off0 = -candidate.lag / envRate;
    options.onProgress?.(`Refining candidate ${index + 1}/${lags.length}`);
    // Reference time range whose partner exists in the target at this lag.
    const from = Math.max(0, off0);
    const to = Math.min(reference.durationSeconds, target.durationSeconds + off0);
    if (to - from < 0.5) continue;
    const ra = mostActiveWindow(refEnv, envRate, from, to, windowSeconds);
    const rb = Math.min(to, ra + windowSeconds);
    // Pad the target window by the refine margin so the true peak lies inside.
    const tStart = Math.max(0, ra - off0 - refine);
    const tEnd = Math.min(target.durationSeconds, rb - off0 + refine);
    const r = await reduce(reference, ra, rb, fineRate, false);
    const t = await reduce(target, tStart, tEnd, fineRate, false);
    // Target window starts at tStart; its offset against the reference window
    // is (ra - tStart) + (media offset residual).
    const local = correlateDecimated(r, t, fineRate, Math.round((refine + 0.25) * fineRate) + Math.round(Math.max(0, ra - off0 - tStart) * fineRate));
    // local.offsetSeconds = (reference-window time) - (target-window time) of one sound
    //   = (a - ra) - (b - tStart) with b = a - off  =>  off - ra + tStart ... solved below.
    const offsetSeconds = local.offsetSeconds + ra - tStart;
    const result = { offsetSeconds, confidence: local.confidence };
    if (result.confidence > best.confidence || index === 0) best = result;
  }
  return best;
}

export interface WavInfo {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly float: boolean;
  readonly dataStart: number;
  readonly dataBytes: number;
}

/** Parse a RIFF/WAVE header (PCM 8/16/24/32 or float32/64) from the first bytes of `blob`. */
export async function readWavInfo(blob: Blob): Promise<WavInfo> {
  const head = new DataView(await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer());
  const tag = (at: number): string => String.fromCharCode(head.getUint8(at), head.getUint8(at + 1), head.getUint8(at + 2), head.getUint8(at + 3));
  if (head.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file.");
  let at = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (at + 8 <= head.byteLength) {
    const id = tag(at);
    const size = head.getUint32(at + 4, true);
    if (id === "fmt ") {
      let format = head.getUint16(at + 8, true);
      const bits = head.getUint16(at + 22, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID.
      if (format === 0xfffe && size >= 40) format = head.getUint16(at + 8 + 24, true);
      fmt = { format, channels: head.getUint16(at + 10, true), rate: head.getUint32(at + 12, true), bits };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before format.");
      // Untrusted header: a zero rate/channel count or an unsupported sample layout would
      // otherwise turn the frame math into NaN/Infinity (huge allocations, endless reads).
      const bytesPer = fmt.bits / 8;
      const supported = fmt.format === 3 ? fmt.bits === 32 || fmt.bits === 64 : fmt.bits === 8 || fmt.bits === 16 || fmt.bits === 24 || fmt.bits === 32;
      if (fmt.format !== 1 && fmt.format !== 3) throw new Error("Unsupported WAV encoding.");
      if (!supported || !Number.isInteger(bytesPer) || fmt.channels < 1 || fmt.rate < 1 || fmt.rate > 1_000_000) throw new Error("Unsupported WAV layout.");
      const dataStart = at + 8;
      // Streaming encoders leave 0 or 0xFFFFFFFF as the size; trust the file length then.
      const dataBytes = size === 0 || size === 0xffffffff || dataStart + size > blob.size ? blob.size - dataStart : size;
      return { sampleRate: fmt.rate, channels: fmt.channels, bitsPerSample: fmt.bits, float: fmt.format === 3, dataStart, dataBytes };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error("WAV has no data chunk.");
}

/**
 * Stream channel 0 of a WAV blob without decoding the file: slices of the blob
 * are read and converted one chunk at a time, so a disk-backed blob never has
 * to be resident as a whole.
 */
export async function wavBlobSource(blob: Blob, chunkSeconds = 1): Promise<AudioChunkSource> {
  const info = await readWavInfo(blob);
  const bytes = info.bitsPerSample / 8;
  const frameBytes = bytes * info.channels;
  const frames = Math.floor(info.dataBytes / frameBytes);
  return {
    sampleRate: info.sampleRate,
    durationSeconds: frames / info.sampleRate,
    async *read(startSeconds, endSeconds) {
      const first = Math.max(0, Math.floor(startSeconds * info.sampleRate));
      const last = Math.min(frames, Math.floor(endSeconds * info.sampleRate));
      const step = Math.max(1, Math.floor(chunkSeconds * info.sampleRate));
      for (let from = first; from < last; from += step) {
        const to = Math.min(last, from + step);
        const buffer = await blob.slice(info.dataStart + from * frameBytes, info.dataStart + to * frameBytes).arrayBuffer();
        const view = new DataView(buffer);
        const out = new Float32Array(to - from);
        for (let i = 0; i < out.length; i++) {
          const o = i * frameBytes;
          if (info.float) out[i] = bytes === 8 ? view.getFloat64(o, true) : view.getFloat32(o, true);
          else if (bytes === 1) out[i] = (view.getUint8(o) - 128) / 128;
          else if (bytes === 2) out[i] = view.getInt16(o, true) / 32768;
          else if (bytes === 3) out[i] = (view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 8388608;
          else out[i] = view.getInt32(o, true) / 2147483648;
        }
        yield out;
      }
    },
  };
}
