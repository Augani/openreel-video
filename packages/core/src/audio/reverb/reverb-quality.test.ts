/**
 * Objective quality of Reduce Reverb on synthetic rooms, with the REAL DeepFilterNet3 weights for the comparison against Enhance
 * Speech: 10 s of public-domain read speech (../enhance/fixtures/README.md) convolved with exponentially decaying noise
 * impulse responses at RT60 0.3 / 0.8 / 1.5 s and a direct-to-reverberant ratio of 0 dB (a roomy recording) and 5 dB (a
 * moderately roomy one). The dry speech is the reference. The table is printed so a run documents the numbers; the assertions are
 * the floors the docs quote.
 *
 *   - SI-SDR / vs early: scale-invariant SDR against the dry voice, and against the dry voice convolved with only the first 50 ms
 *     of the room (the ceiling of any late-reverb suppressor).
 *   - C50: clarity of the effective impulse response of dry-to-output (a proxy for a time-varying system).
 *   - RT60 (blind): the estimator the spectral stage runs on a signal alone, applied to each output. It is the estimator's own view,
 *     not an independent measurement, and on this read speech it is only roughly right for the input (short pauses leave few free
 *     decays): about 0.4 s for a 0.3 s room, 0.7 to 0.9 s for 0.8 s, 1.0 s for 1.5 s.
 *   - tail: level of the pauses (60-160 ms after speech stops) against the reverberant input. level: speech-frame level change.
 *   - blips/s: isolated spectrogram blips per second in the pauses (musical-noise proxy); the reverberant input's own count is the reference.
 *   - xRT: audio seconds per second of processing on this machine (single thread, no GPU).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Dfn3Inference } from "../enhance/dfn3-dsp";
import { createDfn3Inference, DFN3_MODEL_FILES } from "../enhance/dfn3-model";
import { enhanceChannels } from "../enhance/enhance-engine";
import { readPcm16Wav, roomImpulseResponse, siSdr } from "../enhance/enhance-test-signals";
import { resample } from "../enhance/resample";
import { estimateRt60, reduceReverbChannel, spectralLateReverbChannel } from "./reverb-dsp";
import {
  clarityC50,
  earlyPart,
  effectiveImpulseResponse,
  fftConvolve,
  musicalNoisePerSecond,
  speechLevelChangeDb,
  tailLevelChangeDb,
} from "./reverb-metrics";
import { wpeChannel } from "./reverb-wpe";

const modelDir = fileURLToPath(new URL("../../../../../apps/web/public/models/deepfilternet3/", import.meta.url));
const fixture = fileURLToPath(new URL("../enhance/fixtures/speech-16k.wav", import.meta.url));
const RATE = 48000;
const REVERB = { amount: 60, sensitivity: 50 };

let infer: Dfn3Inference;
let dry: Float32Array;
const table: string[] = [];

interface Row {
  readonly name: string;
  readonly sisdr: number;
  readonly vsEarly: number;
  readonly c50: number;
  readonly blind: number;
  readonly tail: number;
  readonly level: number;
  readonly blips: number;
  readonly xrt?: number;
}

const enhance = async (x: Float32Array) => (await enhanceChannels([x], RATE, { infer }))[0];

function measure(name: string, x: Float32Array, reverberant: Float32Array, early: Float32Array, xrt?: number): Row {
  const h = effectiveImpulseResponse(dry, x, RATE);
  return {
    name,
    sisdr: siSdr(x, dry),
    vsEarly: siSdr(x, early),
    c50: clarityC50(h, RATE),
    blind: estimateRt60(x, RATE).rt60,
    tail: tailLevelChangeDb(dry, reverberant, x, RATE),
    level: speechLevelChangeDb(dry, reverberant, x, RATE),
    blips: musicalNoisePerSecond(dry, x, RATE),
    xrt,
  };
}

const fmt = (row: Row) =>
  `${row.name.padEnd(26)} SI-SDR ${row.sisdr.toFixed(1).padStart(5)}  vsEarly ${row.vsEarly.toFixed(1).padStart(5)}  C50 ${row.c50.toFixed(1).padStart(5)}  RT60(blind) ${row.blind.toFixed(2)}  tail ${row.tail.toFixed(1).padStart(6)}  level ${row.level.toFixed(1).padStart(5)}  blips/s ${row.blips.toFixed(0).padStart(4)}${row.xrt ? `  ${row.xrt.toFixed(1)}xRT` : ""}`;

const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; xrt: number }> => {
  const started = performance.now();
  const value = await work();
  return { value, xrt: dry.length / RATE / ((performance.now() - started) / 1000) };
};

beforeAll(async () => {
  const bytes: Record<string, Uint8Array> = {};
  for (const file of DFN3_MODEL_FILES) bytes[file] = readFileSync(modelDir + file);
  infer = await createDfn3Inference({ bytes });
  const wav = readPcm16Wav(readFileSync(fixture));
  dry = resample(wav.samples, wav.sampleRate, RATE);
}, 120_000);

describe("Reduce Reverb objective quality (synthetic rooms, read speech)", () => {
  const results = new Map<string, Row[]>();

  for (const rt of [0.3, 0.8, 1.5]) {
    for (const drr of [0, 5]) {
      it(`RT60 ${rt} s, DRR ${drr} dB: Reduce Reverb vs Enhance Speech (DeepFilterNet3) alone and combined`, async () => {
        const h = roomImpulseResponse(RATE, rt, drr);
        const reverberant = fftConvolve(dry, h);
        const early = fftConvolve(dry, earlyPart(h, RATE));
        const rows: Row[] = [measure("reverberant input", reverberant, reverberant, early)];
        const dfn3 = await enhance(reverberant);
        rows.push(measure("Enhance Speech", dfn3, reverberant, early));
        const alone = await timed(() => reduceReverbChannel(reverberant, RATE, REVERB));
        rows.push(measure("Reduce Reverb", alone.value.output, reverberant, early, alone.xrt));
        // The shipped order: Reduce Reverb first, then Enhance Speech on its output.
        const both = await timed(async () => enhance(alone.value.output));
        rows.push(measure("Reduce Reverb > Enhance", both.value, reverberant, early, alone.xrt));
        // The other order, measured to pick the one that ships.
        const reversed = (await reduceReverbChannel(dfn3, RATE, REVERB)).output;
        rows.push(measure("  (not shipped) Enh > RR", reversed, reverberant, early));
        const wpe = await wpeChannel(reverberant, RATE, { delay: 3, taps: 26, iterations: 3, strength: 0.6, maxHz: 8000 });
        rows.push(measure("  stage: WPE only (60)", wpe, reverberant, early));
        const spectral = (await spectralLateReverbChannel(reverberant, RATE, { amount: 60, sensitivity: 50 })).output;
        rows.push(measure("  stage: spectral only (60)", spectral, reverberant, early));
        results.set(`${rt}/${drr}`, rows);
        table.push(`RT60 ${rt} s, DRR ${drr} dB (blind estimate of the room: ${rows[0].blind.toFixed(2)} s)\n    ${rows.map(fmt).join("\n    ")}`);

        const [input, enhanced, reduced, combined, other] = rows;
        // Late-reverb suppression must help against the dry voice, not just change the sound.
        expect(reduced.sisdr).toBeGreaterThan(input.sisdr + 0.8);
        expect(reduced.c50).toBeGreaterThan(input.c50 + 1.5);
        expect(reduced.tail).toBeLessThan(-2);
        // The voice keeps its level and the pauses do not fill with blips.
        expect(reduced.level).toBeGreaterThan(-3.5);
        expect(reduced.blips).toBeLessThan(input.blips * 2);
        expect(combined.level).toBeGreaterThan(-6.5);
        // The point of the feature: in the rooms Enhance Speech barely changes, the combination is clearer than Enhance Speech alone.
        if (rt >= 0.8) {
          expect(combined.sisdr).toBeGreaterThan(enhanced.sisdr + 0.8);
          expect(combined.c50).toBeGreaterThan(enhanced.c50 + 1.5);
        }
        // The order that ships is at least as good on SI-SDR as the reverse one.
        expect(combined.sisdr).toBeGreaterThan(other.sisdr - 0.3);
        // Much faster than realtime on one thread.
        expect(reduced.xrt ?? 0).toBeGreaterThan(2);
      }, 600_000);
    }
  }

  it("Amount 0 / 30 / 60 / 100 at RT60 0.8 s, DRR 0 dB: monotone strength", async () => {
    const h = roomImpulseResponse(RATE, 0.8, 0);
    const reverberant = fftConvolve(dry, h);
    const early = fftConvolve(dry, earlyPart(h, RATE));
    const rows: Row[] = [];
    for (const amount of [30, 60, 100]) {
      const out = (await reduceReverbChannel(reverberant, RATE, { amount, sensitivity: 50 })).output;
      rows.push(measure(`Amount ${amount}`, out, reverberant, early));
    }
    table.push(`Amount sweep, RT60 0.8 s, DRR 0 dB\n    ${rows.map(fmt).join("\n    ")}`);
    expect(rows[0].tail).toBeGreaterThan(rows[1].tail);
    expect(rows[1].tail).toBeGreaterThan(rows[2].tail);
    expect(rows[2].level).toBeLessThan(rows[0].level);
  }, 600_000);

  it("leaves a dry recording alone: Reduce Reverb on the dry speech stays close to it", async () => {
    const out = (await reduceReverbChannel(dry, RATE, REVERB)).output;
    const h = effectiveImpulseResponse(dry, out, RATE);
    table.push(`dry speech through Reduce Reverb: SI-SDR vs itself ${siSdr(out, dry).toFixed(1)} dB, C50 ${clarityC50(h, RATE).toFixed(1)} dB, speech level ${speechLevelChangeDb(dry, dry, out, RATE).toFixed(1)} dB`);
    expect(siSdr(out, dry)).toBeGreaterThan(8);
    expect(speechLevelChangeDb(dry, dry, out, RATE)).toBeGreaterThan(-2.5);
  }, 120_000);

  it("reports the table", () => {
    console.info(`\nReduce Reverb objective results (${(dry.length / RATE).toFixed(0)} s read speech, 48 kHz, Amount ${REVERB.amount}, Sensitivity ${REVERB.sensitivity}):\n  ${table.join("\n  ")}`);
    expect(table.length).toBeGreaterThan(0);
  });
});
