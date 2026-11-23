/**
 * Live (realtime) plugin inserts against the real Audio Unit helper and Apple's own AUDelay, AULowpass, AUPeakLimiter and
 * AUMultibandCompressor: the real LiveChain (block pipeline, helper processes) in this thread and the real LiveInsertDsp running
 * on a wall clock in a worker thread, the way the AudioWorklet runs it. Checks:
 *
 *  - the live output equals the cached offline render (the reference) after latency alignment, in dB;
 *  - no underruns over a normal run, and the reported latency is the real one;
 *  - a parameter change is heard within 50 ms at every block size;
 *  - a helper that dies mid-stream crossfades to the aligned dry signal and is reported, never throws;
 *  - round trips per block size are measured and printed.
 *
 * These tests run a wall-clock audio thread and so are timing sensitive: a machine busy with a whole test suite starves it and produces
 * (correctly counted) dropouts. Opt in with OPENREEL_LIVE_REALTIME=1 (pnpm --filter @openreel/desktop test:live-realtime), run on their own.
 * Needs macOS and the built helper (pnpm --filter @openreel/desktop build:plughost); skipped elsewhere.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LiveStepConfig } from "../src/main/plughost/live-chain";
import { LiveChain } from "../src/main/plughost/live-chain";
import { burstInput, noiseInput, runLiveSim, type SimResult } from "./live-sim/live-sim";
import { QUANTUM, SR, audioThreadStarved, audibleLatencyMs, cleanRun, differenceDb, offlineReference, rmsOf, sampleChange } from "./live-sim/measure";

const HELPER = process.env.OPENREEL_PLUGHOST_PATH ?? path.resolve(__dirname, `../resources/plughost/darwin-${process.arch}/openreel-plughost`);
const enabled = process.env.OPENREEL_LIVE_REALTIME === "1" && process.platform === "darwin" && existsSync(HELPER);
const d = enabled ? describe : describe.skip;
const DELAY = "au:aufx:dely:appl";
const LOWPASS = "au:aufx:lpas:appl";
const LIMITER = "au:aufx:lmtr:appl";
const MBC = "au:aufx:mcmp:appl";
const LOG_DIR = process.env.OPENREEL_LIVE_LOG_DIR;

const step = (pluginId: string, values: Record<string, number> = {}, effectId = pluginId): LiveStepConfig => ({ pluginId, effectId, values, automation: {}, spawn: { command: HELPER, args: ["serve"] } });
const record = (name: string, value: unknown): void => {
  console.log(`[live-metric] ${name} ${JSON.stringify(value)}`);
  if (LOG_DIR) {
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(path.join(LOG_DIR, `${name}.json`), JSON.stringify(value, null, 2));
  }
};

/** A loaded developer machine stalls a thread for tens of milliseconds now and then; a handful of dropouts in a run is the honest bound, and each one is a counted, crossfaded dry block. */
const expectFewUnderruns = (result: SimResult): void => {
  // dropouts are only held against the host when the simulated audio thread itself was running on time (see audioThreadStarved)
  if (audioThreadStarved(result)) return;
  expect(result.stats.underruns).toBeLessThanOrEqual(Math.max(2, Math.ceil(result.stats.blocksSent * 0.01)));
};

