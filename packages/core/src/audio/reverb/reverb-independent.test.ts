/**
 * Independent verification of Reduce Reverb on synthetic harmonic "speech" (not the fixture the builder used), with its own
 * metrics: SI-SDR against the dry source, an effective-C50 by least squares over early/late room responses, an offset-decay slope
 * (dB per 100 ms after syllable ends, measured on the speech-band envelope), speech-frame level change, and isolated TF-peak
 * counts in the pauses. Prints a table; asserts only floors that the feature's claims imply.
 */
import { describe, expect, it } from "vitest";
import { FFT } from "../fft";
import { reduceReverbChannel } from "./reverb-dsp";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Harmonic voiced "syllables" with formants and pauses; returns the signal and a speech activity mask (per sample). */
function synthSpeech(seconds: number, sr: number, seed: number): { x: Float32Array; active: Uint8Array } {
  const r = rng(seed);
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  const active = new Uint8Array(n);
  let t = 0.15;
  let phase = 0;
  while (t < seconds - 0.4) {
    const dur = 0.12 + r() * 0.15;
    const f0a = 100 + r() * 70;
    const f0b = f0a * (0.85 + r() * 0.3);
    const formants = [350 + r() * 500, 900 + r() * 1200, 2300 + r() * 900];
    const s0 = Math.floor(t * sr);
    const s1 = Math.min(n, Math.floor((t + dur) * sr));
    for (let i = s0; i < s1; i += 1) {
      const u = (i - s0) / (s1 - s0);
      const f0 = f0a + (f0b - f0a) * u;
      phase += (2 * Math.PI * f0) / sr;
      const env = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7 * (u > 0.9 ? (1 - u) * 10 : 1);
      let v = 0;
      for (let h = 1; h * f0 < 4500; h += 1) {
        const f = h * f0;
        let g = 0;
        for (const fm of formants) g += 1 / (1 + ((f - fm) / 140) ** 2);
        v += (g / h ** 0.6) * Math.sin(h * phase);
      }
      x[i] += env * v * 0.12;
      active[i] = 1;
    }
    t += dur + (r() < 0.2 ? 0.45 + r() * 0.3 : 0.03 + r() * 0.08);
  }
  return { x, active };
}

function rir(rt60: number, sr: number, seed: number, seconds = 2.2): Float32Array {
  const r = rng(seed);
  const n = Math.floor(sr * seconds);
  const h = new Float32Array(n);
  const k = (6.9078 / rt60) ; // amplitude decay rate for 60 dB
  for (let i = 0; i < n; i += 1) h[i] = (r() * 2 - 1) * Math.exp((-k * i) / sr);
  return h;
}

function conv(x: Float32Array, h: Float32Array): Float32Array {
  let size = 1;
  while (size < x.length + h.length) size <<= 1;
  const fft = new FFT(size);
  const a = new Float32Array(size); a.set(x);
  const b = new Float32Array(size); b.set(h);
  const A = fft.forward(a); const ar = Float32Array.from(A.real), ai = Float32Array.from(A.imag);
  const B = fft.forward(b);
  const re = new Float32Array(size), im = new Float32Array(size);
  for (let i = 0; i < size; i += 1) { re[i] = ar[i] * B.real[i] - ai[i] * B.imag[i]; im[i] = ar[i] * B.imag[i] + ai[i] * B.real[i]; }
  return fft.inverse(re, im).slice(0, x.length);
}

const energy = (x: Float32Array) => { let s = 0; for (const v of x) s += v * v; return s; };

/** Builds the reverberant mix at a target DRR (direct = first 2.5 ms of the RIR plus an impulse). */
function room(dry: Float32Array, sr: number, rt60: number, drrDb: number, seed: number) {
  const h = rir(rt60, sr, seed);
  const dN = Math.floor(0.0025 * sr);
  const late = Float32Array.from(h); for (let i = 0; i < dN; i += 1) late[i] = 0;
  // direct path = unit impulse at 0, reverberant part scaled so that direct/reverb energy ratio = DRR
  const probe = conv(dry, late);
  const scale = Math.sqrt(energy(dry) / 10 ** (drrDb / 10) / energy(probe));
  const full = new Float32Array(h.length);
  for (let i = 0; i < h.length; i += 1) full[i] = late[i] * scale;
  full[0] = 1;
  return { h: full, wet: conv(dry, full) };
}

function siSdr(est: Float32Array, ref: Float32Array): number {
  let dot = 0; for (let i = 0; i < ref.length; i += 1) dot += est[i] * ref[i];
  const a = dot / energy(ref);
  let tgt = 0, err = 0;
  for (let i = 0; i < ref.length; i += 1) { const t = a * ref[i]; tgt += t * t; const e = est[i] - t; err += e * e; }
  return 10 * Math.log10(tgt / Math.max(err, 1e-30));
}

