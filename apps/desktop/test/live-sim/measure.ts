/** Shared measurements of the live insert tests. */
import { LiveChain } from "../../src/main/plughost/live-chain";
import type { LiveStepConfig } from "../../src/main/plughost/live-chain";
import { renderThroughHelper } from "../../src/main/plughost/render";
import type { SimResult } from "./live-sim";

export const SR = 48000;
export const QUANTUM = 128;

export const rmsOf = (a: ArrayLike<number>, from = 0, to = a.length): number => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += a[i] * a[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/** 20 log10(rms(live - reference) / rms(reference)) over [from, to) of the live output, the reference being delayed by `delay` frames. */
export function differenceDb(live: ArrayLike<number>, reference: ArrayLike<number>, delay: number, from: number, to: number): number {
  let diff = 0;
  let ref = 0;
  for (let n = from; n < to; n += 1) {
    const r = reference[n - delay] ?? 0;
    const d = live[n] - r;
    diff += d * d;
    ref += r * r;
  }
  if (ref === 0) return diff === 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  return diff === 0 ? Number.NEGATIVE_INFINITY : 10 * Math.log10(diff / ref);
}

/** The offline reference for a chain: each plugin rendered over the whole input through the helper (latency compensated), exactly the cached path. */
export async function offlineReference(steps: readonly LiveStepConfig[], input: Float32Array[], applyValues = true): Promise<Float32Array[]> {
  let channels = input;
  for (const step of steps) {
    const result = await renderThroughHelper(step.spawn, { pluginId: step.pluginId, ...(step.state ? { state: step.state } : {}), values: applyValues ? step.values : {}, automation: step.automation, channels, sampleRate: SR }, { ...(step.pluginPath ? { pluginPath: step.pluginPath } : {}), blockFrames: 512 });
    channels = result.channels;
  }
  return channels;
}

/**
 * Audible latency of a parameter change: from the moment `change()` was called (hrtime) to the end of the first 128 frame quantum
 * of the played output in which `predicate(rms)` holds, on the playback timeline (quantum i is heard at start + (i + 1) * 2.67 ms).
 */
export function audibleLatencyMs(result: SimResult, changedAtNs: bigint, predicate: (rms: number) => boolean): number | null {
  const quantumNs = BigInt(Math.round((QUANTUM / SR) * 1e9));
  for (let i = 0; i < result.rms.length; i += 1) {
    const heardAt = result.startNs + BigInt(i + 1) * quantumNs;
    if (heardAt <= changedAtNs) continue;
    if (predicate(result.rms[i])) return Number(heardAt - changedAtNs) / 1e6;
  }
  return null;
}

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sampleChange(chain: LiveChain, atMs: number, control: { elapsedMs: () => number }, change: () => void): Promise<bigint> {
  while (control.elapsedMs() < atMs) await wait(2);
  const t = process.hrtime.bigint();
  change();
  return t;
}

/**
 * Runs a live simulation until one comes back without a dropout (at most `attempts` times). A sample-for-sample comparison with the offline
 * render is only meaningful for a run in which every block was played wet; a dropout on a loaded machine is a counted, crossfaded dry block
 * (which other tests assert on their own), not a failure of the comparison. Returns the run and how many attempts it took.
 */
export async function cleanRun<T extends SimResult>(run: () => Promise<T>, attempts = 4): Promise<T> {
  let last: T | null = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await run();
    if (last.stats.underruns === 0 && last.stats.lateBlocks === 0) return last;
  }
  return last!;
}

/** The simulated audio thread is a plain worker thread: on a machine running a whole test suite it can be scheduled many milliseconds late, which no host can hide. */
export const audioThreadStarved = (result: SimResult, thresholdMs = 8): boolean => result.lateNs.some((n) => n / 1e6 > thresholdMs);