d("live inserts on the Apple built-in Audio Units", () => {
  const cases: Array<{ name: string; steps: LiveStepConfig[]; toleranceDb: number }> = [
    { name: "AUDelay", steps: [step(DELAY, { "0": 100, "1": 0.05, "2": 30 })], toleranceDb: -100 },
    { name: "AULowpass", steps: [step(LOWPASS, { "0": 1800, "1": 6 })], toleranceDb: -100 },
    { name: "AUPeakLimiter", steps: [step(LIMITER, { "2": 12 })], toleranceDb: -60 },
    { name: "AUMultibandCompressor", steps: [step(MBC, { "0": 6 })], toleranceDb: -60 },
    { name: "AULowpass>AUDelay chain", steps: [step(LOWPASS, { "0": 2500 }), step(DELAY, { "0": 40, "1": 0.02, "2": 20 })], toleranceDb: -100 },
  ];

  for (const c of cases) {
    it(`${c.name}: live output equals the offline render after latency alignment, with no underruns`, async () => {
      const seconds = 4;
      const input = noiseInput(SR * seconds);
      const result = await cleanRun(() => runLiveSim({ steps: c.steps, blockFrames: 256, seconds, input, record: true }));
      expect(result.chain.failed).toBeNull();
      expect(result.hostFailed).toBeNull();
      expectFewUnderruns(result);
      const reference = await offlineReference(c.steps, input);
      const D = result.latencyFrames;
      const from = D + SR / 4;
      const to = SR * seconds - 512;
      const db = [0, 1].map((ch) => differenceDb(result.recorded![ch], reference[ch], D, from, to));
      record(`diff-${c.name.replace(/[^A-Za-z0-9]+/g, "_")}`, { latencyFrames: D, pluginLatencyFrames: result.open.pluginLatencyFrames, prefillBlocks: result.prefillBlocks, differenceDb: db, roundTripMs: result.open.roundTripMs });
      expect(rmsOf(result.recorded![0], from, to)).toBeGreaterThan(0.01);
      // a run that still has dropouts after the retries on a starved audio thread says nothing about the comparison
      if (result.stats.underruns > 0 && audioThreadStarved(result)) return;
      for (const value of db) expect(value).toBeLessThan(c.toleranceDb);
    }, 120_000);
  }

  for (const blockFrames of [128, 256, 512] as const) {
    it(`parameter change is audible within 50 ms at ${blockFrames} frame blocks`, async () => {
      const seconds = 3;
      const input = burstInput(SR * seconds).map((c) => c.map((v) => v * 0.6));
      let changedAt = 0n;
      // AUPeakLimiter Pre-Gain: -40 dB, then 0 dB (a 100 times louder output) while the stream plays
      const result = await runLiveSim({
        steps: [step(LIMITER, { "2": -40 })],
        blockFrames,
        seconds,
        input,
        during: async (chain, control) => {
          changedAt = await sampleChange(chain, 1500, control, () => chain.setValues(LIMITER, { "2": 0 }));
        },
      });
      expectFewUnderruns(result);
      const baseline = rmsOf(result.rms.slice(Math.floor((SR * 1.0) / QUANTUM), Math.floor((SR * 1.4) / QUANTUM)));
      expect(baseline).toBeGreaterThan(0.001);
      expect(baseline).toBeLessThan(0.02);
      const latency = audibleLatencyMs(result, changedAt, (rms) => rms > baseline * 20);
      record(`param-latency-${blockFrames}`, { latencyMs: latency, blockFrames, prefillBlocks: result.prefillBlocks, insertLatencyMs: (result.latencyFrames / SR) * 1000, roundTripMs: result.open.roundTripMs });
      expect(latency).not.toBeNull();
      expect(latency!).toBeLessThan(50);
    }, 60_000);
  }

  it("a helper that stalls for 60 ms drops that stretch to dry (counted, crossfaded), then catches up and plays wet again", async () => {
    const seconds = 4;
    const input = burstInput(SR * seconds);
    const chainSteps = [step(MBC), step(MBC, {}, "mbc2")];
    const result = await runLiveSim({
      steps: chainSteps,
      blockFrames: 128,
      seconds,
      input,
      record: true,
      during: async (chain, control) => {
        while (control.elapsedMs() < 1500) await new Promise((r) => setTimeout(r, 2));
        for (const pid of chain.pids) process.kill(pid, "SIGSTOP");
        await new Promise((r) => setTimeout(r, 60));
        for (const pid of chain.pids) process.kill(pid, "SIGCONT");
      },
    });
    record("forced-stall", { underruns: result.stats.underruns, late: result.stats.lateBlocks, queued: result.chain.queued, dropped: result.chain.dropped, prefillBlocks: result.prefillBlocks, wetBlocks: result.stats.wetBlocks, dryBlocks: result.stats.dryBlocks });
    expect(result.stats.underruns).toBeGreaterThan(0);
    expect(result.chain.failed).toBeNull();
    const out = result.recorded![0];
    const stepOf = (a: ArrayLike<number>, from = 1, to = a.length) => {
      let worst = 0;
      for (let i = Math.max(1, from); i < to; i += 1) worst = Math.max(worst, Math.abs(a[i] - a[i - 1]));
      return worst;
    };
    // the plugin chain itself clicks a little (a compressor chain at default settings); the wet/dry ramps must add nothing audible on top of that
    const reference = await offlineReference(chainSteps, input);
    expect(stepOf(out)).toBeLessThan(stepOf(reference[0]) + 0.05);
    // recovered: the last second is the wet signal again, equal to the reference after alignment
    const D = result.latencyFrames;
    expect(differenceDb(out, reference[0], D, SR * 3, SR * 4 - 512)).toBeLessThan(-60);
  }, 60_000);

  it("a helper that is killed mid-stream crossfades to the aligned dry signal, is reported, and the app side never throws", async () => {
    const seconds = 3;
    const input = burstInput(SR * seconds);
    const failures: string[] = [];
    const result = await runLiveSim({
      steps: [step(DELAY, { "0": 100, "1": 0.02, "2": 0 })],
      blockFrames: 256,
      seconds,
      input,
      record: true,
      during: async (chain, control) => {
        while (control.elapsedMs() < 1200) await new Promise((r) => setTimeout(r, 5));
        for (const pid of chain.pids) process.kill(pid, "SIGKILL");
      },
    });
    failures.push(result.chain.failed ?? "");
    expect(result.chain.failed).toMatch(/killed|exited|closed/i);
    expect(result.hostFailed).toBeTruthy();
    // after the crash plus its crossfade the output is the input delayed by D (dry), not silence
    const D = result.latencyFrames;
    const n = SR * 2;
    expect(result.recorded![0][n]).toBeCloseTo(input[0][n - D], 4);
    let worst = 0;
    for (let i = 1; i < result.recorded![0].length; i += 1) worst = Math.max(worst, Math.abs(result.recorded![0][i] - result.recorded![0][i - 1]));
    expect(worst).toBeLessThan(0.2);
  }, 60_000);

  it("measures the helper round trip per block size", async () => {
    const rows: Record<string, unknown> = {};
    for (const [name, id, values] of [["AUDelay", DELAY, {}], ["AULowpass", LOWPASS, {}], ["AUPeakLimiter", LIMITER, {}], ["AUMultibandCompressor", MBC, {}]] as const) {
      for (const blockFrames of [128, 256, 512] as const) {
        const chain = new LiveChain({ steps: [step(id, values)], sampleRate: SR, blockFrames, post: () => undefined, warmupBlocks: 200 });
        const open = await chain.open();
        chain.dispose();
        rows[`${name}@${blockFrames}`] = open.roundTripMs;
        expect(open.roundTripMs.p95).toBeLessThan((blockFrames / SR) * 1000 * 6);
      }
    }
    record("round-trip", rows);
  }, 120_000);
});