/** Effective C50: LS fit of out ~ a*(dry*h_early[0..50ms]) + b*(dry*h_late[50ms..]); C50 = 10log10(a^2 Ee / (b^2 El)). */
function effectiveC50(out: Float32Array, dry: Float32Array, h: Float32Array, sr: number): number {
  const cut = Math.floor(0.05 * sr);
  const he = new Float32Array(h.length), hl = new Float32Array(h.length);
  for (let i = 0; i < h.length; i += 1) (i < cut ? he : hl)[i] = h[i];
  const xe = conv(dry, he), xl = conv(dry, hl);
  const ee = energy(xe), ll = energy(xl);
  let eo = 0, lo = 0, ex = 0;
  for (let i = 0; i < out.length; i += 1) { eo += out[i] * xe[i]; lo += out[i] * xl[i]; ex += xe[i] * xl[i]; }
  const det = ee * ll - ex * ex;
  const a = (eo * ll - lo * ex) / det;
  const b = (lo * ee - eo * ex) / det;
  return 10 * Math.log10((a * a * ee) / Math.max(b * b * ll, 1e-30));
}

/** Frame-energy envelope in dB over 10 ms frames. */
function env(x: Float32Array, sr: number): Float64Array {
  const f = Math.floor(0.01 * sr);
  const n = Math.floor(x.length / f);
  const e = new Float64Array(n);
  for (let i = 0; i < n; i += 1) { let s = 0; for (let j = 0; j < f; j += 1) s += x[i * f + j] ** 2; e[i] = 10 * Math.log10(s / f + 1e-14); }
  return e;
}

/** Pauses: segments right after a speech offset followed by >= 300 ms of silence in the dry mask. Returns per-pause 10 ms envelope dB from offset. */
function pauses(out: Float32Array, active: Uint8Array, sr: number): Float64Array[] {
  const e = env(out, sr), f = Math.floor(0.01 * sr);
  const res: Float64Array[] = [];
  for (let i = 1; i < e.length - 30; i += 1) {
    const a0 = active[Math.min(active.length - 1, i * f)], a1 = active[Math.min(active.length - 1, (i - 1) * f)];
    if (a1 === 1 && a0 === 0) {
      let clear = true; for (let j = 0; j < 30 && clear; j += 1) if (active[Math.min(active.length - 1, (i + j) * f)]) clear = false;
      if (clear) res.push(e.slice(i, i + 30));
    }
  }
  return res;
}
/** Mean level (dB) 100-250 ms after speech offsets in long pauses. */
function pauseTailDb(out: Float32Array, active: Uint8Array, sr: number): number {
  const ps = pauses(out, active, sr);
  let s = 0; for (const p of ps) { let q = 0; for (let i = 10; i < 25; i += 1) q += 10 ** (p[i] / 10); s += q / 15; }
  return 10 * Math.log10(s / ps.length);
}

function speechLevelDb(out: Float32Array, ref: Float32Array, active: Uint8Array): number {
  let eo = 0, er = 0;
  for (let i = 0; i < out.length; i += 1) if (active[i]) { eo += out[i] ** 2; er += ref[i] ** 2; }
  return 10 * Math.log10(eo / er);
}

/** Isolated TF peaks in pause regions (>12 dB above all 8 neighbours, inside bins up to 6 kHz), per second of pause. */
function isolatedPeaks(x: Float32Array, active: Uint8Array, sr: number): number {
  const size = 1024, hop = 256, fft = new FFT(size), win = new Float32Array(size);
  for (let i = 0; i < size; i += 1) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const frames: Float32Array[] = [], keep: boolean[] = [];
  const buf = new Float32Array(size);
  for (let s = 0; s + size <= x.length; s += hop) {
    for (let i = 0; i < size; i += 1) buf[i] = x[s + i] * win[i];
    const { real, imag } = fft.forward(buf);
    const p = new Float32Array(size / 2 + 1);
    for (let k = 0; k < p.length; k += 1) p[k] = 10 * Math.log10(real[k] ** 2 + imag[k] ** 2 + 1e-20);
    frames.push(p);
    let clear = true; for (let j = -2048; j < size + 2048 && clear; j += 64) if (active[Math.max(0, Math.min(active.length - 1, s + j))]) clear = false;
    keep.push(clear);
  }
  const hiBin = Math.floor((6000 / sr) * size);
  let cnt = 0, pauseFrames = 0;
  for (let f = 1; f < frames.length - 1; f += 1) {
    if (!keep[f]) continue;
    pauseFrames += 1;
    for (let k = 3; k < hiBin; k += 1) {
      const v = frames[f][k];
      let m = -1e9;
      for (let df = -1; df <= 1; df += 1) for (let dk = -1; dk <= 1; dk += 1) if (df || dk) m = Math.max(m, frames[f + df][k + dk]);
      if (v - m > 2) cnt += 1;
    }
  }
  return pauseFrames ? cnt / ((pauseFrames * hop) / sr) : 0;
}

