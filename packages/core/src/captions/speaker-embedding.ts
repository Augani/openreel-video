/**
 * On-device speaker embedding: a compact voice-print from MFCC statistics and
 * pitch, computed with plain DSP (no model download, no network). It is a
 * classical i-vector-lite, good for telling a handful of voices apart inside
 * one programme, not for identifying people across recordings.
 */

export const EMBEDDING_SAMPLE_RATE = 16_000;
const FRAME = 512;
const HOP = 160;
const MEL_BANDS = 26;
const MFCCS = 13;
const MIN_VOICED_SECONDS = 0.3;
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 420;

export const SPEAKER_EMBEDDING_DIMENSIONS = (MFCCS - 1) * 2 + 2;

/**
 * Per-dimension weights applied when clustering (after z-scoring). Mean pitch
 * is the most text-independent cue but natural intonation moves it, so it is
 * only doubled; MFCC deviations are the most text-dependent and are halved;
 * pitch deviation is ignored. Checked on 7 distinct voices speaking different
 * sentences.
 */
export const SPEAKER_EMBEDDING_WEIGHTS: readonly number[] = [
  ...Array<number>(MFCCS - 1).fill(1),
  ...Array<number>(MFCCS - 1).fill(0.5),
  2,
  0,
];

const hz2mel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const mel2hz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

let cachedBank: { filters: Float32Array[]; window: Float32Array } | null = null;

function bank() {
  if (cachedBank) return cachedBank;
  const bins = FRAME / 2 + 1;
  const lo = hz2mel(60);
  const hi = hz2mel(EMBEDDING_SAMPLE_RATE / 2 - 200);
  const points = Array.from({ length: MEL_BANDS + 2 }, (_, i) =>
    Math.floor(((FRAME + 1) * mel2hz(lo + ((hi - lo) * i) / (MEL_BANDS + 1))) / EMBEDDING_SAMPLE_RATE),
  );
  const filters = Array.from({ length: MEL_BANDS }, (_, m) => {
    const f = new Float32Array(bins);
    for (let k = points[m]; k < points[m + 1]; k++) f[k] = (k - points[m]) / Math.max(1, points[m + 1] - points[m]);
    for (let k = points[m + 1]; k < points[m + 2]; k++) f[k] = (points[m + 2] - k) / Math.max(1, points[m + 2] - points[m + 1]);
    return f;
  });
  const window = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  cachedBank = { filters, window };
  return cachedBank;
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function pitchOf(frame: Float32Array): number | null {
  const minLag = Math.floor(EMBEDDING_SAMPLE_RATE / PITCH_MAX_HZ);
  const maxLag = Math.min(frame.length - 1, Math.ceil(EMBEDDING_SAMPLE_RATE / PITCH_MIN_HZ));
  let zero = 0;
  for (let i = 0; i < frame.length; i++) zero += frame[i] * frame[i];
  if (zero <= 0) return null;
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < frame.length; i++) sum += frame[i] * frame[i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return bestLag && best / zero > 0.35 ? EMBEDDING_SAMPLE_RATE / bestLag : null;
}

/**
 * Voice-print of `samples` (mono, 16 kHz), or null when there is less than
 * 0.3 s of voiced audio. Layout: 12 MFCC means, 12 MFCC deviations, log-pitch
 * mean, voiced-frame pitch deviation.
 */
export function computeSpeakerEmbedding(samples: Float32Array): Float32Array | null {
  if (samples.length < FRAME) return null;
  const { filters, window } = bank();
  const frames = Math.floor((samples.length - FRAME) / HOP) + 1;
  const energies = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < FRAME; i += 4) e += samples[f * HOP + i] ** 2;
    energies[f] = e;
  }
  const sorted = Array.from(energies).sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
  if (peak <= 1e-9) return null;
  const gate = peak * 10 ** (-30 / 10);

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const sums = new Float64Array(MFCCS - 1);
  const squares = new Float64Array(MFCCS - 1);
  const pitches: number[] = [];
  let voiced = 0;
  const frameBuf = new Float32Array(FRAME);
  for (let f = 0; f < frames; f++) {
    if (energies[f] < gate) continue;
    voiced++;
    for (let i = 0; i < FRAME; i++) {
      frameBuf[i] = samples[f * HOP + i];
      re[i] = frameBuf[i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const logMel = new Float64Array(MEL_BANDS);
    for (let m = 0; m < MEL_BANDS; m++) {
      let e = 0;
      const filter = filters[m];
      for (let k = 0; k <= FRAME / 2; k++) if (filter[k]) e += filter[k] * (re[k] * re[k] + im[k] * im[k]);
      logMel[m] = Math.log(e + 1e-10);
    }
    for (let c = 1; c < MFCCS; c++) {
      let v = 0;
      for (let m = 0; m < MEL_BANDS; m++) v += logMel[m] * Math.cos((Math.PI * c * (m + 0.5)) / MEL_BANDS);
      sums[c - 1] += v;
      squares[c - 1] += v * v;
    }
    const pitch = pitchOf(frameBuf);
    if (pitch) pitches.push(Math.log(pitch));
  }
  if (voiced * (HOP / EMBEDDING_SAMPLE_RATE) < MIN_VOICED_SECONDS) return null;

  const out = new Float32Array(SPEAKER_EMBEDDING_DIMENSIONS);
  for (let c = 0; c < MFCCS - 1; c++) {
    const mean = sums[c] / voiced;
    out[c] = mean;
    out[MFCCS - 1 + c] = Math.sqrt(Math.max(0, squares[c] / voiced - mean * mean));
  }
  if (pitches.length >= 5) {
    const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    out[2 * (MFCCS - 1)] = mean;
    out[2 * (MFCCS - 1) + 1] = Math.sqrt(pitches.reduce((a, b) => a + (b - mean) ** 2, 0) / pitches.length);
  }
  return out;
}
