/**
 * Deterministic test material for speech enhancement: a speech-like voice (glottal pulse train through moving formant
 * resonators, syllabic envelope, fricatives, pauses), pink noise, a synthetic room impulse response and the objective
 * metrics (SNR, SI-SDR). Test-only; nothing here ships in the app bundle.
 */

export const makeRng = (seed: number) => {
  let s = seed >>> 0;
  const uniform = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform());
  return { uniform, gauss };
};

const FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
];

/** One 2-pole resonator (centre `hz`, bandwidth `bw`), unity gain at the centre. */
const resonator = (hz: number, bw: number, rate: number) => {
  const r = Math.exp((-Math.PI * bw) / rate);
  const a1 = -2 * r * Math.cos((2 * Math.PI * hz) / rate);
  const a2 = r * r;
  const gain = 1 - r;
  let y1 = 0;
  let y2 = 0;
  return (x: number) => {
    const y = gain * x - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
};

/** Speech-like mono signal, peak-normalised to `peak`. */
export function synthSpeech(rate: number, seconds: number, seed = 1, peak = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float64Array(n);
  const rng = makeRng(seed);
  let t = Math.round(0.15 * rate);
  while (t < n) {
    const syllable = Math.round((0.14 + 0.16 * rng.uniform()) * rate);
    const f = FORMANTS[Math.floor(rng.uniform() * FORMANTS.length)];
    const f0a = 95 + 70 * rng.uniform();
    const f0b = f0a * (0.85 + 0.35 * rng.uniform());
    const res = f.map((hz, k) => resonator(hz, 60 + 40 * k, rate));
    let phase = 0;
    for (let i = 0; i < syllable && t + i < n; i += 1) {
      const u = i / syllable;
      const f0 = f0a + (f0b - f0a) * u;
      phase += f0 / rate;
      if (phase >= 1) phase -= 1;
      // Rosenberg-like glottal pulse: smooth rise, sharp fall.
      const pulse = phase < 0.6 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.6)) : Math.cos((Math.PI * (phase - 0.6)) / 0.8) ** 2 * (phase < 1 ? 1 : 0);
      const env = Math.sin(Math.PI * u) ** 0.7;
      const voiced = res.reduce((acc, r, k) => acc + r(pulse - 0.4) * (k === 0 ? 1 : k === 1 ? 0.7 : 0.35), 0);
      out[t + i] += voiced * env * 4;
    }
    t += syllable;
    if (rng.uniform() < 0.35) {
      // A fricative (/s/-like): high-passed noise.
      const len = Math.round((0.06 + 0.08 * rng.uniform()) * rate);
      let prev = 0;
      for (let i = 0; i < len && t + i < n; i += 1) {
        const w = rng.gauss();
        const hp = w - prev;
        prev = w;
        out[t + i] += hp * 0.12 * Math.sin((Math.PI * i) / len);
      }
      t += len;
    }
    t += Math.round((0.03 + 0.2 * rng.uniform()) * rate);
  }
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? peak / max : 1;
  return Float32Array.from(out, (v) => v * scale);
}

/** Pink (1/f) noise, unit-ish variance (Paul Kellet filter). */
export function pinkNoise(length: number, seed = 2): Float32Array {
  const rng = makeRng(seed);
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i += 1) {
    const w = rng.gauss();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/**
 * Synthetic room impulse response: a unit direct path plus an exponentially decaying diffuse tail (-60 dB at `rt60`),
 * the tail scaled so the direct-to-reverberant energy ratio is `drrDb` (typical rooms sit around 0 to +10 dB).
 */
export function roomImpulseResponse(rate: number, rt60 = 0.45, drrDb = 3, seed = 3): Float32Array {
  const rng = makeRng(seed);
  const length = Math.round(rate * rt60 * 1.2);
  const ir = new Float32Array(length);
  const decay = Math.log(1000) / (rt60 * rate);
  const start = Math.round(0.004 * rate);
  let tail = 0;
  for (let i = start; i < length; i += 1) {
    ir[i] = rng.gauss() * Math.exp(-decay * (i - start));
    tail += ir[i] * ir[i];
  }
  const scale = Math.sqrt(1 / (tail * 10 ** (drrDb / 10)));
  for (let i = start; i < length; i += 1) ir[i] *= scale;
  ir[0] = 1;
  return ir;
}

export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let k = 0; k < h.length; k += 1) {
    const hk = h[k];
    if (hk === 0) continue;
    for (let i = k; i < x.length; i += 1) out[i] += x[i - k] * hk;
  }
  return out;
}

export const power = (x: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i];
  return s / Math.max(1, x.length);
};

/** `signal + noise` with the noise scaled so the signal-to-noise power ratio is `snrDb`. */
export function addNoiseAtSnr(signal: Float32Array, noise: Float32Array, snrDb: number): Float32Array {
  const gain = Math.sqrt(power(signal) / power(noise) / 10 ** (snrDb / 10));
  return Float32Array.from(signal, (v, i) => v + gain * noise[i]);
}

/** Scale-invariant SDR (dB) of `estimate` against `reference` (Le Roux et al.). */
export function siSdr(estimate: Float32Array, reference: Float32Array): number {
  const n = Math.min(estimate.length, reference.length);
  let dot = 0;
  let ref = 0;
  for (let i = 0; i < n; i += 1) {
    dot += estimate[i] * reference[i];
    ref += reference[i] * reference[i];
  }
  const alpha = dot / ref;
  let target = 0;
  let err = 0;
  for (let i = 0; i < n; i += 1) {
    const s = alpha * reference[i];
    target += s * s;
    const e = estimate[i] - s;
    err += e * e;
  }
  return 10 * Math.log10(target / err);
}

export const peakAbs = (x: Float32Array): number => {
  let peak = 0;
  for (let i = 0; i < x.length; i += 1) peak = Math.max(peak, Math.abs(x[i]));
  return peak;
};

/** Level in dBFS (RMS) of x[from, to). */
export const rmsDb = (x: Float32Array, from = 0, to = x.length): number => {
  let s = 0;
  for (let i = from; i < to; i += 1) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, to - from) + 1e-20);
};

/** Reads a canonical 16-bit PCM mono WAV (the fixtures) into floats and returns its sample rate. */
export function readPcm16Wav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let sampleRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") sampleRate = view.getUint32(offset + 12, true);
    if (id === "data") {
      const count = Math.floor(size / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in WAV");
}