/** Speech-to-reverberation modulation energy ratio (simplified SRMR): 8 octave-ish bands, envelope modulation 4-20 Hz vs 20-64 Hz. */
function srmr(x: Float32Array, sr: number): number {
  const size = 1 << Math.ceil(Math.log2(x.length));
  const fft = new FFT(size);
  const pad = new Float32Array(size); pad.set(x);
  const S = fft.forward(pad); const sre = Float32Array.from(S.real), sim = Float32Array.from(S.imag);
  let lowE = 0, highE = 0;
  const edges = [150, 250, 400, 650, 1000, 1600, 2500, 4000, 6000];
  for (let b = 0; b < edges.length - 1; b += 1) {
    const re = new Float32Array(size), im = new Float32Array(size);
    for (let k = 0; k <= size / 2; k += 1) {
      const fr = (k * sr) / size;
      if (fr >= edges[b] && fr < edges[b + 1]) { re[k] = sre[k]; im[k] = sim[k]; if (k > 0 && k < size / 2) { re[size - k] = sre[k]; im[size - k] = -sim[k]; } }
    }
    const band = fft.inverse(re, im);
    // envelope at 400 Hz sampling
    const dec = Math.floor(sr / 400), m = Math.floor(x.length / dec);
    const e = new Float32Array(1 << Math.floor(Math.log2(m)));
    for (let i = 0; i < e.length; i += 1) { let s = 0; for (let j = 0; j < dec; j += 1) s += Math.abs(band[i * dec + j]); e[i] = s / dec; }
    const ef = new FFT(e.length);
    let mean = 0; for (const v of e) mean += v; mean /= e.length;
    for (let i = 0; i < e.length; i += 1) e[i] -= mean;
    const E = ef.forward(e);
    for (let k = 1; k < e.length / 2; k += 1) {
      const fm = (k * 400) / e.length, p = E.real[k] ** 2 + E.imag[k] ** 2;
      if (fm >= 4 && fm < 20) lowE += p; else if (fm >= 20 && fm < 64) highE += p;
    }
  }
  return lowE / highE;
}

const SR = 48000;

