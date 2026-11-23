/**
 * Objective quality of Enhance Speech with the REAL DeepFilterNet3 weights (onnxruntime-web on Node), on material with a
 * known clean reference: 10 s of public-domain read speech (fixtures/README.md) mixed with pink noise at several SNRs and
 * with a synthetic room impulse response. SI-SDR is measured against the clean speech; the numbers are printed so a
 * run documents them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Dfn3Inference } from "./dfn3-dsp";
import { createDfn3Inference, DFN3_MODEL_FILES } from "./dfn3-model";
import { enhanceChannels } from "./enhance-engine";
import { resample } from "./resample";
import { addNoiseAtSnr, convolve, peakAbs, pinkNoise, readPcm16Wav, rmsDb, roomImpulseResponse, siSdr, synthSpeech } from "./enhance-test-signals";

const modelDir = fileURLToPath(new URL("../../../../../apps/web/public/models/deepfilternet3/", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/speech-16k.wav", import.meta.url));

let infer: Dfn3Inference;
let clean: Float32Array;
let rate: number;
const table: string[] = [];

const enhance = async (x: Float32Array, sampleRate = rate) => (await enhanceChannels([x], sampleRate, { infer }))[0];

beforeAll(async () => {
  const bytes: Record<string, Uint8Array> = {};
  for (const file of DFN3_MODEL_FILES) bytes[file] = readFileSync(modelDir + file);
  infer = await createDfn3Inference({ bytes });
  const wav = readPcm16Wav(readFileSync(fixture));
  clean = wav.samples;
  rate = wav.sampleRate;
}, 120_000);

describe("Enhance Speech objective quality (DeepFilterNet3, on device)", () => {
  const noise = () => pinkNoise(clean.length, 9);

  for (const [snr, required] of [[0, 6], [5, 6], [10, 3]] as const) {
    it(`improves SI-SDR by at least ${required} dB at ${snr} dB input SNR (pink noise) without clipping`, async () => {
      const noisy = addNoiseAtSnr(clean, noise(), snr);
      const started = performance.now();
      const out = await enhance(noisy);
      const seconds = (performance.now() - started) / 1000;
      const before = siSdr(noisy, clean);
      const after = siSdr(out, clean);
      table.push(`pink noise ${snr} dB SNR: SI-SDR ${before.toFixed(1)} -> ${after.toFixed(1)} dB (+${(after - before).toFixed(1)}), ${(clean.length / rate / seconds).toFixed(1)}x realtime`);
      expect(out).toHaveLength(noisy.length);
      expect(after - before).toBeGreaterThanOrEqual(required);
      expect(peakAbs(out)).toBeLessThanOrEqual(Math.max(0.999, peakAbs(noisy)));
      expect(out.every((v) => Number.isFinite(v))).toBe(true);
    }, 120_000);
  }

  it("is deterministic: the same input gives bit-identical output", async () => {
    const noisy = addNoiseAtSnr(clean, noise(), 5);
    const a = await enhance(noisy);
    const b = await enhance(noisy);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  }, 120_000);

  it("gives the same result whatever level the clip was decoded at (the preview and the export decode at different levels)", async () => {
    const noisy = addNoiseAtSnr(clean, noise(), 5);
    const quieter = Float32Array.from(noisy, (v) => v * Math.SQRT1_2);
    const a = await enhance(noisy);
    const b = Float32Array.from(await enhance(quieter), (v) => v / Math.SQRT1_2);
    let diff = 0;
    let ref = 0;
    for (let i = 0; i < a.length; i += 1) {
      diff += (a[i] - b[i]) ** 2;
      ref += a[i] ** 2;
    }
    table.push(`level invariance (-3 dB decode): residual ${(10 * Math.log10(diff / ref + 1e-30)).toFixed(0)} dB`);
    expect(10 * Math.log10(diff / ref + 1e-30)).toBeLessThan(-90);
  }, 120_000);

  it("drops the noise floor in the pauses by at least 15 dB while leaving the speech level alone", async () => {
    const noisy = addNoiseAtSnr(clean, noise(), 5);
    const out = await enhance(noisy);
    const win = Math.round(rate * 0.25);
    // Quietest and loudest 250 ms windows of the clean reference: pause and speech.
    let quiet = { at: 0, level: Infinity };
    let loud = { at: 0, level: -Infinity };
    for (let at = 0; at + win <= clean.length; at += win) {
      const level = rmsDb(clean, at, at + win);
      if (level < quiet.level) quiet = { at, level };
      if (level > loud.level) loud = { at, level };
    }
    const floorBefore = rmsDb(noisy, quiet.at, quiet.at + win);
    const floorAfter = rmsDb(out, quiet.at, quiet.at + win);
    const speechBefore = rmsDb(noisy, loud.at, loud.at + win);
    const speechAfter = rmsDb(out, loud.at, loud.at + win);
    table.push(`noise floor in a pause ${floorBefore.toFixed(1)} -> ${floorAfter.toFixed(1)} dBFS; loud speech ${speechBefore.toFixed(1)} -> ${speechAfter.toFixed(1)} dBFS`);
    expect(floorBefore - floorAfter).toBeGreaterThanOrEqual(15);
    expect(Math.abs(speechAfter - speechBefore)).toBeLessThan(3);
  }, 120_000);

  it("holds at a 44.1 kHz source rate (resampled through the 48 kHz model and back) and keeps the exact length", async () => {
    const at441 = resample(clean, rate, 44100);
    const cleanRef = at441;
    const noisy = addNoiseAtSnr(cleanRef, pinkNoise(cleanRef.length, 4), 5);
    const out = await enhance(noisy, 44100);
    expect(out).toHaveLength(noisy.length);
    const gain = siSdr(out, cleanRef) - siSdr(noisy, cleanRef);
    table.push(`44.1 kHz source, 5 dB SNR: SI-SDR +${gain.toFixed(1)} dB`);
    expect(gain).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it("reduces room reverb and noise together (modestly: DeepFilterNet3 is a denoiser first)", async () => {
    const rows: string[] = [];
    for (const drr of [0, 5, 10]) {
      const reverberant = convolve(clean, roomImpulseResponse(rate, 0.45, drr));
      const noisy = addNoiseAtSnr(reverberant, noise(), 10);
      const out = await enhance(noisy);
      const gain = siSdr(out, clean) - siSdr(noisy, clean);
      rows.push(`DRR ${drr} dB + 10 dB SNR: +${gain.toFixed(1)} dB`);
      expect(gain).toBeGreaterThanOrEqual(1.5);
    }
    table.push(`reverb (RT60 0.45 s) + noise, SI-SDR vs dry speech: ${rows.join("; ")}`);
  }, 120_000);

  it("copes with a synthetic voice and with silence without producing non-finite samples or clipping", async () => {
    const voice = synthSpeech(rate, 4, 11);
    const out = await enhance(addNoiseAtSnr(voice, pinkNoise(voice.length, 12), 5));
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(peakAbs(out)).toBeLessThan(1);
    const silent = await enhance(new Float32Array(rate));
    expect(peakAbs(silent)).toBeLessThan(1e-3);
  }, 120_000);

  it("reports the table", () => {
    console.info(`\nEnhance Speech objective results (DeepFilterNet3, ${(clean.length / rate).toFixed(0)} s read speech):\n  ${table.join("\n  ")}`);
    expect(table.length).toBeGreaterThan(0);
  });
});