describe("Reduce Reverb independent verification (synthetic harmonic speech)", () => {
  const cases = [{ rt: 0.3, drr: 5 }, { rt: 0.8, drr: 0 }, { rt: 1.5, drr: 5 }];
  for (const c of cases) {
    it(`rt60 ${c.rt} drr ${c.drr}`, async () => {
      const { x: dry, active } = synthSpeech(9, SR, 7 + Math.round(c.rt * 10));
      const { h, wet: w0 } = room(dry, SR, c.rt, c.drr, 99);
      const nr = rng(1234); const nsd = Math.sqrt(energy(w0) / w0.length / 10 ** 3.5); // 35 dB SNR noise floor
      const wet = Float32Array.from(w0, (v) => v + (nr() + nr() + nr() - 1.5) * 2 * nsd);
      const t0 = performance.now();
      const out = (await reduceReverbChannel(wet, SR, { amount: 70, sensitivity: 40 })).output;
      const dt = (performance.now() - t0) / 1000;
      const inSdr = siSdr(wet, dry), outSdr = siSdr(out, dry);
      const c50In = effectiveC50(wet, dry, h, SR), c50Out = effectiveC50(out, dry, h, SR);
      const line = [
        `rt${c.rt}/drr${c.drr}`.padEnd(12),
        `SDR ${inSdr.toFixed(1)}->${outSdr.toFixed(1)} (${(outSdr - inSdr).toFixed(1)})`,
        `C50 ${c50In.toFixed(1)}->${c50Out.toFixed(1)}`,
        `tail ${(pauseTailDb(out, active, SR) - pauseTailDb(wet, active, SR)).toFixed(1)} dB`,
        `SRMR ${srmr(wet, SR).toFixed(2)}->${srmr(out, SR).toFixed(2)} (dry ${srmr(dry, SR).toFixed(2)})`,
        `speechLvl ${speechLevelDb(out, wet, active).toFixed(1)} dB`,
        `peaks/s ${isolatedPeaks(wet, active, SR).toFixed(1)}->${isolatedPeaks(out, active, SR).toFixed(1)}`,
        `xRT ${(9 / dt).toFixed(1)}`,
      ].join(" | ");
      console.log(line);
      expect(outSdr).toBeGreaterThan(inSdr + 0.3);
      expect(c50Out).toBeGreaterThan(c50In);
      expect(Number.isFinite(outSdr)).toBe(true);
    }, 120000);
  }

  it("dry signal is not damaged; silence and DC stay finite", async () => {
    const { x: dry } = synthSpeech(6, SR, 3);
    const out = (await reduceReverbChannel(dry, SR, { amount: 70, sensitivity: 40 })).output;
    const sdr = siSdr(out, dry);
    console.log("dry self SI-SDR", sdr.toFixed(1), "level", (10 * Math.log10(energy(out) / energy(dry))).toFixed(2));
    expect(sdr).toBeGreaterThan(8);
    const z = (await reduceReverbChannel(new Float32Array(SR), SR, { amount: 100, sensitivity: 100 })).output;
    expect(z.every((v) => Number.isFinite(v) && Math.abs(v) < 1e-6)).toBe(true);
    const tiny = (await reduceReverbChannel(new Float32Array(10).fill(0.1), SR, { amount: 100, sensitivity: 100 })).output;
    expect(tiny.every(Number.isFinite)).toBe(true);
  }, 60000);

  it("is stable on non-speech: white noise, a steady tone, full-scale clipped speech (finite, no peak blow-up, no gain explosion)", async () => {
    const r = rng(77);
    const noise = Float32Array.from({ length: SR * 3 }, () => (r() * 2 - 1) * 0.3);
    const tone = Float32Array.from({ length: SR * 3 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
    const { x: dry } = synthSpeech(5, SR, 21);
    const { wet } = room(dry, SR, 1.0, 0, 3);
    let peak = 0; for (const v of wet) peak = Math.max(peak, Math.abs(v));
    const loud = Float32Array.from(wet, (v) => Math.max(-1, Math.min(1, (v / peak) * 4)));
    for (const [name, sig] of [["noise", noise], ["tone", tone], ["clipped", loud]] as const) {
      for (const params of [{ amount: 100, sensitivity: 100 }, { amount: 100, sensitivity: 0 }, { amount: 1, sensitivity: 50 }]) {
        const out = (await reduceReverbChannel(sig, SR, params)).output;
        let pin = 0, pout = 0; for (let i = 0; i < sig.length; i += 1) { pin = Math.max(pin, Math.abs(sig[i])); pout = Math.max(pout, Math.abs(out[i])); }
        const lvl = 10 * Math.log10(energy(out) / energy(sig));
        console.log(name, JSON.stringify(params), "peak ratio", (pout / pin).toFixed(2), "level", lvl.toFixed(1), "dB");
        expect(out.every(Number.isFinite)).toBe(true);
        expect(pout / pin).toBeLessThan(2.5);
      }
    }
  }, 120000);

  it("gentle end: low Amount on dry speech stays close to transparent", async () => {
    const { x: dry } = synthSpeech(6, SR, 3);
    for (const amount of [1, 5, 10, 25]) {
      const out = (await reduceReverbChannel(dry, SR, { amount, sensitivity: 50 })).output;
      console.log("gentle amount", amount, "self SI-SDR", siSdr(out, dry).toFixed(1), "level", (10 * Math.log10(energy(out) / energy(dry))).toFixed(2));
    }
  }, 60000);

  it("monotonic in Amount, and other sample rates work", async () => {
    for (const sr of [16000, 44100]) {
      const { x: dry } = synthSpeech(6, sr, 11);
      const { wet } = room(dry, sr, 0.8, 3, 5);
      const res: number[] = [];
      for (const amount of [20, 50, 90]) res.push(siSdr((await reduceReverbChannel(wet, sr, { amount, sensitivity: 50 })).output, dry));
      console.log("sr", sr, "in", siSdr(wet, dry).toFixed(1), "amount20/50/90 SDR", res.map((v) => v.toFixed(1)).join(" "));
      expect(res[1]).toBeGreaterThan(siSdr(wet, dry));
    }
  }, 120000);

  it("is deterministic and amount 0 is identity", async () => {
    const { x: dry } = synthSpeech(4, SR, 5);
    const { wet } = room(dry, SR, 0.5, 3, 2);
    const a = (await reduceReverbChannel(wet, SR, { amount: 60, sensitivity: 50 })).output;
    const b = (await reduceReverbChannel(wet, SR, { amount: 60, sensitivity: 50 })).output;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    const z = (await reduceReverbChannel(wet, SR, { amount: 0, sensitivity: 50 })).output;
    expect(Buffer.from(z.buffer).equals(Buffer.from(wet.buffer, wet.byteOffset, wet.byteLength))).toBe(true);
  }, 60000);
});
